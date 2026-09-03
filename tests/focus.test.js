import { test } from "node:test";
import assert from "node:assert/strict";
import { phasesForTarget, equivalentSteerAngleDeg, rayleighDistanceLambda } from "../src/focus.js";
import { layoutElements, parabolaFocalLength } from "../src/geometry.js";

test("phasesForTarget yields near-uniform phases at a parabola's geometric focus", () => {
    // CLAUDE.md 8's free correctness check: a parabolic reflector equalises
    // path length to its focus, so targeting f = 1/(4a) should need almost
    // no per-element phase correction. Gentle curvature keeps the array's
    // sag small relative to the focal length, which is what makes this true.
    const curvatureA = 0.002;
    const spacingLambda = 0.2;
    const count = 7;
    const elements = layoutElements("parabola", { curvatureA, spacingLambda }, count);
    const focus = { x: 0, y: parabolaFocalLength(curvatureA) };
    const phases = phasesForTarget(elements, focus);
    const spread = Math.max(...phases) - Math.min(...phases);
    assert.ok(spread < 0.05, `phase spread too large: ${spread}`);
});

test("phasesForTarget gives mirror-symmetric elements equal phase for a target on boresight", () => {
    const elements = layoutElements("line", { spacingLambda: 0.5 }, 6);
    const phases = phasesForTarget(elements, { x: 0, y: 20 });
    for (let i = 0; i < elements.length / 2; i++) {
        const j = elements.length - 1 - i;
        assert.ok(Math.abs(phases[i] - phases[j]) < 1e-9, `phase mismatch at ${i}/${j}`);
    }
});

test("phasesForTarget assigns zero phase to the closest element", () => {
    const elements = layoutElements("line", { spacingLambda: 0.5 }, 5);
    const target = { x: 3, y: 10 };
    const phases = phasesForTarget(elements, target);
    let minDist = Infinity;
    let minIndex = -1;
    elements.forEach((p, i) => {
        const d = Math.hypot(target.x - p.x, target.y - p.y);
        if (d < minDist) {
            minDist = d;
            minIndex = i;
        }
    });
    assert.ok(Math.abs(phases[minIndex]) < 1e-9);
});

test("phasesForTarget always wraps into [-pi, pi)", () => {
    // Large spacing + a very close target maximises path-length spread
    // across the array, so this exercises the wrap, not just the formula.
    const elements = layoutElements("line", { spacingLambda: 2 }, 12);
    const phases = phasesForTarget(elements, { x: 0, y: 1 });
    for (const phase of phases) {
        assert.ok(phase >= -Math.PI && phase < Math.PI, `${phase} out of range`);
    }
});

test("equivalentSteerAngleDeg is 0 on boresight and 90 for a broadside target", () => {
    assert.ok(Math.abs(equivalentSteerAngleDeg({ x: 0, y: 5 })) < 1e-9);
    assert.ok(Math.abs(equivalentSteerAngleDeg({ x: 5, y: 0 }) - 90) < 1e-9);
});

test("equivalentSteerAngleDeg is odd in x (mirrors sign with target side)", () => {
    const positive = equivalentSteerAngleDeg({ x: 3, y: 4 });
    const negative = equivalentSteerAngleDeg({ x: -3, y: 4 });
    assert.ok(Math.abs(positive + negative) < 1e-9);
});

test("rayleighDistanceLambda is D^2/4 in wavelength units", () => {
    assert.equal(rayleighDistanceLambda(4), 4);
    assert.equal(rayleighDistanceLambda(2), 1);
    assert.equal(rayleighDistanceLambda(0), 0);
});
