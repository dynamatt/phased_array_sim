/**
 * Single source of truth for UI-driven simulation state, plus change
 * notification. UI controls write to this store; the render loop reads a
 * snapshot from it (see gpu.js) instead of querying the DOM per frame.
 */

/** Propagation speed by medium, in metres/second. */
export const MEDIA = {
    air: 343,
    water: 1480,
    tissue: 1540,
    vacuum: 299792458,
};

/** Display-mode name -> the u32 the shader switches on. Keep in sync with shaders/field.wgsl. */
export const DISPLAY_MODES = {
    instantaneous: 0,
    envelope: 1,
    dB: 2,
};

/** The view the '0' reset shortcut and initial load use. */
export const DEFAULT_VIEW = {
    centerX: 0,
    centerY: 0,
    fovLambda: 12,
};

function createInitialState() {
    return {
        array: {
            shape: "line",
            elementCount: 8,
            spacingLambda: 0.5,
        },
        excitation: {
            phaseStepRad: 0,
            medium: "tissue",
            frequencyHz: 1e6,
        },
        display: {
            mode: "instantaneous",
            cyclesPerSecond: 0.5,
            gain: 0.15,
            spreadingEnabled: true,
            paused: false,
            timeSeconds: 0,
        },
        view: {
            centerX: DEFAULT_VIEW.centerX,
            centerY: DEFAULT_VIEW.centerY,
            fovLambda: DEFAULT_VIEW.fovLambda,
            renderScale: 1,
        },
    };
}

/**
 * @returns {{get: () => object, update: (path: string, value: unknown) => void, subscribe: (fn: (state: object) => void) => () => void}}
 */
export function createStateStore() {
    const state = createInitialState();
    const listeners = new Set();

    function notify() {
        for (const listener of listeners) listener(state);
    }

    return {
        get: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        /** @param {string} path dot-separated, e.g. "array.elementCount" */
        update(path, value) {
            const keys = path.split(".");
            let obj = state;
            for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
            obj[keys[keys.length - 1]] = value;
            notify();
        },
    };
}
