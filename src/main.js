import { createStateStore, DEFAULT_VIEW } from "./state.js";
import { startRenderer } from "./gpu.js";
import { screenToWorld, worldToScreen, computeFitView } from "./units.js";
import { layoutArray } from "./geometry.js";
import { createPanel } from "./ui/panel.js";
import { createAxesOverlay } from "./ui/axes.js";
import { createTargetOverlay, TARGET_GRAB_RADIUS_CSS_PX } from "./ui/target.js";

const store = createStateStore();

const $ = (id) => document.getElementById(id);

const MIN_FOV_LAMBDA = 0.5;
const MAX_FOV_LAMBDA = 1000;
const STEP_SECONDS = 1 / 60;
// Below this many backing pixels of movement, a press+release is a click
// (place a target) rather than a drag (pan) -- PLAN.md Phase 4's chosen
// interaction model.
const CLICK_MOVE_THRESHOLD_PX = 5;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/** Frames the current array in the view, with a margin, via computeFitView(). */
function fitViewToArray() {
    const canvas = $("gpuCanvas");
    const state = store.get();
    const positions = layoutArray(state.array);
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

/**
 * Wheel-to-zoom (about the cursor), drag-to-pan, and the Phase 4 target
 * gestures on the canvas: a plain click (press+release under the move
 * threshold) on empty space places/replaces the focus target (PLAN.md
 * Q4.2 -- always replace); pressing down within grab range of an existing
 * target's marker and dragging moves it live instead of panning.
 */
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
    let targetDrag = null;

    function isNearTargetMarker(view, screenX, screenY) {
        const focus = store.get().focus;
        if (!focus.active) return false;
        const targetScreen = worldToScreen(view, focus.x, focus.y);
        const backingPerCssPixel = canvas.width / (canvas.clientWidth || 1);
        const grabRadiusPx = TARGET_GRAB_RADIUS_CSS_PX * backingPerCssPixel;
        return Math.hypot(screenX - targetScreen.x, screenY - targetScreen.y) <= grabRadiusPx;
    }

    canvas.addEventListener("pointerdown", (event) => {
        canvas.setPointerCapture(event.pointerId);
        const view = currentView(canvas);
        const { x: screenX, y: screenY } = eventToCanvasPixels(canvas, event);

        if (isNearTargetMarker(view, screenX, screenY)) {
            targetDrag = { pointerId: event.pointerId };
            return;
        }
        drag = {
            pointerId: event.pointerId,
            worldAnchor: screenToWorld(view, screenX, screenY),
            startScreenX: screenX,
            startScreenY: screenY,
            moved: false,
        };
    });
    canvas.addEventListener("pointermove", (event) => {
        const view = currentView(canvas);
        const { x: screenX, y: screenY } = eventToCanvasPixels(canvas, event);

        if (targetDrag && targetDrag.pointerId === event.pointerId) {
            const world = screenToWorld(view, screenX, screenY);
            store.update("focus.x", world.x);
            store.update("focus.y", world.y);
            return;
        }
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (Math.hypot(screenX - drag.startScreenX, screenY - drag.startScreenY) > CLICK_MOVE_THRESHOLD_PX) {
            drag.moved = true;
        }
        store.update("view.centerX", drag.worldAnchor.x - (screenX - view.width / 2) * view.worldPerPixel);
        store.update("view.centerY", drag.worldAnchor.y + (screenY - view.height / 2) * view.worldPerPixel);
    });
    const endDrag = (event) => {
        if (targetDrag && targetDrag.pointerId === event.pointerId) {
            targetDrag = null;
            return;
        }
        if (drag && drag.pointerId === event.pointerId) {
            if (!drag.moved) {
                const view = currentView(canvas);
                const { x: screenX, y: screenY } = eventToCanvasPixels(canvas, event);
                const world = screenToWorld(view, screenX, screenY);
                store.update("focus.x", world.x);
                store.update("focus.y", world.y);
                store.update("focus.active", true);
            }
            drag = null;
        }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
}

/** '0' resets the view, 'H' hides all chrome, space pauses, '.' single-steps a frame, Esc clears the focus target. */
function setupKeyboard(panel, axes, targetOverlay) {
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
            axes.setHidden(chromeHidden);
            targetOverlay.setHidden(chromeHidden);
        } else if (event.key === " ") {
            event.preventDefault();
            store.update("display.paused", !store.get().display.paused);
        } else if (event.key === ".") {
            store.update("display.paused", true);
            store.update("display.timeSeconds", store.get().display.timeSeconds + STEP_SECONDS);
        } else if (event.key === "Escape") {
            store.update("focus.active", false);
        }
    });
}

function showUnsupported(message) {
    $("gpuCanvas").hidden = true;
    $("controls")?.remove();
    $("axesOverlay")?.remove();
    $("targetOverlay")?.remove();
    const panel = $("unsupportedPanel");
    $("unsupportedDetail").textContent = message;
    panel.hidden = false;
}

async function main() {
    const axes = createAxesOverlay($("gpuCanvas"), store);
    document.body.appendChild(axes.element);
    const targetOverlay = createTargetOverlay($("gpuCanvas"), store);
    document.body.appendChild(targetOverlay.element);
    const panel = createPanel(store, { onFitArray: fitViewToArray });
    document.body.appendChild(panel.element);
    setupViewInteraction();
    setupKeyboard(panel, axes, targetOverlay);
    await startRenderer($("gpuCanvas"), store, { onUnsupported: showUnsupported });
}

main();
