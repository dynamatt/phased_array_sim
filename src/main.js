import { createStateStore, MEDIA, DEFAULT_VIEW } from "./state.js";
import { startRenderer } from "./gpu.js";
import { wavelengthMeters, screenToWorld, computeFitView } from "./units.js";
import { layoutElements } from "./geometry.js";

const store = createStateStore();

const $ = (id) => document.getElementById(id);

const MIN_FOV_LAMBDA = 0.5;
const MAX_FOV_LAMBDA = 1000;

function setupControls() {
    const elementCountInput = $("elementCountInput");
    const spacingInput = $("spacingInput");
    const phaseStepInput = $("phaseStepInput");
    const mediumInput = $("mediumInput");
    const frequencyInput = $("frequencyInput");
    const modeInputs = document.getElementsByName("displayMode");
    const cyclesInput = $("cyclesInput");
    const gainInput = $("gainInput");
    const spreadingInput = $("spreadingInput");

    const elementCountReadout = $("elementCountReadout");
    const spacingReadout = $("spacingReadout");
    const phaseStepReadout = $("phaseStepReadout");
    const frequencyReadout = $("frequencyReadout");
    const cyclesReadout = $("cyclesReadout");
    const gainReadout = $("gainReadout");
    const wavelengthReadout = $("wavelengthReadout");
    const spacingMetersReadout = $("spacingMetersReadout");
    const slowMotionReadout = $("slowMotionReadout");

    function updateDerivedReadouts() {
        const state = store.get();
        const speedMps = MEDIA[state.excitation.medium];
        const wavelength = wavelengthMeters(speedMps, state.excitation.frequencyHz);
        const spacingMeters = state.array.spacingLambda * wavelength;
        const slowMotion = state.display.cyclesPerSecond > 0
            ? state.excitation.frequencyHz / state.display.cyclesPerSecond
            : Infinity;

        wavelengthReadout.textContent = `${wavelength.toExponential(3)} m`;
        spacingMetersReadout.textContent = `${spacingMeters.toExponential(3)} m`;
        slowMotionReadout.textContent = Number.isFinite(slowMotion)
            ? `slowed ${slowMotion.toExponential(2)}x`
            : "paused (0 cyc/s)";
    }

    elementCountInput.addEventListener("input", () => {
        const value = parseInt(elementCountInput.value, 10);
        store.update("array.elementCount", value);
        elementCountReadout.textContent = String(value);
    });
    elementCountReadout.textContent = elementCountInput.value;

    spacingInput.addEventListener("input", () => {
        const value = parseFloat(spacingInput.value);
        store.update("array.spacingLambda", value);
        spacingReadout.textContent = value.toFixed(2);
        updateDerivedReadouts();
    });
    spacingReadout.textContent = parseFloat(spacingInput.value).toFixed(2);

    phaseStepInput.addEventListener("input", () => {
        const degrees = parseFloat(phaseStepInput.value);
        store.update("excitation.phaseStepRad", (degrees * Math.PI) / 180);
        phaseStepReadout.textContent = `${degrees}°`;
    });
    phaseStepReadout.textContent = `${phaseStepInput.value}°`;

    mediumInput.addEventListener("input", () => {
        store.update("excitation.medium", mediumInput.value);
        updateDerivedReadouts();
    });

    frequencyInput.addEventListener("input", () => {
        const frequencyHz = Math.pow(10, parseFloat(frequencyInput.value));
        store.update("excitation.frequencyHz", frequencyHz);
        frequencyReadout.textContent = formatFrequency(frequencyHz);
        updateDerivedReadouts();
    });
    frequencyReadout.textContent = formatFrequency(store.get().excitation.frequencyHz);

    for (const radio of modeInputs) {
        radio.addEventListener("input", () => {
            if (radio.checked) store.update("display.mode", radio.value);
        });
    }

    cyclesInput.addEventListener("input", () => {
        const value = parseFloat(cyclesInput.value);
        store.update("display.cyclesPerSecond", value);
        cyclesReadout.textContent = `${value.toFixed(2)} cyc/s`;
        updateDerivedReadouts();
    });
    cyclesReadout.textContent = `${parseFloat(cyclesInput.value).toFixed(2)} cyc/s`;

    gainInput.addEventListener("input", () => {
        const value = parseFloat(gainInput.value);
        store.update("display.gain", value);
        gainReadout.textContent = value.toFixed(3);
    });
    gainReadout.textContent = parseFloat(gainInput.value).toFixed(3);

    spreadingInput.addEventListener("input", () => {
        store.update("display.spreadingEnabled", spreadingInput.checked);
    });

    const renderScaleInput = $("renderScaleInput");
    const renderScaleReadout = $("renderScaleReadout");
    renderScaleInput.addEventListener("input", () => {
        const value = parseFloat(renderScaleInput.value);
        store.update("view.renderScale", value);
        renderScaleReadout.textContent = value.toFixed(2);
    });
    renderScaleReadout.textContent = parseFloat(renderScaleInput.value).toFixed(2);

    $("fitButton").addEventListener("click", fitViewToArray);

    updateDerivedReadouts();
}

/** Frames the current array in the view, with a margin, via computeFitView(). */
function fitViewToArray() {
    const canvas = $("gpuCanvas");
    const state = store.get();
    const positions = layoutElements(state.array.shape, { spacingLambda: state.array.spacingLambda }, state.array.elementCount);
    const fit = computeFitView(positions, canvas.width, canvas.height);
    if (!fit) return;
    store.update("view.centerX", fit.centerX);
    store.update("view.centerY", fit.centerY);
    store.update("view.fovLambda", clamp(fit.fovLambda, MIN_FOV_LAMBDA, MAX_FOV_LAMBDA));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/** Converts a pointer/wheel event's client coordinates to backing-buffer (canvas) pixels. */
function eventToCanvasPixels(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
}

function currentView(canvas) {
    const state = store.get();
    return {
        width: canvas.width,
        height: canvas.height,
        centerX: state.view.centerX,
        centerY: state.view.centerY,
        worldPerPixel: state.view.fovLambda / canvas.width,
    };
}

/** Wheel-to-zoom (about the cursor), drag-to-pan, and the '0' reset shortcut. */
function setupViewInteraction() {
    const canvas = $("gpuCanvas");

    canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const view = currentView(canvas);
        const { x: screenX, y: screenY } = eventToCanvasPixels(canvas, event);
        const worldAtCursor = screenToWorld(view, screenX, screenY);

        const zoomFactor = event.deltaY < 0 ? 0.9 : 1 / 0.9;
        const fovLambda = clamp(store.get().view.fovLambda * zoomFactor, MIN_FOV_LAMBDA, MAX_FOV_LAMBDA);
        const worldPerPixel = fovLambda / view.width;
        const centerX = worldAtCursor.x - (screenX - view.width / 2) * worldPerPixel;
        const centerY = worldAtCursor.y + (screenY - view.height / 2) * worldPerPixel;

        store.update("view.fovLambda", fovLambda);
        store.update("view.centerX", centerX);
        store.update("view.centerY", centerY);
    }, { passive: false });

    let drag = null;
    canvas.addEventListener("pointerdown", (event) => {
        canvas.setPointerCapture(event.pointerId);
        const view = currentView(canvas);
        const { x: screenX, y: screenY } = eventToCanvasPixels(canvas, event);
        drag = { pointerId: event.pointerId, worldAnchor: screenToWorld(view, screenX, screenY) };
    });
    canvas.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const view = currentView(canvas);
        const { x: screenX, y: screenY } = eventToCanvasPixels(canvas, event);
        store.update("view.centerX", drag.worldAnchor.x - (screenX - view.width / 2) * view.worldPerPixel);
        store.update("view.centerY", drag.worldAnchor.y + (screenY - view.height / 2) * view.worldPerPixel);
    });
    const endDrag = (event) => {
        if (drag && drag.pointerId === event.pointerId) drag = null;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    window.addEventListener("keydown", (event) => {
        if (event.key !== "0") return;
        const active = document.activeElement;
        if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
        store.update("view.centerX", DEFAULT_VIEW.centerX);
        store.update("view.centerY", DEFAULT_VIEW.centerY);
        store.update("view.fovLambda", DEFAULT_VIEW.fovLambda);
    });
}

function formatFrequency(frequencyHz) {
    if (frequencyHz >= 1e9) return `${(frequencyHz / 1e9).toFixed(2)} GHz`;
    if (frequencyHz >= 1e6) return `${(frequencyHz / 1e6).toFixed(2)} MHz`;
    if (frequencyHz >= 1e3) return `${(frequencyHz / 1e3).toFixed(2)} kHz`;
    return `${frequencyHz.toFixed(0)} Hz`;
}

function showUnsupported(message) {
    $("gpuCanvas").hidden = true;
    $("controls").hidden = true;
    const panel = $("unsupportedPanel");
    $("unsupportedDetail").textContent = message;
    panel.hidden = false;
}

async function main() {
    setupControls();
    setupViewInteraction();
    await startRenderer($("gpuCanvas"), store, { onUnsupported: showUnsupported });
}

main();
