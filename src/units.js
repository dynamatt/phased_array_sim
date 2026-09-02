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
