/**
 * Clickable-target (focusing) physics -- PLAN.md Phase 4. Pure functions
 * only: no DOM, no GPU.
 *
 * For an antinode at target T, every element's contribution must arrive in
 * phase: phi_i = wrap(k*r_i - k*r_ref), where r_i = |T - p_i| (wavelengths)
 * and r_ref = min_i r_i (keeps phases relative and small, and pins the
 * closest element to phi=0). This is exactly the constant needed to make
 * the shader's (-k*r_i + phi_i) term equal across every element, i.e. the
 * per-element propagation delay is cancelled and every wavefront coincides
 * at T (CLAUDE.md 5.5).
 */

import { wrapPhase, TWO_PI } from "./units.js";

/**
 * @param {{x:number, y:number}[]} elements positions in wavelengths
 * @param {{x:number, y:number}} targetWorld
 * @returns {Float32Array} one phase (radians, wrapped to [-pi, pi)) per element
 */
export function phasesForTarget(elements, targetWorld) {
    const n = elements.length;
    const distances = new Array(n);
    let rRef = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = targetWorld.x - elements[i].x;
        const dy = targetWorld.y - elements[i].y;
        distances[i] = Math.hypot(dx, dy);
        if (distances[i] < rRef) rRef = distances[i];
    }
    const phases = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        phases[i] = wrapPhase(TWO_PI * (distances[i] - rRef));
    }
    return phases;
}

/**
 * The plane-wave steering angle a far-field target at `targetWorld` is
 * equivalent to: the angle of its direction off boresight (+y), matching the
 * sign convention of units.js steeringPhaseStep (positive angle -> target
 * toward +x). Meaningful mainly in the far-field regime (see
 * rayleighDistanceLambda); still computed regardless, as the readout PLAN.md
 * Phase 4 asks for regardless of regime.
 * @param {{x:number, y:number}} targetWorld
 * @returns {number} degrees
 */
export function equivalentSteerAngleDeg(targetWorld) {
    return (Math.atan2(targetWorld.x, targetWorld.y) * 180) / Math.PI;
}

/**
 * The Rayleigh distance D^2/(4*lambda), in wavelengths (lambda = 1 in world
 * units): beyond this range a target degenerates from a true focus into
 * plane-wave steering. PLAN.md Phase 4's "regime note".
 * @param {number} apertureLambda array aperture, in wavelengths
 * @returns {number}
 */
export function rayleighDistanceLambda(apertureLambda) {
    return (apertureLambda * apertureLambda) / 4;
}
