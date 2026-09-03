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

/** SI length prefixes the axis overlay chooses among, descending by factor. */
const SI_LENGTH_PREFIXES = [
    { symbol: "Gm", factor: 1e9 },
    { symbol: "Mm", factor: 1e6 },
    { symbol: "km", factor: 1e3 },
    { symbol: "m", factor: 1 },
    { symbol: "cm", factor: 1e-2 },
    { symbol: "mm", factor: 1e-3 },
    { symbol: "µm", factor: 1e-6 },
    { symbol: "nm", factor: 1e-9 },
];

/**
 * Rounds `rawValue` (> 0) up to the nearest "nice" 1/2/5 x 10^n step, the
 * standard graph-axis tick algorithm. Used so axis ticks land on round
 * numbers instead of whatever the zoom level happens to imply.
 * @param {number} rawValue
 * @returns {number}
 */
export function niceStep(rawValue) {
    if (!(rawValue > 0)) return 0;
    const exponent = Math.floor(Math.log10(rawValue));
    const fraction = rawValue / Math.pow(10, exponent);
    let niceFraction;
    let niceExponent = exponent;
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else { niceFraction = 1; niceExponent += 1; }
    return niceFraction * Math.pow(10, niceExponent);
}

/**
 * The largest SI length prefix whose unit is no bigger than `valueMeters`,
 * so the displayed coefficient is >= 1 (e.g. "10 cm" rather than "0.1 m").
 * Falls back to the smallest prefix (nm) below that.
 * @param {number} valueMeters
 * @returns {{symbol:string, factor:number}}
 */
export function chooseSiPrefix(valueMeters) {
    const abs = Math.abs(valueMeters);
    for (const prefix of SI_LENGTH_PREFIXES) {
        if (abs >= prefix.factor) return prefix;
    }
    return SI_LENGTH_PREFIXES[SI_LENGTH_PREFIXES.length - 1];
}

/**
 * Axis tick spacing for the world-space axes overlay: a "nice" step in
 * physical units close to `targetTickPx` on screen, converted back to world
 * units (lambda) via the current wavelength, plus the SI prefix to label it
 * with. CLAUDE.md 5.2: the pattern lives in wavelengths, but the axis is a
 * presentation-layer readout, so it always re-derives from the current
 * medium/frequency rather than being stored.
 * @param {number} worldPerPixel lambda per CSS pixel
 * @param {number} metersPerLambda wavelength in metres (c/f)
 * @param {number} [targetTickPx]
 * @returns {{stepWorld:number, stepMeters:number, prefix:{symbol:string, factor:number}}}
 */
export function axisTickStep(worldPerPixel, metersPerLambda, targetTickPx = 90) {
    const metersPerPixel = worldPerPixel * metersPerLambda;
    const stepMeters = niceStep(targetTickPx * metersPerPixel);
    const stepWorld = stepMeters / metersPerLambda;
    const prefix = chooseSiPrefix(stepMeters);
    return { stepWorld, stepMeters, prefix };
}

/**
 * Label for tick index `k` (can be negative), e.g. k=2, stepMeters=0.01,
 * prefix={symbol:"cm",factor:0.01} -> "2cm".
 * @param {number} k
 * @param {number} stepMeters
 * @param {{symbol:string, factor:number}} prefix
 * @returns {string}
 */
export function formatAxisTick(k, stepMeters, prefix) {
    const value = (k * stepMeters) / prefix.factor;
    const rounded = Math.round(value * 1e6) / 1e6;
    return `${rounded}${prefix.symbol}`;
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
