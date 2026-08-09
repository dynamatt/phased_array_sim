async function initSimulation() {
    // 1. Check if the browser supports WebGPU
    if (!navigator.gpu) {
        alert("WebGPU is not supported on this browser. Try Chrome, Edge, or Nightly Firefox.");
        return;
    }

    // 2. Connect to the Graphics Card
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        alert("Failed to get a GPU adapter. Make sure your browser supports WebGPU and GPU access is allowed.");
        return;
    }
    const device = await adapter.requestDevice();

    // 3. Configure the Canvas context
    const canvas = document.getElementById("gpuCanvas");
    const context = canvas.getContext("webgpu");
    if (!context) {
        alert("Unable to get a WebGPU context from the canvas.");
        return;
    }
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat ? navigator.gpu.getPreferredCanvasFormat() : "bgra8unorm";
    context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

    // 4. Create a buffer on the GPU to hold our control variables (Time, Freq, Phase, AntennaCount, Spacing)
    const uniformBufferSize = 32; // 5 floats require at least 32 bytes for 16-byte alignment
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // 5. Load and compile the WGSL Shader Code
    const shaderSource = await fetch(new URL("app.wgsl", import.meta.url), { cache: "reload" }).then((res) => {
        if (!res.ok) {
            throw new Error("Failed to load app.wgsl");
        }
        return res.text();
    });
    const shaderModule = device.createShaderModule({ code: shaderSource });

    // 6. Create the Pipeline (Tells GPU how to process our data)
    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vertex_main" },
        fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: canvasFormat }] }
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });

    const speedOfSound = 1540.0; // m/s, used to compute wavelength and spacing

    const freqSlider = document.getElementById("freqSlider");
    const phaseSlider = document.getElementById("phaseSlider");
    const antennaSlider = document.getElementById("antennaSlider");
    const spacingSlider = document.getElementById("spacingSlider");
    const freqValue = document.getElementById("freqValue");
    const phaseValue = document.getElementById("phaseValue");
    const antennaValue = document.getElementById("antennaValue");
    const spacingValue = document.getElementById("spacingValue");
    const wavelengthText = document.getElementById("wavelengthText");
    const spacingText = document.getElementById("spacingText");

    const updateLabels = () => {
        const frequency = parseFloat(freqSlider.value);
        const spacingWavelengths = parseFloat(spacingSlider.value);
        const wavelength = speedOfSound / frequency;
        const antennaSpacing = spacingWavelengths * wavelength;

        freqValue.textContent = freqSlider.value;
        phaseValue.textContent = phaseSlider.value;
        antennaValue.textContent = antennaSlider.value;
        spacingValue.textContent = spacingSlider.value;
        wavelengthText.textContent = `Wavelength: ${wavelength.toFixed(2)} m`;
        spacingText.textContent = `Spacing: ${antennaSpacing.toFixed(2)} m`;
    };
    updateLabels();
    freqSlider.addEventListener("input", updateLabels);
    phaseSlider.addEventListener("input", updateLabels);
    antennaSlider.addEventListener("input", updateLabels);
    spacingSlider.addEventListener("input", updateLabels);

    // 7. The Animation Render Loop
    let startTime = Date.now();
    function frame() {
        const currentTime = (Date.now() - startTime) / 1000.0; // Time in seconds
        const frequency = parseFloat(freqSlider.value);
        const phaseDegrees = parseFloat(phaseSlider.value);
        const antennaCount = parseFloat(antennaSlider.value);
        const spacingWavelengths = parseFloat(spacingSlider.value);
        const phaseStep = phaseDegrees * (Math.PI / 180.0);

        // Pack values into a float array to send to GPU
        const uniformData = new Float32Array([currentTime, frequency, phaseStep, antennaCount, spacingWavelengths]);
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        // Command Encoder records drawing instructions
        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();
        
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{ view: textureView, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }]
        });

        renderPass.setPipeline(pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3); // Draws full canvas screen
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

initSimulation();