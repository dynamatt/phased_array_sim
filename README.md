# Phased Array Simulator

A real-time, browser-based phased array wave-field simulator. Requires
WebGPU (Chrome/Edge 113+, Safari 18+, Firefox 141+).

A local server is needed only because `src/gpu.js` fetches
`shaders/field.wgsl`. From this directory:

    python3 -m http.server 8000

Then view in the browser at http://localhost:8000.

## Tests

Pure logic (`src/units.js`, `src/geometry.js`) is covered by `node --test`,
built into Node with no dependencies:

    npm test