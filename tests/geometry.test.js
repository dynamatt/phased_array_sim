import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElements } from "../src/geometry.js";

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
    assert.throws(() => layoutElements("parabola", {}, 4));
});
