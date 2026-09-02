import { createStateStore, MEDIA } from "./state.js";
import { startRenderer } from "./gpu.js";
import { wavelengthMeters } from "./units.js";

const store = createStateStore();

const $ = (id) => document.getElementById(id);

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

    updateDerivedReadouts();
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
    await startRenderer($("gpuCanvas"), store, { onUnsupported: showUnsupported });
}

main();
