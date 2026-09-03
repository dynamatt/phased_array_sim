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
        help: "The array's geometry. Line: elements in a row, steered by a linear phase gradient. Parabola: elements on y = a·x² — the classic dish/reflector shape, which naturally brings parallel waves to a single focus. Arc: elements on a circular arc of a given radius and sweep, like a bowl or fan array.",
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
        help: "How many point sources are summed at every pixel. More elements narrow the main beam and lower the sidelobes, at a roughly linear rendering cost.",
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
        help: "Distance between adjacent elements, in wavelengths (d/λ) — the number that actually controls the interference pattern, independent of any real frequency. Keep d/λ ≤ 0.5 to avoid grating lobes: extra full-strength beams at other angles, the spatial-aliasing counterpart of the sampling theorem.",
        min: 0.1,
        max: 2.0,
        step: 0.05,
        value: store.get().array.spacingLambda,
        format: (v) => `${v.toFixed(2)} λ`,
        onChange: (v) => store.update("array.spacingLambda", v),
    });
    const curvature = createSlider({
        label: "Curvature a",
        help: "Coefficient in y = a·x² (units 1/λ): how tightly the parabola bends. Its geometric focus sits at f = 1/(4a), shown below — a real parabolic reflector equalises the path length from every element to that point.",
        min: 0.01,
        max: 0.3,
        step: 0.005,
        value: store.get().array.curvatureA,
        format: (v) => `${v.toFixed(3)} 1/λ`,
        onChange: (v) => store.update("array.curvatureA", v),
    });
    const focalLengthReadout = createReadout(
        "Focal length",
        "Where y = a·x² geometrically focuses parallel incoming waves (f = 1/(4a), in wavelengths). Phase 4's clickable target will let you check this: aiming at this point should come out needing almost no per-element phase correction."
    );
    const radius = createSlider({
        label: "Radius",
        help: "Distance from the arc's centre of curvature to each element, in wavelengths.",
        min: 1,
        max: 50,
        step: 0.5,
        value: store.get().array.radiusLambda,
        format: (v) => `${v.toFixed(1)} λ`,
        onChange: (v) => store.update("array.radiusLambda", v),
    });
    const sweep = createSlider({
        label: "Sweep angle",
        help: "How much of the circle the elements span. 360° closes the arc into a full ring array.",
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
        help: "Beam direction off boresight (0° = straight ahead). The panel derives the phase delay each element needs to advance by (Δφ = −2π·(d/λ)·sinθ, shown below) so every wavefront arrives in step in that direction — the core trick that makes it a *phased* array rather than a plain broadcast.",
        min: -80,
        max: 80,
        value: store.get().excitation.steerAngleDeg,
        onChange: (v) => store.update("excitation.steerAngleDeg", v),
    });
    const medium = createSelect({
        label: "Medium",
        help: "The wave's propagation speed c. Combined with frequency it sets the physical wavelength (λ = c/f) used only to convert the simulation's internal wavelength units into real-world distances — it never changes the interference pattern itself.",
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
        help: "Operating frequency f. Only affects unit conversions (λ = c/f, and the implied slow-motion factor below) — never the interference pattern, which depends only on spacing and phase measured in wavelengths. A real signal at this frequency would complete far more cycles per second than 60 fps could show, which is why the animation runs at a separate, much slower display rate (Display section).",
        min: 1,
        max: 10,
        step: 0.01,
        value: Math.log10(store.get().excitation.frequencyHz),
        format: (v) => formatFrequency(Math.pow(10, v)),
        onChange: (v) => store.update("excitation.frequencyHz", Math.pow(10, v)),
    });
    const phaseStepReadout = createReadout(
        "Phase step / element",
        "Δφ, the extra phase advance applied from each element to the next to steer the beam to the current angle."
    );
    const gratingLobeReadout = createReadout(
        "Grating lobes",
        "Extra copies of the main beam appearing at other angles, caused by spacing elements more than half a wavelength apart (d/λ > 0.5) — the spatial equivalent of aliasing when you sample a signal too slowly."
    );
    const excitationSection = createSection("Excitation", [steerAngle, medium, frequency, phaseStepReadout, gratingLobeReadout]);

    // ---- Display ----
    const mode = createSegmented({
        label: "Display mode",
        help: "All three modes come from the same complex sum A = Σ (wᵢ/√rᵢ)·e^{i(−k·rᵢ+φᵢ)}, just displayed differently. Instant: Re(A·e^{−iωt}), the real, animating snapshot — what a strobe would show, wave crests and troughs moving. Envelope: |A|, the time-averaged intensity with no animation — where energy actually piles up (the focal spot, main beam, sidelobes). dB: 20·log10(|A|/A_ref), the same envelope on a log scale, which reveals sidelobes sitting 20–40 dB below the peak that a linear scale hides completely.",
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
        help: "On-screen animation rate in cycles/second — not the true frequency above, which would alias badly at 60 fps. This is deliberately slow so wavefronts are visible; see the slow-motion factor below for how many times slower than real life that is.",
        min: 0,
        max: 5,
        step: 0.1,
        value: store.get().display.cyclesPerSecond,
        format: (v) => `${v.toFixed(2)} cyc/s`,
        onChange: (v) => store.update("display.cyclesPerSecond", v),
    });
    const gain = createSlider({
        label: "Gain",
        help: "Manual display brightness. Unlike dividing by element count, a fixed gain keeps array gain visible — adding elements should make the pattern brighter, which is exactly the effect a focusing array is built to produce.",
        min: 0.01,
        max: 1,
        step: 0.005,
        value: store.get().display.gain,
        format: (v) => v.toFixed(3),
        onChange: (v) => store.update("display.gain", v),
    });
    const spreading = createToggle({
        label: "Spreading loss (1/√r)",
        help: "Adds 1/√r cylindrical spreading (correct for this 2D slice through point sources), so each element's contribution fades with distance the way energy conservation requires, instead of oscillating at constant amplitude forever.",
        checked: store.get().display.spreadingEnabled,
        onChange: (v) => store.update("display.spreadingEnabled", v),
    });
    const slowMotionReadout = createReadout(
        "Slow-motion factor",
        "How many times slower the on-screen animation runs than the true wave (frequency ÷ display rate). E.g. \"slowed 2,000,000×\" means what takes one real cycle at this frequency takes 2 million on-screen cycles' worth of time to play out — necessary because the true frequency is far too fast to render frame-by-frame."
    );
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
    const wavelengthReadout = createReadout(
        "Wavelength",
        "λ = c/f for the selected medium and frequency: the real-world size of one internal simulation unit. This is a presentation-layer conversion only — the pattern itself is computed purely in wavelengths."
    );
    const spacingMetersReadout = createReadout(
        "Element spacing",
        "The Spacing slider's d/λ converted to metres using the current wavelength — the real physical distance you'd need between elements to reproduce this exact pattern at this frequency."
    );
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
