# PLAN.md — phased_array_sim

Staged work plan. Read `CLAUDE.md` first. **Ask the open questions at the top of
each phase before writing that phase's code.**

Phases are ordered so each one rests on the last. Do not start a phase before
its predecessor is verified working.

**Status: Phases 0–4 are all done.** The staged plan as originally scoped is
complete. What's left is one still-open question (Q3.3, element directivity)
and the "Later/parked" menu of optional follow-on features at the bottom —
nothing there is committed to yet.

---

## Phase 0 — Refactor and foundations — done

No new features. The goal is that the app looks and behaves as it does now
(minus the listed bugs) but on an architecture that can carry Phases 1–4.

**Tasks — all done**
1. Split into the module layout in `CLAUDE.md` §4.
2. Introduce `state.js` as the single source of truth. UI writes to it; the
   render loop reads a snapshot from it. Nothing queries the DOM per frame.
3. Introduce `units.js` with the world↔screen transform, and pass
   `resolution`, `viewCenter`, `worldPerPixel` to the shader as uniforms.
   **Delete the hardcoded `800.0`.**
4. Move element positions and phases out of the shader's inline loop and into a
   read-only storage buffer, `array<vec4f>`: `xy` = position (λ), `z` = phase
   (rad), `w` = amplitude weight (1.0 for now; hooks a future taper). Size the
   buffer once for `MAX_ELEMENTS` (suggest 256) and write the active prefix.
   The shader loops to `elementCount` from the uniform block.
5. Restructure the fragment shader to the complex-phasor form in `CLAUDE.md`
   §5.5, with a display-mode switch (instantaneous / envelope / dB).
6. Replace `alert()` with an in-page unsupported-browser panel.
7. Add `tests/` with a screen→world→screen round-trip test.

**Resolved open questions**
- **Q0.1 — Domain. RESOLVED: domain-neutral with a medium picker**, as
  recommended. `state.js` `MEDIA = {air: 343, water: 1480, tissue: 1540,
  vacuum: 299792458}`; every variable/identifier says `element`, never
  `antenna` (verified: no occurrences left anywhere in `src/`).
- **Q0.2 — Spreading loss. RESOLVED: `1/√r`, on by default, toggleable.**
  `shaders/field.wgsl` divides amplitude by `sqrt(r)` when
  `spreadingEnabled != 0u`; `display.spreadingEnabled` defaults to `true`
  with a panel toggle, exactly as recommended.
- **Q0.3 — Inline the shader? RESOLVED: no, kept as a separate file.**
  `gpu.js` still `fetch()`es `shaders/field.wgsl` at startup — a local
  server is still required (`README.md`), but the file keeps WGSL syntax
  highlighting.
- **Q0.4 — MAX_ELEMENTS. RESOLVED: 256**, as suggested (`gpu.js`
  `export const MAX_ELEMENTS = 256`).

---

## Phase 1 — Fullscreen canvas — done

**Tasks — all done**
1. Canvas fills the viewport: `position: fixed; inset: 0;` with the drawing
   buffer sized to `clientWidth × devicePixelRatio`, clamped to
   `device.limits.maxTextureDimension2D`.
2. `ResizeObserver` → reconfigure context and update the `resolution` uniform.
   Debounce reconfiguration; don't reallocate per frame.
3. **Aspect-correct world mapping.** The view is defined by a horizontal field
   of view in wavelengths; vertical extent follows from the aspect ratio.
   Nothing may assume square.
4. Add a **render scale** control (0.25–1.0) that renders to a smaller target
   and upscales, as the escape hatch for 4K / high element counts.
5. Element markers drawn at a fixed pixel radius, not a fixed world radius.
6. **World-space axes**, origin at the array's reference point (see Q1.3),
   drawn in screen space (fixed pixel line/label size, not affected by zoom
   blur). Ticks land on "nice" numbers (1/2/5 × 10ⁿ) in **physical units**,
   not wavelengths: convert the current `worldPerPixel` (λ) to metres via the
   medium's `c` and the chosen `f` (`units.js`, same conversion the λ↔metres
   readout in `CLAUDE.md` §5.2 already uses), then pick a tick spacing and SI
   prefix so labels stay single/low-digit — `1mm 2mm 3mm…` at one zoom,
   `10cm 20cm 30cm…` at another, `1m 2m 3m…` at another. Recompute the
   step+prefix on every zoom change; relabel, don't just rescale. Since this
   is frequency-dependent (`λ = c/f`), the axis labels move when `f` changes
   even though the field pattern doesn't — call that out once, near the
   frequency control, so it doesn't read as a bug.

**Resolved open questions**
- **Q1.1 — Pan and zoom. RESOLVED: navigable, as suggested.** `main.js`
  `setupViewInteraction()`: wheel = zoom about cursor, drag = pan, `0` =
  reset view. Plain click was later claimed by Phase 4's click-to-target,
  exactly the collision this question flagged in advance.
- **Q1.2 — Array framing on resize. RESOLVED: constant world width + a
  manual "Fit array" button.** `view.fovLambda` (world width) is untouched
  by resize; only the backing buffer and derived `worldPerPixel` change.
  `fitViewToArray()` in `main.js`, wired to a View-section button, is the
  manual escape hatch, as suggested.
- **Q1.3 — Origin for even element counts. RESOLVED: always the array
  centroid.** Same rule for every shape and parity; coincides with "middle
  element" whenever one exists, no shape-specific logic needed.
- **Q1.4 — Axis extent and style. RESOLVED: cross-hair ticks only.** Short
  tick marks with labels along one horizontal and one vertical line through
  the origin, not full-canvas gridlines — minimises visual interference with
  the field colouring.

---

## Phase 2 — Collapsible glass control panel — done

**Tasks — all done**
1. Panel pinned to a corner, overlaying the canvas. Translucent dark surface:
   `background: rgba(12,14,18,0.55)`, `backdrop-filter: blur(16px)`, hairline
   `1px solid rgba(255,255,255,0.10)` border, generous radius, soft shadow.
   Palette driven by CSS custom properties in `:root`, accent colour matched to
   the field colormap.
2. Collapse to a small icon button; animate height/opacity; state persisted in
   `localStorage` (allowed — it needs no server).
3. Group controls into sections: **Array**, **Excitation**, **Display**, with
   collapsible sub-sections so it doesn't become a wall of sliders.
4. Custom controls in `ui/controls.js`, hand-rolled, no libraries:
   - **Slider** — styled `input[type=range]` with a filled track, value shown in
     tabular monospace numerals, drag-to-scrub, shift-drag for fine control.
   - **Rotary knob** — small SVG dial for the steering angle. Drag to rotate,
     with the beam direction drawn on the dial. This is the control that will
     make the thing feel good to use; it's ~60 lines of SVG plus pointer events.
   - **Segmented control** — for array shape and display mode.
   - **Readout** — derived, non-editable values (λ in metres, `d/λ`, aperture,
     phase step, slow-motion factor, grating-lobe warning).
5. Keyboard: `H` hides all chrome for clean screenshots, `space` pauses time,
   `.` single-steps a frame.
6. Every control keyboard-accessible and labelled. Pointer events (not mouse
   events) so it works on a touchscreen.
7. **Educational tooltips on every control**, since the sim's whole purpose is
   building intuition for phased arrays, not just producing a picture (see
   `CLAUDE.md` §1). Priority is the **display-mode selector**
   (instantaneous / envelope / dB): each option's tooltip should say what's
   physically being shown — e.g. "Instantaneous: the real part of the field
   at this moment, `Re(A·e^{-iωt})` — what you'd see with a strobe";
   "Envelope: `|A|`, the time-averaged intensity pattern, showing focal spot
   and sidelobes without the animation"; "dB: `20·log10(|A|/A_ref)`, the same
   envelope on a log scale to reveal sidelobe levels many dB down." Extend the
   same treatment to steering angle, `d/λ`, grating-lobe warnings, slow-motion
   factor, and the parabola/arc shape params — anywhere a control encodes a
   physics concept rather than a plain UI choice.
8. Reuse one tooltip primitive (`ui/controls.js`) for all of these rather than
   ad hoc titles per control, so copy stays consistent and short.

**Resolved open questions**
- **Q2.1 — Corner and behaviour. RESOLVED: top-left, fixed.** `#controls` in
  `index.html` is `position: fixed; top: 1rem; left: 1rem`, collapsible but
  not draggable or resizable.
- **Q2.2 — Readouts placement. RESOLVED: inside the panel only.** No separate
  always-visible status strip; readouts hide along with everything else when
  the panel is collapsed.
- **Q2.3 — Colour direction. RESOLVED: diverging blue↔black↔amber for signed
  (instantaneous) values, a hand-rolled inferno approximation for magnitude
  (envelope/dB).** `shaders/field.wgsl` `colorDiverging()` / `infernoColor()`,
  matching the aesthetic sketched in the question.
- **Q2.4 — Tooltip mechanism and depth. RESOLVED: `(?)` icon, click/tap to
  expand.** A small help icon next to each control; clicking/tapping expands
  an inline sentence-plus-formula (as sketched above). Works on touch,
  doesn't clutter the panel by default.

---

## Phase 3 — Configurable array shape — done

`geometry.js` exports one pure function:

```js
/** @returns {{x:number, y:number, nx:number, ny:number}[]} positions in λ, plus local outward normal */
layoutElements(shape, params, count)
```

**Shapes**
- **Line** (current). Params: `spacingLambda`, orientation angle. Centred on the
  origin. This must reproduce today's behaviour exactly.
- **Parabola.** `y = a·x²` with `a` in units of 1/λ. Display the focal length
  `f = 1/(4a)` prominently — it's the geometric prediction the Phase 4 focusing
  can be checked against. Optionally expose `b`, `c` for the full quadratic;
  ask whether that's wanted or whether a single curvature term is cleaner.
- **Arc.** Params: radius `R` (λ), sweep angle `Δ` (0–360°), and the arc's
  centre-of-aim direction. `Δ = 0` degenerates to a point; `Δ = 360` gives a
  closed ring. Derived chord spacing `d = R·Δ/(N−1)`; surface the grating-lobe
  warning when `d > λ/2`.

**Tasks — all done**
1. Implement `layoutElements` with tests: element count exact, centroid at
   origin, spacing correct, line case matches the pre-existing positions,
   parabola focal length matches the analytic value.
2. Segmented control for shape; parameter sliders swap with the shape.
3. Uniform phase steering must still work for every shape (for a curved array,
   apply the linear phase gradient along the arc-length coordinate).

**Resolved open questions**
- **Q3.1 — Spacing convention on curves. RESOLVED: arc length**, as
  recommended, for every shape (`geometry.js`; confirmed by the
  "equally spaced by arc length" test in `tests/geometry.test.js`).
- **Q3.2 — Parametrisation. RESOLVED: count + spacing** (aperture derived),
  no lock toggle. `panel.js`'s Array section exposes `Element count` and
  `Spacing` sliders; aperture/focal-length/radius are read-only derived
  readouts.
- **Q3.4 — Amplitude taper. DEFERRED**, not exposed this pass — see
  Later/parked. The storage buffer's per-element weight slot (`w`, always
  1.0 today) is already reserved for it.

**Still open**
- **Q3.3 — Element directivity.** Elements are still isotropic point
  sources. For arcs past 180° and for parabolas, isotropic elements radiate
  backwards too, which muddies the picture. Add optional `cos^n(θ)` directivity
  about the local outward normal (default off)? For a ring array this is the
  difference between a clean focus and a mess. Also see Later/parked.

---

## Phase 4 — Clickable target (focusing) — done

**The physics.** For an antinode at target `T`, each element's contribution must
arrive in phase:

```
r_i  = |T − p_i|                       // in λ
φ_i  = wrap( +k·r_i − k·r_ref )        // k = 2π; r_ref = min_i r_i
```

i.e. advance each element by exactly the propagation delay it will incur, so
all wavefronts coincide at `T`. Subtracting `r_ref` keeps phases relative and
the numbers small. Wrap to `[−π, π)`.

**Regime note worth surfacing in the UI:** if `|T|` exceeds the Rayleigh
distance `D²/(4λ)` (D = aperture), this degenerates to plane-wave steering and
the "focus" is really just a beam direction. Display which regime the current
target is in, and the equivalent steering angle — that's the insight the
feature exists to teach.

**Tasks — all done**
1. `focus.js`: `phasesForTarget(elements, targetWorld) -> Float32Array`. Pure,
   tested. Includes the parabola test from `CLAUDE.md` §8: targeting the
   geometric focus of `y = ax²` yields near-uniform phases. Also exports
   `equivalentSteerAngleDeg` and `rayleighDistanceLambda` for the regime
   readout below.
2. Pointer handling on the canvas (`main.js` `setupViewInteraction`): screen →
   world via `units.js` (the same transform the shader uses), set target,
   recompute phases, rewrite the storage buffer (`gpu.js` `packElements`).
   **Interaction model (resolved):** a plain click (press+release under a
   5px move threshold) on empty canvas places/replaces the target (Q4.2:
   always replace); dragging elsewhere still pans, unchanged from Phase 1;
   pressing down within grab range (18px) of an existing target's marker and
   dragging moves it live instead of panning.
3. Drag to move the target live; the field follows at 60 fps (phase recompute
   is O(N) on the CPU, done directly in the pointermove handler).
4. Target marker: fixed-pixel crosshair/ring, drawn as an SVG overlay
   (`ui/target.js`), same pattern as the Phase 1 axes overlay.
5. `Esc` or the panel's "Clear target" button clears the target and returns
   to steering mode.

**Resolved open questions**
- **Q4.1 — Mode interaction. RESOLVED: (a) disable + show equivalent angle.**
  The steering knob greys out and displays `equivalentSteerAngleDeg(target)`
  while a target is active; clearing the target restores the knob's own
  stored value.
- **Q4.2 — Multiple targets. RESOLVED: always replace** (v1; single
  `focus: {active, x, y}` state slice, no multi-focus combining rule needed).
- **Q4.4 — Targets behind the array. RESOLVED: allow always, no
  special-casing.** Elements are isotropic (Q3.3 still unimplemented), so
  there's no physical "back" of the array yet to warn about.
- **Q4.3 — Phase quantisation.** Still open; deferred, not implemented this
  pass (see Later/parked).

---

## Later / parked

Not committed to yet; listed so the architecture doesn't foreclose them, and
so there's a menu to pick from rather than reinventing one each time. Roughly
ordered by recommendation, given the project's purpose is building intuition
(`CLAUDE.md` §1) rather than feature completeness.

- **Beam pattern plot** — far-field `|A(θ)|` in dB as a small polar inset.
  Top recommendation: it's the classic complementary view to the 2D field —
  sidelobe levels, beamwidth, and grating lobes all become directly legible
  in a way the field alone only hints at, and it composes with everything
  already built (steering, shape, focus, taper). No new physics needed, just
  a second render pass or a lightweight canvas-2D/SVG plot sampling the
  existing phasor-sum math at a ring of far-field angles.
- **Element directivity** (Q3.3, still open from Phase 3) — optional
  `cos^n(θ)` directivity about each element's local outward normal (default
  off). Second recommendation: elements are isotropic today, so arcs past
  180° and parabolas radiate backwards too, muddying the picture; this is
  also the prerequisite for Q4.4 (targets behind the array) to become a real
  question rather than a moot one.
- **Amplitude taper / apodisation windows** (uniform / Hamming / Blackman /
  Taylor) — Q3.4, deferred out of Phase 3. The storage buffer already
  reserves a per-element weight (`w`, currently always 1.0) for this, so
  it's cheap to add: compute per-element weights from the window function in
  `geometry.js` or a new pure module, write them into the `w` slot `gpu.js`
  already packs. Good demo of the sidelobe/beamwidth trade-off.
- **Phase quantisation** (Q4.3, deferred out of Phase 4) — an N-bit phase
  shifter control (2/3/4/6 bit) that rounds each element's phase to the
  nearest quantisation step before writing it to the storage buffer, to show
  quantisation lobes. Real hardware behaviour, cheap to add (rounds
  `phasesForTarget`'s or the steering phase's output).
- **Multi-focus targeting** (Q4.2's non-chosen option) — sum the complex
  per-target weights so multiple clicks add focal points instead of
  replacing. Needs a defined combining rule and a way to select/clear one of
  several targets; parked in favour of the v1 single-target model.
- Shareable permalinks: serialise state to the URL hash. No server needed.
- Element failure simulation (kill random elements, watch sidelobes rise).
- Time-domain pulse excitation rather than continuous wave.
- Obstacles / reflecting boundaries — a large step, would need a different
  solver (FDTD), and would break the closed-form per-pixel evaluation. Likely
  permanently out of scope per `CLAUDE.md` §1 ("no meshing, no boundaries, no
  scattering").
