import { createStateStore, DEFAULT_VIEW } from "./state.js";
import { startRenderer } from "./gpu.js";
import { screenToWorld, computeFitView } from "./units.js";
import { layoutElements } from "./geometry.js";
import { createPanel } from "./ui/panel.js";

const store = createStateStore();

const $ = (id) => document.getElementById(id);

const MIN_FOV_LAMBDA = 0.5;
const MAX_FOV_LAMBDA = 1000;
const STEP_SECONDS = 1 / 60;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

/** Wheel-to-zoom (about the cursor) and drag-to-pan on the canvas. */
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
}

/** '0' resets the view, 'H' hides all chrome, space pauses, '.' single-steps a frame. */
function setupKeyboard(panel) {
    let chromeHidden = false;
    window.addEventListener("keydown", (event) => {
        const active = document.activeElement;
        if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;

        if (event.key === "0") {
            store.update("view.centerX", DEFAULT_VIEW.centerX);
            store.update("view.centerY", DEFAULT_VIEW.centerY);
            store.update("view.fovLambda", DEFAULT_VIEW.fovLambda);
        } else if (event.key === "h" || event.key === "H") {
            chromeHidden = !chromeHidden;
            panel.setFullyHidden(chromeHidden);
        } else if (event.key === " ") {
            event.preventDefault();
            store.update("display.paused", !store.get().display.paused);
        } else if (event.key === ".") {
            store.update("display.paused", true);
            store.update("display.timeSeconds", store.get().display.timeSeconds + STEP_SECONDS);
        }
    });
}

function showUnsupported(message) {
    $("gpuCanvas").hidden = true;
    $("controls")?.remove();
    const panel = $("unsupportedPanel");
    $("unsupportedDetail").textContent = message;
    panel.hidden = false;
}

async function main() {
    const panel = createPanel(store, { onFitArray: fitViewToArray });
    document.body.appendChild(panel.element);
    setupViewInteraction();
    setupKeyboard(panel);
    await startRenderer($("gpuCanvas"), store, { onUnsupported: showUnsupported });
}

main();
