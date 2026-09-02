import { test } from "node:test";
import assert from "node:assert/strict";
import { screenToWorld, worldToScreen, wrapPhase, wavelengthMeters, computeFitView } from "../src/units.js";

test("screen -> world -> screen round-trips for arbitrary points", () => {
    const view = { width: 800, height: 600, centerX: 1.25, centerY: -0.5, worldPerPixel: 0.015 };
    const points = [
        [0, 0],
        [800, 600],
        [400, 300],
        [123.5, 456.25],
        [-50, 900],
    ];
    for (const [sx, sy] of points) {
        const world = screenToWorld(view, sx, sy);
        const back = worldToScreen(view, world.x, world.y);
        assert.ok(Math.abs(back.x - sx) < 1e-9, `x round-trip: ${back.x} vs ${sx}`);
        assert.ok(Math.abs(back.y - sy) < 1e-9, `y round-trip: ${back.y} vs ${sy}`);
    }
});

test("screen center maps to view center", () => {
    const view = { width: 800, height: 600, centerX: 2, centerY: 3, worldPerPixel: 0.1 };
    const world = screenToWorld(view, 400, 300);
    assert.ok(Math.abs(world.x - 2) < 1e-9);
    assert.ok(Math.abs(world.y - 3) < 1e-9);
});

test("screen y increases downward, world y increases upward", () => {
    const view = { width: 800, height: 600, centerX: 0, centerY: 0, worldPerPixel: 1 };
    const top = screenToWorld(view, 400, 0);
    const bottom = screenToWorld(view, 400, 600);
    assert.ok(top.y > bottom.y);
});

test("wrapPhase keeps values in [-pi, pi)", () => {
    const samples = [0, Math.PI, -Math.PI, 2 * Math.PI, -2 * Math.PI, 10, -10, 3.5 * Math.PI];
    for (const phase of samples) {
        const wrapped = wrapPhase(phase);
        assert.ok(wrapped >= -Math.PI && wrapped < Math.PI, `${phase} -> ${wrapped}`);
    }
});

test("wrapPhase is a no-op inside range and equivalent modulo 2*pi outside it", () => {
    assert.ok(Math.abs(wrapPhase(1) - 1) < 1e-9);
    assert.ok(Math.abs(wrapPhase(2 * Math.PI + 1) - 1) < 1e-9);
});

test("wavelengthMeters divides speed by frequency", () => {
    assert.equal(wavelengthMeters(1540, 1e6), 1540 / 1e6);
    assert.equal(wavelengthMeters(343, 343), 1);
});

test("computeFitView centers on the point cloud centroid bounds", () => {
    const points = [{ x: -2, y: 0 }, { x: 2, y: 0 }];
    const fit = computeFitView(points, 800, 800, 1.3);
    assert.ok(Math.abs(fit.centerX - 0) < 1e-9);
    assert.ok(Math.abs(fit.centerY - 0) < 1e-9);
    assert.ok(Math.abs(fit.fovLambda - 4 * 1.3) < 1e-9);
});

test("computeFitView accounts for aspect ratio when the y-span dominates", () => {
    // Tall, narrow point cloud on a wide canvas: the vertical extent needs
    // more horizontal FOV to fit than the x-span alone would give.
    const points = [{ x: 0, y: -10 }, { x: 0, y: 10 }];
    const wideFit = computeFitView(points, 1600, 800, 1);
    assert.ok(Math.abs(wideFit.fovLambda - 20 * 2) < 1e-9, `fovLambda = ${wideFit.fovLambda}`);

    const squareFit = computeFitView(points, 800, 800, 1);
    assert.ok(Math.abs(squareFit.fovLambda - 20) < 1e-9, `fovLambda = ${squareFit.fovLambda}`);
});

test("computeFitView returns null for an empty point set", () => {
    assert.equal(computeFitView([], 800, 600), null);
});
