# CLAUDE.md — phased_array_sim

Context and working agreement for Claude Code on this repository.

---

## 1. What this project is

A real-time, browser-based phased array wave-field simulator. A WebGPU fragment
shader evaluates the superposed field from N radiating elements at every pixel,
every frame. It is a **teaching and intuition tool**, not a solver: no meshing,
no boundaries, no scattering, no attenuation. Free-space superposition of
monochromatic point sources only.

Deployed as a static site on GitHub Pages.

---

## 2. Hard constraints — do not violate

1. **No server, no build step.** The site must run by opening `index.html`
   served as static files from GitHub Pages. Native ES modules only. No
   bundler, no transpiler, no npm install required to view or deploy.
2. **Ask before adding any external library or CDN dependency.** Default answer
   is no. Vanilla JS + CSS + WGSL is the baseline. If you believe a dependency
   genuinely earns its place, stop and ask, with the specific alternative you'd
   otherwise hand-roll and roughly how much code it saves.
3. **Ask when an implementation detail is ambiguous.** Do not silently guess at
   physics conventions, units, UI behaviour, or interaction design. A wrong
   guess here is expensive to unwind. Batch your questions where you can, but
   ask before writing the code, not after. See `PLAN.md` for the open questions
   already identified.
4. **No secrets, no analytics, no network calls at runtime** beyond fetching
   the app's own static assets.
5. **Everything must keep running at 60 fps** on a mid-range laptop GPU at full
   screen. If a feature can't, say so before building it.

---

## 3. Current state (as of the initial refactor)

Three files, ~225 lines total:

| File | Role |
|---|---|
| `index.html` | Markup, inline CSS, a stack of `<input type=range>` sliders |
| `app.js` | WebGPU setup, DOM wiring, render loop — all in one function |
| `app.wgsl` | Fullscreen-triangle vertex shader + field-evaluating fragment shader |

### Known issues to fix during the refactor

- `app.wgsl` **hardcodes the canvas size as 800.0** to normalise `fragCoord`.
  Any resize silently breaks the coordinate mapping.
- **The frequency slider does not affect the spatial wavelength.** The shader
  fixes `wavelength = 1.0` in normalised units and only uses `frequency` in
  `ωt`. So frequency changes the animation speed and nothing else, while the
  UI displays a "Wavelength: 38.50 m" readout derived from `c/f`. The
  displayed physical units and the simulated field are currently disconnected.
  Section 5 defines the intended model.
- Terminology is mixed: variables say `antenna`, but `speedOfSound = 1540.0`
  is the speed of sound in soft tissue. Pick one domain (see open questions).
- Amplitude is normalised by `antennaCount`, which hides array gain — exactly
  the thing a focusing feature should make visible.
- `alert()` on unsupported browsers. Replace with an in-page fallback message.
- No `devicePixelRatio` handling, no resize handling, no device-lost handling.
- Element marker radius (`0.02`) is in world units, so it changes apparent size
  with zoom. Markers should be a fixed pixel size.
- `app.js` reads slider DOM values inside the render loop. State should be read
  from a state object; the DOM should write to that object, not be queried by
  the hot path.

---

## 4. Target architecture

Keep it flat and small. This is a ~1500 line project, not an application
framework. Resist layering for its own sake.

```
index.html            canvas + panel markup, module entry
src/
  main.js             bootstrap: create state, gpu, ui, start loop
  gpu.js              device/context/pipeline/buffers, resize, render loop
  state.js            single source of truth + change notification
  geometry.js         array shape -> element positions (PURE, no DOM, no GPU)
  focus.js            target point -> per-element phases (PURE)
  units.js            world <-> screen transforms, frequency/wavelength maths
  ui/panel.js         collapsible glass panel, control construction + binding
  ui/controls.js      reusable custom controls (slider, knob, segmented)
shaders/
  field.wgsl          the field shader
tests/
  *.test.js           node --test, pure modules only
```

**Rules that matter more than the file layout:**

- `geometry.js`, `focus.js` and `units.js` are **pure**: plain functions, no
  DOM, no GPU, no globals. They are the parts worth testing and the parts most
  likely to contain a physics bug.
- **The world↔screen transform lives in exactly one place** (`units.js`) and is
  mirrored in the shader from the *same* uniform values. If the JS inverse
  transform and the shader forward transform ever drift, the clickable-target
  feature will place antinodes in the wrong spot and it will be maddening to
  debug. Write a test that round-trips screen→world→screen.
- The render loop reads a **snapshot of state**, not the DOM.
- Uniform buffer packing: keep the WGSL struct definition and the JS packing
  code adjacent, with a comment block giving byte offsets. Respect WGSL uniform
  alignment (`vec2f` → 8, `vec3f`/`vec4f` → 16, structs → 16). Getting this
  silently wrong produces plausible-but-wrong output, so add an assertion on
  the computed size.

---

## 5. Physics and units model — read this before touching the shader

This is the resolution to "real units, but still real time".

### 5.1 The key fact

The spatial interference pattern depends **only** on dimensionless ratios:
element spacing in wavelengths (`d/λ`), aperture in wavelengths, target range in
wavelengths, and the element phases in radians. It does **not** depend on the
absolute frequency. A 40 kHz ultrasound array in air and a 2.4 GHz patch array
produce the identical pattern if `d/λ` and the phases match.

Therefore:

> **Internal simulation units are wavelengths (space) and radians (phase).
> Real-world units are a presentation layer computed on top.**

### 5.2 Space

- World coordinate unit = **1 wavelength (λ)**. Wave number `k = 2π` exactly.
- Origin at the array centroid (configurable later), `+y` up, `+x` right.
- View state: `{ centerX, centerY, worldPerPixel }`, with the visible height
  derived from the canvas aspect ratio. **Never assume a square canvas.**
- Physical readouts: user picks a medium speed `c` and a frequency `f`;
  `λ = c/f`; a "field of view: 0.42 m" style readout is then derived. Changing
  `f` changes only the labels, never the pattern — which is the correct and
  instructive behaviour, and the opposite of what the code does today.

### 5.3 Time

Running at a true 2 MHz would alias catastrophically at 60 fps. Do not scale
time by an arbitrary "slow motion" factor. Instead, specify the **on-screen
animation rate directly**:

- User control: `displayCyclesPerSecond` (default ~0.5 Hz, range 0–5).
- Shader phase term: `ωt` where `ω = 2π · displayCyclesPerSecond` and `t` is
  wall-clock seconds. At 0.5 cyc/s and 60 fps that's 120 samples per cycle —
  smooth, never aliased, at any nominal physical frequency.
- Display the implied slow-motion factor (`f / displayCyclesPerSecond`, e.g.
  "slowed 4 000 000×") so the relationship stays honest and visible.
- Accumulate time as `t += dt` with a paused/step capability, rather than
  `Date.now() - startTime`, so pause and single-step work.

### 5.4 Phase and steering

- Element phases are stored in **radians**, one per element, wrapped to
  `[-π, π)`. This is frequency-independent by construction.
- The user-facing steering control should be a **beam angle θ in degrees**, not
  a raw phase step. For a uniform line array,
  `Δφ = -2π · (d/λ) · sin θ`.
  This is the "angular units, independent of frequency" behaviour requested:
  θ stays meaningful when `f` or `d` change, whereas a raw phase step does not.
  Expose the resulting `Δφ` as a read-only derived readout.
- Warn in the UI when `d/λ > 0.5` (grating lobes) and when the requested θ is
  unreachable for the current spacing.

### 5.5 Field evaluation

Evaluate the **complex phasor sum** per pixel, then derive the display from it:

```
A = Σ_i  (w_i / sqrt(r_i))  ·  exp(i·(−k·r_i + φ_i))       // 2D cylindrical spreading
instantaneous = Re( A · exp(−i·ω_display·t) )
envelope      = |A|
intensity_dB  = 20·log10(|A| / A_ref)
```

One evaluation, three display modes, no extra cost. Note the current code has
no `1/sqrt(r)` spreading term — decide whether to add it (see open questions).
Guard `r → 0` with a small epsilon.

Amplitude normalisation should use a **fixed reference plus a manual gain
control**, not division by N, so that array gain and focal gain are visible.

---

## 6. Conventions

- Modern JS: `const`/`let`, ES modules, `async/await`. No classes unless there
  is real state to encapsulate. No TypeScript (it would need a build step), but
  use JSDoc type annotations on exported functions in the pure modules.
- 4-space indent, double quotes, semicolons — matching the existing files.
- Names: prefer `element` over `antenna` (the sim is domain-neutral). Suffix
  variables with their unit when it isn't obvious: `spacingLambda`,
  `steerAngleDeg`, `phaseRad`, `rangeMeters`.
- Comments explain *why* and cite the physics; they should not narrate the code.
  Delete the numbered tutorial comments (`// 1. Check if...`) during refactor.
- CSS: custom properties for the palette in `:root`. No CSS framework.
- WGSL: keep the fragment shader readable. Prefer a couple of small helper
  functions over one long `fragment_main`.

---

## 7. Working agreement

- **One concern per commit**, with a message explaining the change. Do not mix
  a refactor with a behaviour change — land the refactor first, verify the
  output is pixel-identical (modulo the intended fixes), then build on it.
- **Verify before claiming done.** After each phase, confirm: resizes cleanly
  including window→fullscreen→window, no console errors, no WGSL validation
  warnings, still 60 fps at full screen, controls all still wired.
- **Ask, don't assume.** See constraint 3 and the open questions in `PLAN.md`.
- If you find a physics error in existing code, flag it explicitly rather than
  quietly fixing it — Matt will want to know what was wrong and why.
- Keep `README.md` current: it still tells the user to run
  `python3 -m http.server 8000`, which should become optional-for-development
  guidance alongside the live GitHub Pages URL.

---

## 8. Running and testing

- **Local dev:** `python3 -m http.server 8000`, then `http://localhost:8000`.
  A server is currently required only because `app.js` fetches `app.wgsl`.
  (Open question: inline the WGSL so `file://` works too.)
- **Browser support:** WebGPU. Chrome/Edge 113+, Safari 18+, Firefox 141+.
  Detect and show a clear in-page message otherwise, not an `alert()`.
- **Tests:** `node --test tests/` — built into Node, no dependencies. Cover
  `geometry.js`, `focus.js`, `units.js` only. Do not attempt to test the GPU
  path.
- **Manual check for the focusing feature:** place the target at the geometric
  focus of a parabolic array (`f = 1/(4a)` for `y = ax²`). The computed phases
  should come out very nearly uniform. That is a free, strong correctness
  check — build it into the test suite as an assertion.
