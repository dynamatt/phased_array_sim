/**
 * Hand-rolled, dependency-free UI controls: a styled slider, a rotary knob,
 * a segmented control, a toggle, a select, a readout, and a button. All use
 * pointer events (not mouse events) so they work on touch, and are keyboard
 * accessible. Each factory returns { element, setValue? }; `element` is a
 * plain DOM node the caller appends wherever it likes.
 */

let idCounter = 0;
function nextId(prefix) {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}

function createLabelRow(labelText) {
    const row = document.createElement("div");
    row.className = "ctl-label";
    const text = document.createElement("span");
    text.textContent = labelText;
    const value = document.createElement("span");
    value.className = "ctl-value";
    row.append(text, value);
    return { row, value };
}

/**
 * @param {{label:string, min:number, max:number, step:number, value:number, format?:(v:number)=>string, onChange:(v:number)=>void}} opts
 */
export function createSlider(opts) {
    const { label, min, max, step, value, format = (v) => String(v), onChange } = opts;
    const id = nextId("slider");

    const wrap = document.createElement("div");
    wrap.className = "ctl-slider";

    const { row: labelRow, value: valueText } = createLabelRow(label);
    labelRow.id = `${id}-label`;

    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.setAttribute("aria-labelledby", `${id}-label`);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = "ctl-range";

    function updateFill(v) {
        const pct = ((v - min) / (max - min)) * 100;
        input.style.setProperty("--fill", `${pct}%`);
    }

    function setValue(v, { silent = false } = {}) {
        const clamped = Math.min(max, Math.max(min, v));
        input.value = String(clamped);
        valueText.textContent = format(clamped);
        updateFill(clamped);
        if (!silent) onChange(clamped);
    }

    input.addEventListener("input", () => setValue(parseFloat(input.value)));

    // Shift-drag fine control: hold Shift while dragging to move at 1/10 the
    // normal step instead of the native track-jump/step behaviour.
    let fineStartX = null;
    let fineStartValue = null;
    input.addEventListener("pointerdown", (event) => {
        if (!event.shiftKey) return;
        event.preventDefault();
        fineStartX = event.clientX;
        fineStartValue = parseFloat(input.value);
        input.setPointerCapture(event.pointerId);
    });
    input.addEventListener("pointermove", (event) => {
        if (fineStartX === null) return;
        const fineStep = step / 10;
        const proposed = fineStartValue + (event.clientX - fineStartX) * fineStep;
        setValue(Math.round(proposed / fineStep) * fineStep);
    });
    const endFineDrag = () => {
        fineStartX = null;
        fineStartValue = null;
    };
    input.addEventListener("pointerup", endFineDrag);
    input.addEventListener("pointercancel", endFineDrag);

    setValue(value, { silent: true });
    wrap.append(labelRow, input);
    return { element: wrap, setValue };
}

/**
 * A small SVG dial. Value range [min, max] maps onto a 270deg arc (leaving a
 * gap at the bottom, like a real gimbal's mechanical stop), with 0deg
 * pointing straight up.
 * @param {{label:string, min:number, max:number, value:number, format?:(v:number)=>string, onChange:(v:number)=>void}} opts
 */
export function createKnob(opts) {
    const { label, min, max, value, format = (v) => `${v.toFixed(0)}°`, onChange } = opts;
    const size = 68;
    const center = size / 2;
    const radius = size / 2 - 8;
    const DIAL_SPAN_DEG = 270;

    const wrap = document.createElement("div");
    wrap.className = "ctl-knob";
    const { row: labelRow, value: valueText } = createLabelRow(label);

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.classList.add("ctl-knob-dial");
    svg.tabIndex = 0;
    svg.setAttribute("role", "slider");
    svg.setAttribute("aria-label", label);
    svg.setAttribute("aria-valuemin", String(min));
    svg.setAttribute("aria-valuemax", String(max));

    const ring = document.createElementNS(svgNS, "circle");
    ring.setAttribute("cx", String(center));
    ring.setAttribute("cy", String(center));
    ring.setAttribute("r", String(radius));
    ring.classList.add("ctl-knob-ring");

    const zeroTick = document.createElementNS(svgNS, "line");
    zeroTick.setAttribute("x1", String(center));
    zeroTick.setAttribute("y1", String(center - radius + 2));
    zeroTick.setAttribute("x2", String(center));
    zeroTick.setAttribute("y2", String(center - radius + 6));
    zeroTick.classList.add("ctl-knob-tick");

    const needle = document.createElementNS(svgNS, "line");
    needle.setAttribute("x1", String(center));
    needle.setAttribute("y1", String(center));
    needle.classList.add("ctl-knob-needle");

    svg.append(ring, zeroTick, needle);

    function valueToDialDeg(v) {
        const t = (v - min) / (max - min);
        return -DIAL_SPAN_DEG / 2 + t * DIAL_SPAN_DEG;
    }

    function render(v) {
        const dialRad = (valueToDialDeg(v) * Math.PI) / 180;
        needle.setAttribute("x2", String(center + radius * Math.sin(dialRad)));
        needle.setAttribute("y2", String(center - radius * Math.cos(dialRad)));
        valueText.textContent = format(v);
        svg.setAttribute("aria-valuenow", String(v));
    }

    let current = value;
    function setValue(v, { silent = false } = {}) {
        current = Math.min(max, Math.max(min, v));
        render(current);
        if (!silent) onChange(current);
    }

    function dialDegFromPointer(event) {
        const rect = svg.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        return (Math.atan2(dx, -dy) * 180) / Math.PI;
    }

    function valueFromDialDeg(deg) {
        const clampedDeg = Math.min(DIAL_SPAN_DEG / 2, Math.max(-DIAL_SPAN_DEG / 2, deg));
        return min + ((clampedDeg + DIAL_SPAN_DEG / 2) / DIAL_SPAN_DEG) * (max - min);
    }

    let dragging = false;
    svg.addEventListener("pointerdown", (event) => {
        dragging = true;
        svg.setPointerCapture(event.pointerId);
        setValue(valueFromDialDeg(dialDegFromPointer(event)));
    });
    svg.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        setValue(valueFromDialDeg(dialDegFromPointer(event)));
    });
    const endDrag = () => { dragging = false; };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);

    svg.addEventListener("keydown", (event) => {
        const stepDeg = event.shiftKey ? 1 : 5;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            setValue(current - stepDeg);
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            setValue(current + stepDeg);
        }
    });

    render(current);
    wrap.append(labelRow, svg);
    return { element: wrap, setValue };
}

/**
 * @param {{label?:string, options:{value:string,label:string}[], value:string, onChange:(v:string)=>void}} opts
 */
export function createSegmented(opts) {
    const { label, options, value, onChange } = opts;
    const wrap = document.createElement("div");
    wrap.className = "ctl-segmented";

    if (label) {
        const labelEl = document.createElement("div");
        labelEl.className = "ctl-label";
        labelEl.textContent = label;
        wrap.appendChild(labelEl);
    }

    const row = document.createElement("div");
    row.className = "ctl-segmented-row";
    row.setAttribute("role", "radiogroup");
    if (label) row.setAttribute("aria-label", label);

    const buttons = new Map();
    function setValue(v, { silent = false } = {}) {
        for (const [optValue, btn] of buttons) {
            const selected = optValue === v;
            btn.classList.toggle("selected", selected);
            btn.setAttribute("aria-checked", String(selected));
        }
        if (!silent) onChange(v);
    }

    for (const opt of options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = opt.label;
        btn.className = "ctl-segmented-btn";
        btn.setAttribute("role", "radio");
        btn.addEventListener("click", () => setValue(opt.value));
        buttons.set(opt.value, btn);
        row.appendChild(btn);
    }

    setValue(value, { silent: true });
    wrap.appendChild(row);
    return { element: wrap, setValue };
}

/**
 * @param {{label:string, checked:boolean, onChange:(v:boolean)=>void}} opts
 */
export function createToggle(opts) {
    const { label, checked, onChange } = opts;
    const id = nextId("toggle");

    const wrap = document.createElement("label");
    wrap.className = "ctl-toggle";
    wrap.setAttribute("for", id);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = checked;
    input.addEventListener("input", () => onChange(input.checked));

    const text = document.createElement("span");
    text.textContent = label;

    wrap.append(input, text);

    function setValue(v, { silent = false } = {}) {
        input.checked = v;
        if (!silent) onChange(v);
    }
    return { element: wrap, setValue };
}

/**
 * @param {{label:string, options:{value:string,label:string}[], value:string, onChange:(v:string)=>void}} opts
 */
export function createSelect(opts) {
    const { label, options, value, onChange } = opts;
    const id = nextId("select");

    const wrap = document.createElement("div");
    wrap.className = "ctl-select";

    const labelEl = document.createElement("label");
    labelEl.setAttribute("for", id);
    labelEl.textContent = label;

    const select = document.createElement("select");
    select.id = id;
    for (const opt of options) {
        const optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        if (opt.value === value) optionEl.selected = true;
        select.appendChild(optionEl);
    }
    select.addEventListener("input", () => onChange(select.value));

    wrap.append(labelEl, select);
    return { element: wrap, setValue: (v) => { select.value = v; } };
}

/** A read-only label/value pair for derived quantities. */
export function createReadout(label) {
    const wrap = document.createElement("div");
    wrap.className = "ctl-readout";
    const labelEl = document.createElement("span");
    labelEl.className = "ctl-readout-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "ctl-readout-value";
    wrap.append(labelEl, valueEl);
    return { element: wrap, setValue: (text) => { valueEl.textContent = text; } };
}

/** @param {string} label @param {() => void} onClick */
export function createButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ctl-button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return { element: button };
}
