import { test } from "node:test";
import assert from "node:assert/strict";
import {
    screenToWorld,
    worldToScreen,
    wrapPhase,
    wavelengthMeters,
    computeFitView,
    steeringPhaseStep,
    niceStep,
    chooseSiPrefix,
    axisTickStep,
    formatAxisTick,
} from "../src/units.js";

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

test("steeringPhaseStep is zero at boresight", () => {
    assert.ok(Math.abs(steeringPhaseStep(0.5, 0)) < 1e-9);
});

test("steeringPhaseStep matches -2*pi*(d/lambda)*sin(theta)", () => {
    const spacingLambda = 0.5;
    const steerAngleDeg = 30;
    const expected = -2 * Math.PI * spacingLambda * Math.sin((steerAngleDeg * Math.PI) / 180);
    assert.ok(Math.abs(steeringPhaseStep(spacingLambda, steerAngleDeg) - expected) < 1e-9);
});

test("steeringPhaseStep is linear in spacingLambda", () => {
    // Only d/lambda and the angle matter -- doubling the spacing (in
    // wavelengths) must exactly double the phase step, with no dependence
    // on any absolute frequency the caller might have in mind.
    const base = steeringPhaseStep(0.4, 30);
    const doubled = steeringPhaseStep(0.8, 30);
    assert.ok(Math.abs(doubled - 2 * base) < 1e-9);
});

test("steeringPhaseStep is odd in the steering angle", () => {
    const positive = steeringPhaseStep(0.4, 20);
    const negative = steeringPhaseStep(0.4, -20);
    assert.ok(Math.abs(positive + negative) < 1e-9);
});

test("niceStep rounds up to the nearest 1/2/5 x 10^n", () => {
    assert.equal(niceStep(0.012), 0.01);
    assert.equal(niceStep(0.024), 0.02);
    assert.equal(niceStep(0.049), 0.05);
    assert.equal(niceStep(0.08), 0.1);
    assert.equal(niceStep(1), 1);
    assert.equal(niceStep(9.5), 10);
});

test("niceStep handles zero/negative input without throwing", () => {
    assert.equal(niceStep(0), 0);
    assert.equal(niceStep(-1), 0);
});

test("chooseSiPrefix picks the largest unit no bigger than the value", () => {
    assert.equal(chooseSiPrefix(0.001).symbol, "mm");
    assert.equal(chooseSiPrefix(0.1).symbol, "cm");
    assert.equal(chooseSiPrefix(2).symbol, "m");
    assert.equal(chooseSiPrefix(5000).symbol, "km");
});

test("chooseSiPrefix falls back to the smallest prefix below its range", () => {
    assert.equal(chooseSiPrefix(1e-12).symbol, "nm");
});

test("axisTickStep + formatAxisTick reproduce the mm/cm examples from the spec", () => {
    // worldPerPixel chosen so 90px of screen is ~1mm: with metersPerLambda=1,
    // worldPerPixel is directly metres/px.
    const mmCase = axisTickStep(1e-3 / 90, 1, 90);
    assert.equal(mmCase.prefix.symbol, "mm");
    assert.equal(formatAxisTick(1, mmCase.stepMeters, mmCase.prefix), "1mm");
    assert.equal(formatAxisTick(2, mmCase.stepMeters, mmCase.prefix), "2mm");
    assert.equal(formatAxisTick(-3, mmCase.stepMeters, mmCase.prefix), "-3mm");

    const cmCase = axisTickStep(0.1 / 90, 1, 90);
    assert.equal(cmCase.prefix.symbol, "cm");
    assert.equal(formatAxisTick(1, cmCase.stepMeters, cmCase.prefix), "10cm");
    assert.equal(formatAxisTick(2, cmCase.stepMeters, cmCase.prefix), "20cm");
});

test("axisTickStep is frequency-dependent only through metersPerLambda, not worldPerPixel directly", () => {
    // Same worldPerPixel, different wavelength -> different physical step,
    // matching CLAUDE.md 5.2 (pattern is frequency-independent, presentation isn't).
    const slow = axisTickStep(0.01, 1e-3);
    const fast = axisTickStep(0.01, 1);
    assert.notEqual(slow.stepMeters, fast.stepMeters);
});
