// Field shader: evaluates the free-space superposition of N monochromatic
// point sources at every pixel (CLAUDE.md 5.5). World units are wavelengths
// (lambda), so the wave number k = 2*pi exactly.
//
// Uniform byte layout (must match packUniforms() in src/gpu.js):
//   offset  0  resolution       : vec2f   canvas size, pixels
//   offset  8  centerWorld      : vec2f   view center, world units (lambda)
//   offset 16  worldPerPixel    : f32     world units per screen pixel
//   offset 20  displayPhase     : f32     2*pi * displayCyclesPerSecond * elapsedSeconds
//   offset 24  gain             : f32     manual display gain (CLAUDE.md 5.5)
//   offset 28  markerRadiusPx   : f32     element marker radius, screen pixels
//   offset 32  elementCount     : u32     active element count (<= MAX_ELEMENTS)
//   offset 36  displayMode      : u32     0 = instantaneous, 1 = envelope, 2 = dB
//   offset 40  spreadingEnabled : u32     1/sqrt(r) spreading loss on/off
//   offset 44  _pad             : u32     alignment padding, unused
struct SimulationUniforms {
    resolution: vec2f,
    centerWorld: vec2f,
    worldPerPixel: f32,
    displayPhase: f32,
    gain: f32,
    markerRadiusPx: f32,
    elementCount: u32,
    displayMode: u32,
    spreadingEnabled: u32,
    _pad: u32,
};

const MAX_ELEMENTS: u32 = 256u;
const K: f32 = 6.283185307179586; // 2*pi; wave number in world units of 1 wavelength
const AMP_REF: f32 = 1.0;
const EPS: f32 = 1e-4;
const DB_FLOOR: f32 = -40.0;

@group(0) @binding(0) var<uniform> uniforms: SimulationUniforms;
// xy = position (lambda), z = phase (rad), w = amplitude weight
@group(0) @binding(1) var<storage, read> elements: array<vec4f, MAX_ELEMENTS>;

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
    var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    return vec4f(pos[vertexIndex], 0.0, 1.0);
}

// Mirrors screenToWorld() in src/units.js exactly.
fn fragToWorld(fragCoord: vec2f) -> vec2f {
    let centered = fragCoord - uniforms.resolution * 0.5;
    return uniforms.centerWorld + vec2f(centered.x, -centered.y) * uniforms.worldPerPixel;
}

fn colorFromIntensity(intensity: f32) -> vec4f {
    let i = clamp(intensity, 0.0, 1.0);
    return vec4f(i * 0.2, i * 0.8, i, 1.0);
}

@fragment
fn fragment_main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    let worldPos = fragToWorld(fragCoord.xy);
    let count = min(uniforms.elementCount, MAX_ELEMENTS);
    let markerRadiusWorld = uniforms.markerRadiusPx * uniforms.worldPerPixel;

    var sumReal: f32 = 0.0;
    var sumImag: f32 = 0.0;
    var onMarker = false;

    for (var i: u32 = 0u; i < count; i = i + 1u) {
        let elementPos = elements[i].xy;
        let phaseRad = elements[i].z;
        let weight = elements[i].w;

        let r = max(distance(worldPos, elementPos), EPS);
        if (r < markerRadiusWorld) {
            onMarker = true;
        }

        var amplitude = weight;
        if (uniforms.spreadingEnabled != 0u) {
            amplitude = amplitude / sqrt(r);
        }

        let angle = -K * r + phaseRad;
        sumReal += amplitude * cos(angle);
        sumImag += amplitude * sin(angle);
    }

    if (onMarker) {
        return vec4f(1.0, 0.0, 0.0, 1.0);
    }

    let envelope = sqrt(sumReal * sumReal + sumImag * sumImag);
    var value: f32;
    if (uniforms.displayMode == 0u) {
        // instantaneous = Re(A * exp(-i * displayPhase))
        let cp = cos(uniforms.displayPhase);
        let sp = sin(uniforms.displayPhase);
        value = (sumReal * cp + sumImag * sp) * uniforms.gain * 0.5 + 0.5;
    } else if (uniforms.displayMode == 1u) {
        value = envelope * uniforms.gain;
    } else {
        let dB = 20.0 * log2(max(envelope * uniforms.gain, EPS) / AMP_REF) / log2(10.0);
        value = (dB - DB_FLOOR) / -DB_FLOOR;
    }

    return colorFromIntensity(value);
}
