/**
 * Array shape -> element positions. Pure functions only: no DOM, no GPU.
 * Positions are in world units (wavelengths), centred on the array centroid.
 *
 * Only "line" is implemented so far. Phase 3 adds "parabola" and "arc" to
 * this same function.
 */

/** @typedef {{x:number, y:number, nx:number, ny:number}} ElementPosition */

/**
 * @param {"line"} shape
 * @param {{spacingLambda:number}} params
 * @param {number} count
 * @returns {ElementPosition[]}
 */
export function layoutElements(shape, params, count) {
    if (shape !== "line") {
        throw new Error(`Unknown array shape: ${shape}`);
    }
    return layoutLine(params.spacingLambda, count);
}

/**
 * @param {number} spacingLambda
 * @param {number} count
 * @returns {ElementPosition[]}
 */
function layoutLine(spacingLambda, count) {
    const n = Math.max(1, Math.floor(count));
    const spacing = Math.max(0, spacingLambda);
    const totalWidth = (n - 1) * spacing;
    const startX = -totalWidth / 2;
    const positions = [];
    for (let i = 0; i < n; i++) {
        positions.push({ x: startX + i * spacing, y: 0, nx: 0, ny: 1 });
    }
    return positions;
}
