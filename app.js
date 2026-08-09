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

    // 4. Create a buffer on the GPU to hold our control variables (Time, Freq, Phase)
    const uniformBufferSize = 16; // Must be 16-byte aligned for uniform binding
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // 5. Load and compile the WGSL Shader Code
    const shaderSource = await fetch(new URL("app.wgsl", import.meta.url)).then((res) => {
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

    // 7. The Animation Render Loop
    let startTime = Date.now();
    function frame() {
        const currentTime = (Date.now() - startTime) / 1000.0; // Time in seconds
        const frequency = 40.0; 
        const phaseStep = Math.sin(currentTime) * 2.0; // Dynamic phase shifting to sway the beam left/right

        // Pack values into a float array to send to GPU
        const uniformData = new Float32Array([currentTime, frequency, phaseStep, 0]);
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