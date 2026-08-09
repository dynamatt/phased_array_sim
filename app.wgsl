// Uniform variables passed from JavaScript (CPU) to GPU
struct SimulationUniforms {
    time: f32,
    frequency: f32,
    phase_step: f32, // Used to steer the phased array beam
};
@group(0) @binding(0) var<uniform> uniforms: SimulationUniforms;

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
    var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0)
    );
    return vec4f(pos[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragment_main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    // Normalize canvas coordinates to a -1.0 to 1.0 grid
    // Hardcoded canvas size 800x800 for this example
    let uv = (fragCoord.xy / 800.0) * 2.0 - 1.0; 
    
    // Hardcoded positions of 4 antenna array elements along the X-axis
    let antenna_y = -0.8;
    let antennas = array<vec2f, 4>(
        vec2f(-0.3, antenna_y),
        vec2f(-0.1, antenna_y),
        vec2f( 0.1, antenna_y),
        vec2f( 0.3, antenna_y)
    );

    var total_amplitude: f32 = 0.0;

    // Calculate wave contribution from each antenna element
    for (var i = 0; i < 4; i++) {
        let dist = distance(uv, antennas[i]);
        
        // Progressively shift the phase for each antenna to "steer" the beam
        let element_phase = f32(i) * uniforms.phase_step;
        
        // Wave physics formula
        let wave = sin(dist * uniforms.frequency - uniforms.time + element_phase);
        total_amplitude += wave;
    }

    // Normalize amplitude for color display (-4.0 to +4.0 mapped to 0.0 to 1.0)
    let intensity = (total_amplitude / 4.0) * 0.5 + 0.5;

    // Output color: Bright cyan/blue for wave peaks, black for destructive interference
    return vec4f(intensity * 0.2, intensity * 0.8, intensity, 1.0);
}
