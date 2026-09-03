/**
 * Fixed-pixel-size crosshair/ring marker for the Phase 4 focus target,
 * drawn as an SVG overlay (same pattern as ui/axes.js) so it never scales
 * with zoom. Screen position comes from worldToScreen() -- the same
 * transform the shader and the pan/zoom interaction use, so the marker can
 * never drift from where the target phases were actually computed.
 *
 * TARGET_GRAB_RADIUS_CSS_PX is exported so main.js's pointer handling can
 * hit-test against the same radius the marker is drawn at, without
 * duplicating the rendering logic.
 */

import { worldToScreen } from "../units.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const TARGET_MARKER_RADIUS_CSS_PX = 10;
export const TARGET_GRAB_RADIUS_CSS_PX = 18;

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
}

/**
 * @param {HTMLCanvasElement} canvas the field canvas this overlay tracks
 * @param {ReturnType<import("../state.js").createStateStore>} store
 */
export function createTargetOverlay(canvas, store) {
    const svg = svgEl("svg", { id: "targetOverlay" });
    svg.setAttribute("aria-hidden", "true");

    function clear() {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
    }

    function update() {
        const cssWidth = canvas.clientWidth || 0;
        const cssHeight = canvas.clientHeight || 0;
        svg.setAttribute("viewBox", `0 0 ${cssWidth} ${cssHeight}`);
        clear();

        const state = store.get();
        if (!state.focus.active || cssWidth <= 0 || cssHeight <= 0) return;

        const view = { width: cssWidth, height: cssHeight, centerX: state.view.centerX, centerY: state.view.centerY, worldPerPixel: state.view.fovLambda / cssWidth };
        const { x, y } = worldToScreen(view, state.focus.x, state.focus.y);
        const r = TARGET_MARKER_RADIUS_CSS_PX;

        svg.appendChild(svgEl("circle", { class: "target-ring", cx: x, cy: y, r }));
        svg.appendChild(svgEl("line", { class: "target-cross", x1: x - r * 0.6, y1: y, x2: x + r * 0.6, y2: y }));
        svg.appendChild(svgEl("line", { class: "target-cross", x1: x, y1: y - r * 0.6, x2: x, y2: y + r * 0.6 }));
    }

    const unsubscribe = store.subscribe(update);
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(canvas);
    update();

    return {
        element: svg,
        setHidden(hidden) {
            svg.classList.toggle("chrome-hidden", hidden);
        },
        stop() {
            unsubscribe();
            resizeObserver.disconnect();
        },
    };
}
