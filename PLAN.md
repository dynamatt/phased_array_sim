# PLAN.md — phased_array_sim

Staged work plan. Read `CLAUDE.md` first. **Ask the open questions at the top of
each phase before writing that phase's code.**

Phases are ordered so each one rests on the last. Do not start a phase before
its predecessor is verified working.

---

## Phase 0 — Refactor and foundations

No new features. The goal is that the app looks and behaves as it does now
(minus the listed bugs) but on an architecture that can carry Phases 1–4.

**Tasks**
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

**Open questions — ask before starting**
- **Q0.1 — Domain.** The variables say "antenna" but the constant is the speed
  of sound in tissue. Should the sim present as acoustic (ultrasound / air
  acoustics), electromagnetic (RF antennas), or domain-neutral with a
  selectable medium (air 343, water 1480, soft tissue 1540, vacuum 3e8 m/s)?
  Neutral-with-a-medium-picker is the recommendation; confirm.
- **Q0.2 — Spreading loss.** The current shader sums `sin()` with no `1/r`
  decay, so distant regions look as bright as near ones. Add `1/sqrt(r)`
  (correct for 2D cylindrical spreading, and this *is* a 2D slice), add `1/r`
  (correct for 3D point sources viewed in a plane), or keep it off with a
  toggle? Recommendation: `1/sqrt(r)` on by default, toggleable, because it
  makes the focal gain at a clicked target visibly correct.
- **Q0.3 — Inline the shader?** Inlining `field.wgsl` as a JS template literal
  removes the `fetch()` and lets the app run from `file://` with no server at
  all. Costs syntax highlighting in the `.wgsl` file. Worth it?
- **Q0.4 — MAX_ELEMENTS.** 256 assumed. Higher? The per-pixel cost is linear in
  element count, so 256 elements at 4K is the performance ceiling case.

---

## Phase 1 — Fullscreen canvas

**Tasks**
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

**Open questions**
- **Q1.1 — Pan and zoom.** Should the view be navigable at all in this phase?
  If yes, the bindings must not collide with Phase 4's click-to-target. Suggested:
  wheel = zoom about cursor, drag = pan, plain click = set target, `0` = reset
  view. Alternative: no navigation, fixed field of view set by a slider.
  Which?
- **Q1.2 — Array framing on resize.** When the window changes shape, should the
  view hold constant world width (array can overflow vertically) or auto-fit
  the array plus a margin? Suggested: constant world width, with an "fit array"
  button.

---

## Phase 2 — Collapsible glass control panel

**Tasks**
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

**Open questions**
- **Q2.1 — Corner and behaviour.** Which corner? Should the panel be draggable
  and resizable, or fixed?
- **Q2.2 — Readouts placement.** Keep derived readouts inside the panel, or put
  a slim always-visible status strip along one edge so the numbers stay legible
  when the panel is collapsed?
- **Q2.3 — Colour direction.** Current field colouring is a single cyan-ish
  ramp. For signed amplitude a diverging map (blue↔black↔amber, or a proper
  perceptually uniform pair) reads much better, and dB mode wants something
  like inferno. Any aesthetic preference, or free choice?

---

## Phase 3 — Configurable array shape

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

**Tasks**
1. Implement `layoutElements` with tests: element count exact, centroid at
   origin, spacing correct, line case matches the pre-existing positions,
   parabola focal length matches the analytic value.
2. Segmented control for shape; parameter sliders swap with the shape.
3. Uniform phase steering must still work for every shape (for a curved array,
   apply the linear phase gradient along the arc-length coordinate).

**Open questions**
- **Q3.1 — Spacing convention on curves.** For parabola and arc, should
  elements be spaced equally in **arc length** along the curve (physically the
  right thing, needs a small numeric integration for the parabola), equally in
  `x`, or equally in the parameter? Recommendation: arc length. Confirm.
- **Q3.2 — Parametrisation.** Should the user set element **count + spacing**
  (aperture is derived), or **count + aperture** (spacing derived)? The second
  is nicer when comparing shapes at constant aperture. Which, or both with a
  lock toggle?
- **Q3.3 — Element directivity.** Elements are currently isotropic point
  sources. For arcs past 180° and for parabolas, isotropic elements radiate
  backwards too, which muddies the picture. Add optional `cos^n(θ)` directivity
  about the local outward normal (default off)? For a ring array this is the
  difference between a clean focus and a mess.
- **Q3.4 — Amplitude taper.** The storage buffer reserves a per-element weight.
  Expose apodisation windows (uniform / Hamming / Blackman / Taylor) now, or
  leave the hook for later? It's cheap to add and demonstrates the sidelobe /
  beamwidth trade-off very clearly.

---

## Phase 4 — Clickable target (focusing)

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

**Tasks**
1. `focus.js`: `phasesForTarget(elements, targetWorld) -> Float32Array`. Pure,
   tested. Include the parabola test from `CLAUDE.md` §8: targeting the
   geometric focus of `y = ax²` must yield near-uniform phases.
2. Pointer handling on the canvas: screen → world via `units.js` (**the same
   transform the shader uses** — this is where a bug would hide), set target,
   recompute phases, rewrite the storage buffer.
3. Drag to move the target live; the field should follow at 60 fps. The phase
   recompute is O(N) on the CPU — trivial.
4. Render a target marker (crosshair / ring) at fixed pixel size.
5. Clear the target (`Esc`, or a panel button) to return to steering mode.

**Open questions**
- **Q4.1 — Mode interaction.** When a target is set, what happens to the
  steering-angle knob? Options: (a) it's disabled and greyed with the derived
  equivalent angle shown; (b) it becomes an additional phase offset applied on
  top; (c) moving it clears the target. Recommendation: (a).
- **Q4.2 — Multiple targets.** Should clicking add a second focal point
  (multi-focus, phases from the summed complex weights) or always replace?
  Replace is the simple version; multi-focus is a genuinely interesting demo
  but needs a defined combining rule. Which for v1?
- **Q4.3 — Phase quantisation.** Expose an N-bit phase shifter quantisation
  control (2/3/4/6 bit) to show quantisation lobes? Real hardware behaviour,
  ~5 lines, very illustrative. Now or later?
- **Q4.4 — Targets behind the array.** Should clicking on the back side of the
  array be allowed, refused, or allowed with a warning? Depends on the answer
  to Q3.3.

---

## Later / parked

Not in scope now; listed so the architecture doesn't foreclose them.

- Beam pattern plot (far-field `|A(θ)|` in dB) as a small polar inset.
- Shareable permalinks: serialise state to the URL hash. No server needed.
- Obstacles / reflecting boundaries — a large step, would need a different
  solver (FDTD), and would break the closed-form per-pixel evaluation.
- Element failure simulation (kill random elements, watch sidelobes rise).
- Time-domain pulse excitation rather than continuous wave.
- Amplitude taper / apodisation windows (uniform / Hamming / Blackman /
  Taylor) — Q3.4, deferred out of Phase 3. The storage buffer already
  reserves a per-element weight (`w`, currently always 1.0) for this, so
  it's cheap to add later: compute per-element weights from the window
  function in `geometry.js` or a new pure module, write them into the `w`
  slot `gpu.js` already packs. Good demo of the sidelobe/beamwidth trade-off.
