// Uniform variables passed from JavaScript (CPU) to GPU
struct SimulationUniforms {
    time: f32,
    frequency: f32,
    phase_step: f32, // Used to steer the phased array beam
    antenna_count: f32,
    antenna_spacing: f32,
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
    
    let antenna_y = -0.8;
    let antennaCount = u32(clamp(uniforms.antenna_count, 1.0, 16.0));
    let antennaSpacing = max(uniforms.antenna_spacing, 0.05);
    let totalWidth = f32(antennaCount - 1u) * antennaSpacing;
    let startX = -totalWidth * 0.5;

    let wavelength = 1.0;
    let waveNumber = 2.0 * 3.141592653589793 / wavelength;
    let angularFrequency = 2.0 * 3.141592653589793 * uniforms.frequency;

    var total_amplitude: f32 = 0.0;
    var antenna_overlay: f32 = 0.0;

    // Calculate wave contribution from each antenna element
    for (var i: u32 = 0u; i < antennaCount; i = i + 1u) {
        let antennaPosition = vec2f(startX + f32(i) * antennaSpacing, antenna_y);
        let dist = distance(uv, antennaPosition);
        
        // Mark antenna positions with a large red dot overlay
        let dot_radius = 0.02;
        if (dist < dot_radius) {
            antenna_overlay = 1.0;
        }
        
        // Progressively shift the phase for each antenna to "steer" the beam
        let element_phase = f32(i) * uniforms.phase_step;
        
        // Wave physics formula in wavelength-normalized units
        let wave = sin(dist * waveNumber - angularFrequency * uniforms.time + element_phase);
        total_amplitude += wave;
    }

    // Normalize amplitude for color display based on selected antenna count
    let intensity = (total_amplitude / f32(antennaCount)) * 0.5 + 0.5;

    // Antenna markers are bright red and sit on top of the wave field
    if (antenna_overlay > 0.5) {
        return vec4f(1.0, 0.0, 0.0, 1.0);
    }

    return vec4f(intensity * 0.2, intensity * 0.8, intensity, 1.0);
}
