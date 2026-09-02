/**
 * The collapsible glass control panel: builds the DOM, groups controls into
 * Array/Excitation/Display/View sections, wires them to the state store, and
 * keeps the derived readouts (wavelength, phase step, slow-motion factor,
 * grating-lobe warning) in sync. Owns collapse (persisted to localStorage)
 * and the "hide all chrome" toggle used by the 'H' shortcut.
 */

import { MEDIA } from "../state.js";
import { wavelengthMeters, steeringPhaseStep } from "../units.js";
import { elementSpacingForArray, parabolaFocalLength } from "../geometry.js";
import {
    createSlider,
    createKnob,
    createSegmented,
    createToggle,
    createSelect,
    createReadout,
    createButton,
} from "./controls.js";

const COLLAPSE_STORAGE_KEY = "phaseArraySim.panelCollapsed";

function formatFrequency(frequencyHz) {
    if (frequencyHz >= 1e9) return `${(frequencyHz / 1e9).toFixed(2)} GHz`;
    if (frequencyHz >= 1e6) return `${(frequencyHz / 1e6).toFixed(2)} MHz`;
    if (frequencyHz >= 1e3) return `${(frequencyHz / 1e3).toFixed(2)} kHz`;
    return `${frequencyHz.toFixed(0)} Hz`;
}

function createSection(title, controls) {
    const details = document.createElement("details");
    details.open = true;
    details.className = "ctl-section";
    const summary = document.createElement("summary");
    summary.textContent = title;
    details.appendChild(summary);
    for (const control of controls) {
        details.appendChild(control instanceof Node ? control : control.element);
    }
    return details;
}

/**
 * @param {ReturnType<import("../state.js").createStateStore>} store
 * @param {{onFitArray: () => void}} callbacks
 */
export function createPanel(store, { onFitArray }) {
    const root = document.createElement("div");
    root.id = "controls";

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("h1");
    title.textContent = "Phased Array Wave Simulation";
    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "panel-collapse-btn";
    header.append(title, collapseBtn);

    const body = document.createElement("div");
    body.className = "panel-body";
    root.append(header, body);

    // ---- Array ----
    const shape = createSegmented({
        label: "Shape",
        options: [
            { value: "line", label: "Line" },
            { value: "parabola", label: "Parabola" },
            { value: "arc", label: "Arc" },
        ],
        value: store.get().array.shape,
        onChange: (v) => store.update("array.shape", v),
    });
    const elementCount = createSlider({
        label: "Element count",
        min: 1,
        max: 16,
        step: 1,
        value: store.get().array.elementCount,
        onChange: (v) => store.update("array.elementCount", Math.round(v)),
    });
    // Arc-length spacing between adjacent elements; the primary control for
    // "line" and "parabola" (their aperture is derived, per PLAN.md Q3.2).
    // "arc" derives its spacing from radius + sweep instead, so this control
    // hides for it (see updateShapeVisibility()).
    const spacing = createSlider({
        label: "Spacing",
        min: 0.1,
        max: 2.0,
        step: 0.05,
        value: store.get().array.spacingLambda,
        format: (v) => `${v.toFixed(2)} λ`,
        onChange: (v) => store.update("array.spacingLambda", v),
    });
    const curvature = createSlider({
        label: "Curvature a",
        min: 0.01,
        max: 0.3,
        step: 0.005,
        value: store.get().array.curvatureA,
        format: (v) => `${v.toFixed(3)} 1/λ`,
        onChange: (v) => store.update("array.curvatureA", v),
    });
    const focalLengthReadout = createReadout("Focal length");
    const radius = createSlider({
        label: "Radius",
        min: 1,
        max: 50,
        step: 0.5,
        value: store.get().array.radiusLambda,
        format: (v) => `${v.toFixed(1)} λ`,
        onChange: (v) => store.update("array.radiusLambda", v),
    });
    const sweep = createSlider({
        label: "Sweep angle",
        min: 5,
        max: 360,
        step: 5,
        value: store.get().array.sweepDeg,
        format: (v) => `${v.toFixed(0)}°`,
        onChange: (v) => store.update("array.sweepDeg", v),
    });

    function updateShapeVisibility(currentShape) {
        spacing.element.hidden = currentShape === "arc";
        curvature.element.hidden = currentShape !== "parabola";
        focalLengthReadout.element.hidden = currentShape !== "parabola";
        radius.element.hidden = currentShape !== "arc";
        sweep.element.hidden = currentShape !== "arc";
    }
    updateShapeVisibility(store.get().array.shape);

    const arraySection = createSection("Array", [
        shape,
        elementCount,
        spacing,
        curvature,
        focalLengthReadout,
        radius,
        sweep,
    ]);

    // ---- Excitation ----
    const steerAngle = createKnob({
        label: "Steering angle",
        min: -80,
        max: 80,
        value: store.get().excitation.steerAngleDeg,
        onChange: (v) => store.update("excitation.steerAngleDeg", v),
    });
    const medium = createSelect({
        label: "Medium",
        options: [
            { value: "air", label: "Air (343 m/s)" },
            { value: "water", label: "Water (1480 m/s)" },
            { value: "tissue", label: "Soft tissue (1540 m/s)" },
            { value: "vacuum", label: "Vacuum / light (3.0e8 m/s)" },
        ],
        value: store.get().excitation.medium,
        onChange: (v) => store.update("excitation.medium", v),
    });
    const frequency = createSlider({
        label: "Frequency",
        min: 1,
        max: 10,
        step: 0.01,
        value: Math.log10(store.get().excitation.frequencyHz),
        format: (v) => formatFrequency(Math.pow(10, v)),
        onChange: (v) => store.update("excitation.frequencyHz", Math.pow(10, v)),
    });
    const phaseStepReadout = createReadout("Phase step / element");
    const gratingLobeReadout = createReadout("Grating lobes");
    const excitationSection = createSection("Excitation", [steerAngle, medium, frequency, phaseStepReadout, gratingLobeReadout]);

    // ---- Display ----
    const mode = createSegmented({
        label: "Display mode",
        options: [
            { value: "instantaneous", label: "Instant" },
            { value: "envelope", label: "Envelope" },
            { value: "dB", label: "dB" },
        ],
        value: store.get().display.mode,
        onChange: (v) => store.update("display.mode", v),
    });
    const cycles = createSlider({
        label: "Display rate",
        min: 0,
        max: 5,
        step: 0.1,
        value: store.get().display.cyclesPerSecond,
        format: (v) => `${v.toFixed(2)} cyc/s`,
        onChange: (v) => store.update("display.cyclesPerSecond", v),
    });
    const gain = createSlider({
        label: "Gain",
        min: 0.01,
        max: 1,
        step: 0.005,
        value: store.get().display.gain,
        format: (v) => v.toFixed(3),
        onChange: (v) => store.update("display.gain", v),
    });
    const spreading = createToggle({
        label: "Spreading loss (1/√r)",
        checked: store.get().display.spreadingEnabled,
        onChange: (v) => store.update("display.spreadingEnabled", v),
    });
    const slowMotionReadout = createReadout("Slow-motion factor");
    const displaySection = createSection("Display", [mode, cycles, gain, spreading, slowMotionReadout]);

    // ---- View ----
    const renderScale = createSlider({
        label: "Render scale",
        min: 0.25,
        max: 1,
        step: 0.05,
        value: store.get().view.renderScale,
        format: (v) => v.toFixed(2),
        onChange: (v) => store.update("view.renderScale", v),
    });
    const fitButton = createButton("Fit array", onFitArray);
    const wavelengthReadout = createReadout("Wavelength");
    const spacingMetersReadout = createReadout("Element spacing");
    const hint = document.createElement("div");
    hint.className = "view-hint";
    hint.textContent = "Scroll to zoom, drag to pan, 0 resets the view, H hides this panel, space pauses, . steps a frame.";
    const viewSection = createSection("View", [renderScale, fitButton, wavelengthReadout, spacingMetersReadout, hint]);

    body.append(arraySection, excitationSection, displaySection, viewSection);

    function updateDerived() {
        const state = store.get();
        updateShapeVisibility(state.array.shape);

        const speedMps = MEDIA[state.excitation.medium];
        const wavelength = wavelengthMeters(speedMps, state.excitation.frequencyHz);
        const spacingLambda = elementSpacingForArray(state.array);
        const spacingMeters = spacingLambda * wavelength;
        const phaseStepDeg = (steeringPhaseStep(spacingLambda, state.excitation.steerAngleDeg) * 180) / Math.PI;
        const slowMotion = state.display.cyclesPerSecond > 0
            ? state.excitation.frequencyHz / state.display.cyclesPerSecond
            : Infinity;

        focalLengthReadout.setValue(`${parabolaFocalLength(state.array.curvatureA).toFixed(2)} λ`);
        wavelengthReadout.setValue(`${wavelength.toExponential(3)} m`);
        spacingMetersReadout.setValue(`${spacingMeters.toExponential(3)} m`);
        phaseStepReadout.setValue(`${phaseStepDeg.toFixed(1)}°`);
        gratingLobeReadout.setValue(spacingLambda > 0.5 ? "⚠ present (d/λ > 0.5)" : "none (d/λ ≤ 0.5)");
        slowMotionReadout.setValue(
            Number.isFinite(slowMotion) ? `slowed ${slowMotion.toExponential(2)}×` : "paused (0 cyc/s)"
        );
    }
    store.subscribe(updateDerived);
    updateDerived();

    // ---- Collapse (persisted) ----
    let collapsed = localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
    function applyCollapsed() {
        body.classList.toggle("collapsed", collapsed);
        collapseBtn.textContent = collapsed ? "+" : "−";
        collapseBtn.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
        collapseBtn.setAttribute("aria-expanded", String(!collapsed));
    }
    collapseBtn.addEventListener("click", () => {
        collapsed = !collapsed;
        localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
        applyCollapsed();
    });
    applyCollapsed();

    return {
        element: root,
        setFullyHidden(hidden) {
            root.classList.toggle("chrome-hidden", hidden);
        },
    };
}
