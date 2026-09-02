/**
 * World <-> screen transforms and small physics helpers. Pure functions only:
 * no DOM, no GPU, no globals.
 *
 * World coordinate unit is 1 wavelength (lambda), origin at the array
 * centroid, +x right, +y up. Screen pixels have y increasing downward.
 *
 * screenToWorld()/worldToScreen() MUST mirror fragToWorld() in
 * shaders/field.wgsl exactly. If the two drift apart, click-to-target math
 * (Phase 4) will place antinodes in the wrong spot on screen.
 */

export const TWO_PI = 2 * Math.PI;

/** @typedef {{width:number, height:number, centerX:number, centerY:number, worldPerPixel:number}} ViewState */

/**
 * @param {ViewState} view
 * @param {number} screenX
 * @param {number} screenY
 * @returns {{x:number, y:number}}
 */
export function screenToWorld(view, screenX, screenY) {
    const x = view.centerX + (screenX - view.width / 2) * view.worldPerPixel;
    const y = view.centerY - (screenY - view.height / 2) * view.worldPerPixel;
    return { x, y };
}

/**
 * @param {ViewState} view
 * @param {number} worldX
 * @param {number} worldY
 * @returns {{x:number, y:number}}
 */
export function worldToScreen(view, worldX, worldY) {
    const x = (worldX - view.centerX) / view.worldPerPixel + view.width / 2;
    const y = view.height / 2 - (worldY - view.centerY) / view.worldPerPixel;
    return { x, y };
}

/**
 * Wrap radians to [-pi, pi).
 * @param {number} phaseRad
 * @returns {number}
 */
export function wrapPhase(phaseRad) {
    return ((phaseRad + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}

/**
 * Wavelength in metres from a medium propagation speed and a frequency.
 * @param {number} speedMps
 * @param {number} frequencyHz
 * @returns {number}
 */
export function wavelengthMeters(speedMps, frequencyHz) {
    return speedMps / frequencyHz;
}

/**
 * A view (center + horizontal field of view) that frames `points` with a
 * margin, given the canvas's pixel aspect ratio. Horizontal FOV is the
 * controlling parameter (see ViewState); the vertical extent that results
 * must still cover the points' y-span, so a tall/narrow point cloud on a
 * wide canvas needs a larger FOV than its x-span alone would suggest.
 * @param {{x:number, y:number}[]} points
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} [marginFactor] e.g. 1.3 for a 30% margin around the tight fit
 * @returns {{centerX:number, centerY:number, fovLambda:number} | null}
 */
export function computeFitView(points, canvasWidth, canvasHeight, marginFactor = 1.3) {
    if (points.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) {
        return null;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    const aspect = canvasWidth / canvasHeight;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const fovLambda = Math.max(spanX, spanY * aspect, 1e-6) * marginFactor;
    return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, fovLambda };
}

/**
 * Per-element phase step for a uniform line array steered to `steerAngleDeg`
 * off boresight (CLAUDE.md 5.4): deltaPhi = -2*pi*(d/lambda)*sin(theta).
 * Frequency-independent by construction: only d/lambda and the angle matter,
 * which is why the UI exposes an angle rather than a raw phase step.
 * @param {number} spacingLambda
 * @param {number} steerAngleDeg
 * @returns {number} radians
 */
export function steeringPhaseStep(spacingLambda, steerAngleDeg) {
    const steerAngleRad = (steerAngleDeg * Math.PI) / 180;
    return -TWO_PI * spacingLambda * Math.sin(steerAngleRad);
}
