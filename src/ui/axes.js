/**
 * World-space axes overlay: an SVG drawn on top of the field canvas, with a
 * cross-hair through the world origin (the array's reference point -- see
 * geometry.js) and ticks labelled in physical units (mm/cm/m/...), derived
 * from the current medium and frequency the same way the panel's wavelength
 * readout is (units.js axisTickStep/formatAxisTick). Ticks are "nice" round
 * numbers, not raw wavelength multiples, and only the horizontal/vertical
 * line through the origin is drawn (no full-canvas gridlines), per PLAN.md
 * Phase 1 Q1.3/Q1.4.
 *
 * Screen positions come from worldToScreen() -- the same transform the
 * shader and the pan/zoom interaction use -- so the axes can never drift
 * from what's actually rendered.
 */

import { MEDIA } from "../state.js";
import { worldToScreen, wavelengthMeters, axisTickStep, formatAxisTick } from "../units.js";

const TICK_TARGET_PX = 90;
const TICK_LENGTH_PX = 5;
const LABEL_OFFSET_PX = 14;
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
}

/**
 * @param {HTMLCanvasElement} canvas the field canvas this overlay tracks
 * @param {ReturnType<import("../state.js").createStateStore>} store
 */
export function createAxesOverlay(canvas, store) {
    const svg = svgEl("svg", { id: "axesOverlay" });
    svg.setAttribute("aria-hidden", "true");

    function clear() {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
    }

    function addAxisLine(x1, y1, x2, y2) {
        svg.appendChild(svgEl("line", { class: "axis-line", x1, y1, x2, y2 }));
    }

    function addTickAndLabel({ tickX1, tickY1, tickX2, tickY2, labelX, labelY, anchor, text }) {
        svg.appendChild(svgEl("line", { class: "axis-tick", x1: tickX1, y1: tickY1, x2: tickX2, y2: tickY2 }));
        const label = svgEl("text", { class: "axis-label", x: labelX, y: labelY, "text-anchor": anchor });
        label.textContent = text;
        svg.appendChild(label);
    }

    function update() {
        const cssWidth = canvas.clientWidth || 0;
        const cssHeight = canvas.clientHeight || 0;
        svg.setAttribute("viewBox", `0 0 ${cssWidth} ${cssHeight}`);
        clear();
        if (cssWidth <= 0 || cssHeight <= 0) return;

        const state = store.get();
        const worldPerPixel = state.view.fovLambda / cssWidth;
        const view = { width: cssWidth, height: cssHeight, centerX: state.view.centerX, centerY: state.view.centerY, worldPerPixel };
        const metersPerLambda = wavelengthMeters(MEDIA[state.excitation.medium], state.excitation.frequencyHz);
        const { stepWorld, stepMeters, prefix } = axisTickStep(worldPerPixel, metersPerLambda, TICK_TARGET_PX);
        if (!(stepWorld > 0)) return;

        const origin = worldToScreen(view, 0, 0);
        const stepPx = stepWorld / worldPerPixel;

        if (origin.y >= 0 && origin.y <= cssHeight) {
            addAxisLine(0, origin.y, cssWidth, origin.y);
            const maxLeft = Math.ceil(origin.x / stepPx);
            const maxRight = Math.ceil((cssWidth - origin.x) / stepPx);
            for (let k = -maxLeft; k <= maxRight; k++) {
                if (k === 0) continue;
                const { x } = worldToScreen(view, k * stepWorld, 0);
                addTickAndLabel({
                    tickX1: x, tickY1: origin.y - TICK_LENGTH_PX, tickX2: x, tickY2: origin.y + TICK_LENGTH_PX,
                    labelX: x, labelY: origin.y + LABEL_OFFSET_PX, anchor: "middle",
                    text: formatAxisTick(k, stepMeters, prefix),
                });
            }
        }

        if (origin.x >= 0 && origin.x <= cssWidth) {
            addAxisLine(origin.x, 0, origin.x, cssHeight);
            const maxUp = Math.ceil(origin.y / stepPx);
            const maxDown = Math.ceil((cssHeight - origin.y) / stepPx);
            for (let k = -maxDown; k <= maxUp; k++) {
                if (k === 0) continue;
                const { y } = worldToScreen(view, 0, k * stepWorld);
                addTickAndLabel({
                    tickX1: origin.x - TICK_LENGTH_PX, tickY1: y, tickX2: origin.x + TICK_LENGTH_PX, tickY2: y,
                    labelX: origin.x + LABEL_OFFSET_PX, labelY: y, anchor: "start",
                    text: formatAxisTick(k, stepMeters, prefix),
                });
            }
        }
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
