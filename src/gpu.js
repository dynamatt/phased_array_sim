/**
 * WebGPU device/context/pipeline/buffers, resize handling, and the render
 * loop. The loop reads a snapshot from the state store every frame; it never
 * queries the DOM.
 */

import { layoutElements } from "./geometry.js";
import { wrapPhase, TWO_PI } from "./units.js";
import { DISPLAY_MODES } from "./state.js";

export const MAX_ELEMENTS = 256;
const MARKER_RADIUS_PX = 5;

// 12 x 4-byte fields, struct alignment 8 (largest member is vec2f) -> must
// be a multiple of 8. Keep this in lockstep with the SimulationUniforms
// struct comment in shaders/field.wgsl.
const UNIFORM_BUFFER_SIZE = 48;
if (UNIFORM_BUFFER_SIZE % 8 !== 0) {
    throw new Error(`UNIFORM_BUFFER_SIZE (${UNIFORM_BUFFER_SIZE}) violates WGSL struct alignment`);
}

export class UnsupportedError extends Error {}

async function createGpuContext(canvas) {
    if (!navigator.gpu) {
        throw new UnsupportedError(
            "WebGPU is not supported on this browser. Try Chrome/Edge 113+, Safari 18+, or Firefox 141+."
        );
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new UnsupportedError("Failed to get a GPU adapter. Make sure your browser supports WebGPU and GPU access is allowed.");
    }
    const device = await adapter.requestDevice();
    device.lost.then((info) => {
        console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
    });

    const context = canvas.getContext("webgpu");
    if (!context) {
        throw new UnsupportedError("Unable to get a WebGPU context from the canvas.");
    }
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat
        ? navigator.gpu.getPreferredCanvasFormat()
        : "bgra8unorm";
    context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

    const shaderSource = await fetch(new URL("../shaders/field.wgsl", import.meta.url), { cache: "reload" }).then((res) => {
        if (!res.ok) throw new Error("Failed to load shaders/field.wgsl");
        return res.text();
    });
    const shaderModule = device.createShaderModule({ code: shaderSource });

    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vertex_main" },
        fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: canvasFormat }] },
    });

    const uniformBuffer = device.createBuffer({
        size: UNIFORM_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const elementsBuffer = device.createBuffer({
        size: MAX_ELEMENTS * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: elementsBuffer } },
        ],
    });

    return { device, context, canvasFormat, pipeline, bindGroup, uniformBuffer, elementsBuffer };
}

function resizeCanvasToDisplaySize(canvas, gpu) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const maxDim = gpu.device.limits.maxTextureDimension2D;
    const width = Math.min(maxDim, Math.max(1, Math.floor(canvas.clientWidth * dpr)));
    const height = Math.min(maxDim, Math.max(1, Math.floor(canvas.clientHeight * dpr)));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gpu.context.configure({ device: gpu.device, format: gpu.canvasFormat, alphaMode: "opaque" });
    }
}

/** Writes packed element data (position/phase/weight) into `target`; returns the element count written. */
function packElements(target, snapshot) {
    const positions = layoutElements(snapshot.array.shape, { spacingLambda: snapshot.array.spacingLambda }, snapshot.array.elementCount);
    const n = Math.min(positions.length, MAX_ELEMENTS);
    for (let i = 0; i < n; i++) {
        const phaseRad = wrapPhase(i * snapshot.excitation.phaseStepRad);
        target[i * 4 + 0] = positions[i].x;
        target[i * 4 + 1] = positions[i].y;
        target[i * 4 + 2] = phaseRad;
        target[i * 4 + 3] = 1.0;
    }
    return n;
}

/**
 * Starts the render loop against `canvas`, reading state from `stateStore`.
 * Calls `onUnsupported(message)` and resolves to null if WebGPU isn't
 * available, instead of throwing.
 */
export async function startRenderer(canvas, stateStore, { onUnsupported } = {}) {
    let gpu;
    try {
        gpu = await createGpuContext(canvas);
    } catch (err) {
        if (err instanceof UnsupportedError) {
            onUnsupported?.(err.message);
            return null;
        }
        throw err;
    }

    const uniformArrayBuffer = new ArrayBuffer(UNIFORM_BUFFER_SIZE);
    const uniformFloats = new Float32Array(uniformArrayBuffer);
    const uniformUints = new Uint32Array(uniformArrayBuffer);
    const elementsArray = new Float32Array(MAX_ELEMENTS * 4);

    let lastTimestampMs = null;
    let stopped = false;

    function frame(nowMs) {
        if (stopped) return;
        resizeCanvasToDisplaySize(canvas, gpu);

        const dtSeconds = lastTimestampMs === null ? 0 : (nowMs - lastTimestampMs) / 1000;
        lastTimestampMs = nowMs;

        // Mutated directly (not via stateStore.update) so per-frame time
        // accumulation doesn't fan out a change notification to UI
        // listeners 60 times a second; nothing but the render loop reads
        // display.timeSeconds.
        const snapshot = stateStore.get();
        if (!snapshot.display.paused) {
            snapshot.display.timeSeconds += dtSeconds;
        }

        const elementCount = packElements(elementsArray, snapshot);
        gpu.device.queue.writeBuffer(gpu.elementsBuffer, 0, elementsArray, 0, elementCount * 4);

        const width = canvas.width || 1;
        const height = canvas.height || 1;
        const worldPerPixel = snapshot.view.fovLambda / width;
        const displayPhase = TWO_PI * snapshot.display.cyclesPerSecond * snapshot.display.timeSeconds;

        uniformFloats[0] = width;
        uniformFloats[1] = height;
        uniformFloats[2] = snapshot.view.centerX;
        uniformFloats[3] = snapshot.view.centerY;
        uniformFloats[4] = worldPerPixel;
        uniformFloats[5] = displayPhase;
        uniformFloats[6] = snapshot.display.gain;
        uniformFloats[7] = MARKER_RADIUS_PX;
        uniformUints[8] = elementCount;
        uniformUints[9] = DISPLAY_MODES[snapshot.display.mode] ?? 0;
        uniformUints[10] = snapshot.display.spreadingEnabled ? 1 : 0;
        uniformUints[11] = 0;
        gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, uniformArrayBuffer);

        const commandEncoder = gpu.device.createCommandEncoder();
        const textureView = gpu.context.getCurrentTexture().createView();
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{ view: textureView, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
        });
        renderPass.setPipeline(gpu.pipeline);
        renderPass.setBindGroup(0, gpu.bindGroup);
        renderPass.draw(3);
        renderPass.end();
        gpu.device.queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
        stop() {
            stopped = true;
        },
    };
}
