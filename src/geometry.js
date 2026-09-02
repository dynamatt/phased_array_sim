/**
 * Array shape -> element positions. Pure functions only: no DOM, no GPU.
 * Positions are in world units (wavelengths).
 *
 * "line" is centred on its centroid, at y = 0. "parabola" and "arc" are
 * centred on their vertex (the point closest to the origin along the curve,
 * at (0, 0)) rather than their centroid: this keeps the geometric-focus
 * check in CLAUDE.md 8 simple (target = (0, f) in the same coordinates the
 * shape was defined in) and matches how a focal length is normally quoted
 * relative to a vertex, not a centroid.
 *
 * All three shapes place elements at equal *arc-length* spacing (CLAUDE.md
 * Phase 3, Q3.1) -- for "line" that's just equal spacing; for "arc" it falls
 * out for free since arc length is proportional to angle at constant radius
 * (equal angular steps = equal arc-length steps); "parabola" needs a small
 * numeric integration. Because spacing is uniform along the curve for every
 * shape, a uniform per-element phase increment is exactly the "linear phase
 * gradient along the arc-length coordinate" CLAUDE.md's steering model asks
 * for -- gpu.js doesn't need shape-specific steering code.
 */

/** @typedef {{x:number, y:number, nx:number, ny:number}} ElementPosition */

/**
 * @param {"line"|"parabola"|"arc"} shape
 * @param {object} params
 * @param {number} count
 * @returns {ElementPosition[]}
 */
export function layoutElements(shape, params, count) {
    if (shape === "line") return layoutLine(params.spacingLambda, count);
    if (shape === "parabola") return layoutParabola(params.curvatureA, params.spacingLambda, count);
    if (shape === "arc") return layoutArc(params.radiusLambda, params.sweepDeg, count);
    throw new Error(`Unknown array shape: ${shape}`);
}

/**
 * Convenience wrapper for the common case of having a whole `array` state
 * slice (as stored in state.js) rather than a shape-specific params object;
 * used by gpu.js, main.js, and ui/panel.js so the shape -> params dispatch
 * lives in exactly one place.
 * @param {{shape:string, elementCount:number, spacingLambda:number, curvatureA:number, radiusLambda:number, sweepDeg:number}} arrayState
 * @returns {ElementPosition[]}
 */
export function layoutArray(arrayState) {
    const { shape, elementCount, spacingLambda, curvatureA, radiusLambda, sweepDeg } = arrayState;
    if (shape === "line") return layoutLine(spacingLambda, elementCount);
    if (shape === "parabola") return layoutParabola(curvatureA, spacingLambda, elementCount);
    if (shape === "arc") return layoutArc(radiusLambda, sweepDeg, elementCount);
    throw new Error(`Unknown array shape: ${shape}`);
}

/**
 * The arc-length spacing between adjacent elements (wavelengths) implied by
 * a shape's own parameters -- the "d" the steering phase-step formula and
 * the grating-lobe (d/lambda > 0.5) warning both want. Deliberately *not*
 * derived from layoutElements()'s output: that gives straight-line (chord)
 * distances between points, which are very slightly shorter than the
 * arc-length spacing the array was actually built at (equal everywhere
 * except "line", where the curve is straight and the two coincide). Reading
 * each shape's own spacing parameter directly keeps this exact and matches
 * CLAUDE.md's arc chord-spacing formula d = R*sweep/(N-1) (itself an
 * arc-length formula despite the name).
 * @param {"line"|"parabola"|"arc"} shape
 * @param {object} params
 * @param {number} count
 * @returns {number}
 */
export function elementSpacingLambda(shape, params, count) {
    if (shape === "line" || shape === "parabola") return Math.max(0, params.spacingLambda);
    if (shape === "arc") {
        const n = Math.max(1, Math.floor(count));
        if (n < 2) return 0;
        const sweepRad = (params.sweepDeg * Math.PI) / 180;
        return (Math.max(1e-6, params.radiusLambda) * sweepRad) / (n - 1);
    }
    throw new Error(`Unknown array shape: ${shape}`);
}

/** Convenience wrapper over an `array` state slice, mirroring layoutArray(). */
export function elementSpacingForArray(arrayState) {
    return elementSpacingLambda(arrayState.shape, arrayState, arrayState.elementCount);
}

/**
 * Analytic focal length of y = curvatureA * x^2, per CLAUDE.md 8's
 * geometric-focus check.
 * @param {number} curvatureA
 * @returns {number}
 */
export function parabolaFocalLength(curvatureA) {
    return 1 / (4 * curvatureA);
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

/** sqrt(1 + (dy/dx)^2) for y = a*x^2, i.e. the parabola's arc-length integrand. */
function parabolaArcLengthIntegrand(curvatureA, x) {
    const slope = 2 * curvatureA * x;
    return Math.sqrt(1 + slope * slope);
}

/** Arc length of y = a*x^2 from 0 to x, via Simpson's rule (x >= 0). */
function parabolaArcLength(curvatureA, x) {
    if (x <= 0) return 0;
    const steps = 64; // even, for Simpson's rule
    const h = x / steps;
    let sum = parabolaArcLengthIntegrand(curvatureA, 0) + parabolaArcLengthIntegrand(curvatureA, x);
    for (let i = 1; i < steps; i++) {
        const t = i * h;
        sum += parabolaArcLengthIntegrand(curvatureA, t) * (i % 2 === 0 ? 2 : 4);
    }
    return (h / 3) * sum;
}

/**
 * Inverse of parabolaArcLength: the x (>= 0) whose arc length from the
 * vertex is `targetLength`. Arc length always exceeds the chord (dy/dx term
 * only adds), so `targetLength` itself is a safe upper bound for bisection.
 */
function xForArcLength(curvatureA, targetLength) {
    if (targetLength <= 0) return 0;
    let lo = 0;
    let hi = targetLength;
    for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (parabolaArcLength(curvatureA, mid) < targetLength) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * @param {number} curvatureA 1/lambda; y = curvatureA * x^2
 * @param {number} spacingLambda arc-length spacing between adjacent elements
 * @param {number} count
 * @returns {ElementPosition[]}
 */
function layoutParabola(curvatureA, spacingLambda, count) {
    const n = Math.max(1, Math.floor(count));
    const spacing = Math.max(0, spacingLambda);
    const arcOffsets = symmetricOffsets(n, spacing);

    const positions = [];
    for (const arcOffset of arcOffsets) {
        const sign = Math.sign(arcOffset) || 1;
        const x = sign * xForArcLength(curvatureA, Math.abs(arcOffset));
        const y = curvatureA * x * x;
        const slope = 2 * curvatureA * x;
        const norm = Math.hypot(1, slope);
        positions.push({ x, y, nx: -slope / norm, ny: 1 / norm });
    }
    return positions;
}

/**
 * @param {number} radiusLambda
 * @param {number} sweepDeg total angular sweep, degrees
 * @param {number} count
 * @returns {ElementPosition[]}
 */
function layoutArc(radiusLambda, sweepDeg, count) {
    const n = Math.max(1, Math.floor(count));
    const radius = Math.max(1e-6, radiusLambda);
    const sweepRad = (sweepDeg * Math.PI) / 180;

    const positions = [];
    for (let i = 0; i < n; i++) {
        const theta = n === 1 ? 0 : (i / (n - 1) - 0.5) * sweepRad;
        // Circle centred at (0, radius): the vertex (theta=0) sits at the
        // origin, and the array bulges toward -y with edges rising toward
        // +y, matching the parabola's "opens toward +y" convention. The
        // normal points from each point back toward the centre of
        // curvature (0, radius) -- i.e. toward +y at the vertex -- which is
        // the array's forward/broadside direction, same as "line" and
        // "parabola".
        const x = radius * Math.sin(theta);
        const y = radius * (1 - Math.cos(theta));
        positions.push({ x, y, nx: -Math.sin(theta), ny: Math.cos(theta) });
    }
    return positions;
}

/** Arc-length offsets from the vertex for `count` elements at `spacing`, symmetric about 0. */
function symmetricOffsets(count, spacing) {
    const offsets = [];
    if (count % 2 === 1) {
        const half = (count - 1) / 2;
        for (let i = -half; i <= half; i++) offsets.push(i * spacing);
    } else {
        const half = count / 2;
        for (let i = half - 1; i >= 0; i--) offsets.push(-(i + 0.5) * spacing);
        for (let i = 0; i < half; i++) offsets.push((i + 0.5) * spacing);
    }
    return offsets;
}
