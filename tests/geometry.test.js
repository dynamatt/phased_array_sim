import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElements, layoutArray, elementSpacingLambda, elementSpacingForArray, parabolaFocalLength } from "../src/geometry.js";

test("line layout produces exactly `count` elements", () => {
    const positions = layoutElements("line", { spacingLambda: 0.5 }, 8);
    assert.equal(positions.length, 8);
});

test("line layout is centred on the origin", () => {
    const positions = layoutElements("line", { spacingLambda: 0.5 }, 8);
    const centroidX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    assert.ok(Math.abs(centroidX) < 1e-9, `centroid x = ${centroidX}`);
    for (const p of positions) {
        assert.equal(p.y, 0);
    }
});

test("line layout spacing matches the requested spacing", () => {
    const spacingLambda = 0.35;
    const positions = layoutElements("line", { spacingLambda }, 5);
    for (let i = 1; i < positions.length; i++) {
        const gap = positions[i].x - positions[i - 1].x;
        assert.ok(Math.abs(gap - spacingLambda) < 1e-9, `gap ${i} = ${gap}`);
    }
});

test("a single element sits at the origin", () => {
    const positions = layoutElements("line", { spacingLambda: 0.5 }, 1);
    assert.equal(positions.length, 1);
    assert.equal(positions[0].x, 0);
    assert.equal(positions[0].y, 0);
});

test("unknown shapes throw", () => {
    assert.throws(() => layoutElements("hexagon", {}, 4));
});

test("parabola layout produces exactly `count` elements, all on the curve", () => {
    const curvatureA = 0.08;
    const positions = layoutElements("parabola", { curvatureA, spacingLambda: 0.4 }, 9);
    assert.equal(positions.length, 9);
    for (const p of positions) {
        assert.ok(Math.abs(p.y - curvatureA * p.x * p.x) < 1e-6, `(${p.x}, ${p.y}) not on y = a*x^2`);
    }
});

test("parabola vertex sits at the origin for an odd element count", () => {
    const positions = layoutElements("parabola", { curvatureA: 0.05, spacingLambda: 0.5 }, 7);
    const middle = positions[3];
    assert.ok(Math.abs(middle.x) < 1e-9 && Math.abs(middle.y) < 1e-9);
});

test("parabola elements are equally spaced by arc length", () => {
    // Independent closed-form arc length for y = a*x^2 (verified by hand:
    // d/dx of this expression is sqrt(1 + (2ax)^2)), used here instead of
    // the module's own numeric integrator so the test isn't just checking
    // the implementation against itself.
    const curvatureA = 0.1;
    const spacingLambda = 0.3;
    const arcLength = (x) => (x / 2) * Math.sqrt(1 + 4 * curvatureA * curvatureA * x * x) + Math.asinh(2 * curvatureA * x) / (4 * curvatureA);

    const positions = layoutElements("parabola", { curvatureA, spacingLambda }, 8);
    for (let i = 1; i < positions.length; i++) {
        const arcGap = Math.abs(arcLength(positions[i].x) - arcLength(positions[i - 1].x));
        assert.ok(Math.abs(arcGap - spacingLambda) < 1e-4, `arc gap ${i} = ${arcGap}`);
    }
});

test("parabolaFocalLength matches 1/(4a)", () => {
    assert.equal(parabolaFocalLength(0.05), 1 / 0.2);
    assert.equal(parabolaFocalLength(0.25), 1);
});

test("arc layout produces exactly `count` elements, all at radius from the centre of curvature", () => {
    const radiusLambda = 10;
    const positions = layoutElements("arc", { radiusLambda, sweepDeg: 120 }, 6);
    assert.equal(positions.length, 6);
    for (const p of positions) {
        const distFromCentre = Math.hypot(p.x - 0, p.y - radiusLambda);
        assert.ok(Math.abs(distFromCentre - radiusLambda) < 1e-9);
    }
});

test("arc vertex sits at the origin for an odd element count", () => {
    const positions = layoutElements("arc", { radiusLambda: 8, sweepDeg: 90 }, 5);
    const middle = positions[2];
    assert.ok(Math.abs(middle.x) < 1e-9 && Math.abs(middle.y) < 1e-9);
});

test("layoutArray dispatches on arrayState.shape", () => {
    const line = layoutArray({ shape: "line", elementCount: 4, spacingLambda: 0.5 });
    const direct = layoutElements("line", { spacingLambda: 0.5 }, 4);
    assert.deepEqual(line, direct);
});

test("elementSpacingLambda returns spacingLambda directly for line and parabola", () => {
    assert.equal(elementSpacingLambda("line", { spacingLambda: 0.42 }, 8), 0.42);
    assert.equal(elementSpacingLambda("parabola", { spacingLambda: 0.3, curvatureA: 0.1 }, 8), 0.3);
});

test("elementSpacingLambda for arc matches R * sweepRad / (n - 1)", () => {
    const radiusLambda = 20;
    const sweepDeg = 30;
    const count = 10;
    const expected = (radiusLambda * (sweepDeg * Math.PI) / 180) / (count - 1);
    assert.ok(Math.abs(elementSpacingLambda("arc", { radiusLambda, sweepDeg }, count) - expected) < 1e-12);
});

test("elementSpacingForArray matches elementSpacingLambda for the same shape", () => {
    const arrayState = { shape: "arc", elementCount: 6, radiusLambda: 12, sweepDeg: 60 };
    assert.equal(elementSpacingForArray(arrayState), elementSpacingLambda("arc", arrayState, 6));
});
