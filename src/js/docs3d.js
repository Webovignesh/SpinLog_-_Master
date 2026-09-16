/* ==========================================================================
   SpinLog v1.7 | docs3d.js — three.js backdrop for the Documents archives cards
   --------------------------------------------------------------------------
   Animates the three historic-upload drop zones in #docs: the engine-sound
   waveform, the ridgelines, and the road. styles.css already draws all three as
   static inline-SVG scenes; this file replaces them with a live version and the
   SVG stays as the fallback.

   ONE canvas, ONE quad, THREE scissored viewports.

   The obvious build is a canvas per card, and it is the wrong one: three
   WebGLRenderers means three GL contexts, three shader compiles and three
   swap-chains for what is 180k pixels of decoration. Browsers also cap live
   contexts (~8-16) and evict the oldest, and home3d.js already holds one. So
   this follows three's multiple-elements pattern instead — a single canvas
   spanning the whole grid, with setScissor/setViewport walking the cards and
   uVariant selecting which scene the shared fragment shader draws. Three draw
   calls of one 2-triangle quad per frame.

   Because the canvas is a single rectangle behind the grid, nothing in the DOM
   clips it to each card's border radius, so the shader carries its own
   rounded-box SDF. The cards' dashed border and the ::after scrim are still
   real CSS painted on top, which is deliberate: text legibility does not depend
   on this file being correct.

   Handover to the canvas only happens after a one-time offscreen render proves
   the shader produces pixels (see verifyShader). A silently-failing program
   would otherwise hide the working CSS art behind a transparent canvas.

   Public API (window.SpinLogDocs3D):
     .isRunning() / .isEnabled() / .setEnabled(bool)
     .setAnimating(bool)   pause without handing back to CSS
     ._debug()             render stats for the harness
     .destroy()            tear down and release the GL context
   ========================================================================== */

import * as THREE from '../../vendor/three.module.min.js';

const GRID_SEL = '#docs .historic-upload-grid';
const CARD_SEL = '.drop-zone';
const CANVAS_CLASS = 'dz3d-canvas';
const LIVE_CLASS = 'dz3d-live';

// Matches the data-type attributes already on the cards in index.html.
const VARIANT = { audio: 0, image: 1, video: 2 };

// A card backdrop does not need 60fps. 40 is smooth for drifting ridges and a
// waveform, and leaves the main thread alone on a page that is mostly a long
// scrolling table.
const MIN_FRAME_MS = 1000 / 40;

const prefersReducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ── shader ──────────────────────────────────────────────────────────────── */

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform float uVariant;   // 0 waveform, 1 ridgelines, 2 road
  uniform vec2  uCardPx;    // card size in CSS px
  uniform float uRadiusPx;  // card border-radius, read from computed style
  uniform float uHover;     // 0..1, eased hover / dragover
  uniform float uReveal;    // 0..1 fade-in on handover from CSS
  uniform float uSceneMax;  // scene strength, dialled back on small cards

  varying vec2 vUv;

  /* Rounded-box SDF (Quilez). The canvas is one rectangle spanning the grid, so
     without this the scene paints square corners into each card's rounded gap. */
  float roundedBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  /* --- variant 0: Engine Sound Archives --------------------------------- */
  vec3 sceneAudio(vec2 p, float t) {
    const float BARS = 26.0;
    const float BASELINE = 0.44;

    vec3 col = vec3(0.039, 0.035, 0.031);
    float glow = 1.0 - smoothstep(0.0, 0.70,
      length((p - vec2(0.5, BASELINE)) * vec2(0.82, 1.45)));
    col += vec3(1.0, 0.49, 0.12) * glow * 0.26;

    float idx  = floor(p.x * BARS);
    float cx   = (idx + 0.5) / BARS;
    float cell = abs(p.x - cx) * BARS * 2.0;   // 0 at bar centre, 1 at cell edge

    // loudest through the middle, same envelope as the static SVG version
    float env = 1.0 - abs(idx / (BARS - 1.0) - 0.5) * 2.0;
    env = 0.30 + 0.70 * pow(max(env, 0.0), 0.65);

    /* Three incommensurate sines keyed off the BAR INDEX, not off x. Keying off
       x makes one wave travel along the row, which reads as a scrolling texture;
       per-bar phase reads as a meter responding to audio. */
    float lvl = 0.5 + 0.5 * sin(t * 2.30 + idx * 0.85);
    lvl *= 0.55 + 0.45 * sin(t * 1.37 - idx * 2.10 + 1.6);
    lvl *= 0.70 + 0.30 * sin(t * 3.10 + idx * 5.30);
    lvl = mix(0.30, 1.0, clamp(lvl, 0.0, 1.0));

    float h  = env * lvl * 0.40 * (0.88 + uHover * 0.18);
    float dy = abs(p.y - BASELINE);

    float wBar  = 1.0 - smoothstep(0.42, 0.62, cell);
    float wSpan = 1.0 - smoothstep(h - 0.008, h + 0.008, dy);

    // bright at the top of the bar, dark at the foot
    float up = clamp((BASELINE + h - p.y) / max(h * 2.0, 1e-4), 0.0, 1.0);
    col = mix(col, mix(vec3(0.36, 0.12, 0.0), vec3(1.0, 0.78, 0.60), up), wBar * wSpan);

    // lit cap on both tips
    col += vec3(1.0, 0.85, 0.66) * wBar * exp(-abs(dy - h) * 90.0) * 0.35;
    return col;
  }

  /* --- variant 1: Historic Images ---------------------------------------- */
  float ridge(float x, float s) {
    return sin(x *  3.10 + s)       * 0.50
         + sin(x *  7.30 + s * 2.1) * 0.26
         + sin(x * 13.70 + s * 3.7) * 0.12;
  }

  vec3 sceneRidges(vec2 p, float t) {
    const float HZ = 0.52;

    vec3 col = mix(vec3(0.043, 0.043, 0.055), vec3(0.286, 0.125, 0.035),
                   smoothstep(0.0, HZ, p.y));
    float pulse = 0.92 + 0.08 * sin(t * 0.45);
    float glow = 1.0 - smoothstep(0.0, 0.60 * pulse,
      length((p - vec2(0.52, HZ)) * vec2(0.78, 1.55)));
    col += vec3(1.0, 0.745, 0.47) * glow * 0.55;

    /* Drifting cloud bands over the lit sky. This is the load-bearing motion in
       this scene, and the reason is worth stating: the ridges are large FLAT DARK
       shapes, and translating dark over dark changes no pixel values at all — only
       their thin silhouette edges register. Measured, faster parallax alone moved
       the card by 2.6/255. Clouds move a big, warm, mid-luminance area, which is
       what actually reads as motion behind the scrim. Two layers at different
       speeds so it does not look like one sliding stripe. */
    float sky = 1.0 - smoothstep(0.30, 1.00, p.y / max(HZ, 1e-4));
    float c1 = sin((p.x * 3.4 - t * 0.20) * 3.14159265) * 0.5 + 0.5;
    float c2 = sin((p.x * 6.1 + t * 0.13) * 3.14159265 + 1.3) * 0.5 + 0.5;
    col += vec3(1.0, 0.60, 0.28) * pow(c1 * 0.65 + c2 * 0.35, 2.2) * sky * 0.22;

    /* Three ranges panning at DIFFERENT speeds — the parallax is the animation.
       Panning them together just slides a texture sideways; the speed spread is
       what reads as a camera moving through a landscape. Far range slowest.

       Speeds were originally 0.010/0.024/0.038 and that was a mistake worth
       recording: measured on the composed page, one second of it changed the
       card by a mean of 1.0/255 across 2.9% of pixels, which is invisible. The
       scene is only ~72% opaque under a darkening scrim, so slow parallax has
       almost no contrast left to move. These are ~4x faster. */
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      /* Horizontal pan plus a vertical bob. The bob matters more than it looks:
         these ridgelines are near-horizontal, so sliding them sideways barely
         moves the silhouette edge, while lifting them moves a long high-contrast
         boundary across many pixels. */
      float y = HZ - 0.02 + fi * 0.105
              + sin(t * (0.38 + fi * 0.22) + fi * 1.7) * 0.016
              - ridge((p.x + t * (0.045 + fi * 0.048)) * (1.5 + fi * 0.9), fi * 4.7)
                * (0.150 - fi * 0.038);
      vec3 rock = mix(vec3(0.200, 0.106, 0.071), vec3(0.055, 0.032, 0.025), fi * 0.5);
      col = mix(col, rock, smoothstep(y - 0.0035, y + 0.0035, p.y));
      col += vec3(1.0, 0.635, 0.33) * exp(-abs(p.y - y) * 200.0) * (0.32 - fi * 0.09);
    }

    /* A warm light sweeping across the ridges. Sine-driven rather than fract() so
       it reverses smoothly instead of snapping back at the wrap. */
    float sweep = exp(-pow((p.x - (0.5 + 0.42 * sin(t * 0.42))) * 2.1, 2.0));
    col += vec3(1.0, 0.66, 0.34) * sweep * 0.17
         * (1.0 - smoothstep(HZ - 0.02, HZ + 0.30, p.y));
    return col;
  }

  /* --- variant 2: Historic Videos ---------------------------------------- */
  vec3 sceneRoad(vec2 p, float t) {
    const float HZ = 0.37;

    vec3 col = mix(vec3(0.043, 0.043, 0.055), vec3(0.320, 0.137, 0.035),
                   smoothstep(0.0, HZ, p.y));
    float glow = 1.0 - smoothstep(0.0, 0.50,
      length((p - vec2(0.56, HZ)) * vec2(0.78, 1.70)));
    col += vec3(1.0, 0.753, 0.478) * glow * 0.60;

    // Same reasoning as the ridges card: cloud bands carry the area, the road
    // surface carries the direction.
    float sky = 1.0 - smoothstep(0.25, 1.00, p.y / max(HZ, 1e-4));
    float c1 = sin((p.x * 3.0 - t * 0.24) * 3.14159265) * 0.5 + 0.5;
    float c2 = sin((p.x * 5.7 + t * 0.16) * 3.14159265 + 0.8) * 0.5 + 0.5;
    col += vec3(1.0, 0.62, 0.30) * pow(c1 * 0.6 + c2 * 0.4, 2.2) * sky * 0.20;

    // treeline pans the opposite way to the dashes, so the frame reads as moving
    float tx = p.x + t * 0.075;
    float top = HZ - 0.085
      - (sin(tx * 9.0) * 0.5 + sin(tx * 21.0) * 0.28 + sin(tx * 37.0) * 0.14) * 0.05;
    col = mix(col, vec3(0.075, 0.047, 0.031), smoothstep(top - 0.004, top + 0.004, p.y));

    // the ribbon: centreline sweeps up to the right, narrowing as it recedes
    float x      = clamp(p.x, 0.0, 1.0);
    float centre = 0.74 - pow(x, 1.30) * 0.40;
    float halfW  = 0.115 * (1.0 - x * 0.84);
    float dr     = abs(p.y - centre);
    float road   = 1.0 - smoothstep(halfW - 0.006, halfW + 0.006, dr);

    col = mix(col, mix(vec3(0.145, 0.125, 0.102), vec3(0.569, 0.478, 0.392), x), road);
    col += vec3(1.0, 0.69, 0.40) * road * exp(-abs(dr - halfW) * 120.0) * 0.30;

    /* Dashes running toward the viewer. Phase is +t, so a fixed feature keeps
       x * K + t constant and therefore x DECREASES over time — toward the wide
       near end at x=0. Negate it and the card reads as driving in reverse.
       Rate was 0.42, which moved the dashes about 0.08 of the card per second —
       measurably present and visually not. This is a road, so the dashes are the
       whole point; at 1.55 they stream. */
    float rate = 1.55 + uHover * 0.85;
    float ph = fract(x * 5.5 + t * rate);
    float dash = smoothstep(0.02, 0.10, ph) * (1.0 - smoothstep(0.44, 0.52, ph));
    float onCentre = 1.0 - smoothstep(halfW * 0.10, halfW * 0.28, dr);
    col += vec3(1.0, 0.80, 0.58) * dash * onCentre * road * 0.62;

    /* Light banding scrolling down the whole road surface. The dashes alone are
       a ~3px-wide strip, so however fast they run they change almost no pixels;
       this carries the same motion across the full width of the tarmac, which is
       what actually reads as travelling. */
    float band = fract(x * 7.0 + t * rate * 0.62);
    float bandTex = smoothstep(0.0, 0.40, band) * (1.0 - smoothstep(0.55, 1.0, band));
    col += vec3(1.0, 0.74, 0.48) * bandTex * road * 0.13
         * (1.0 - dr / max(halfW, 1e-4) * 0.45);

    return col;
  }

  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y);   // y down, 0 = card top

    vec3 scene;
    if (uVariant < 0.5)      scene = sceneAudio(p, uTime);
    else if (uVariant < 1.5) scene = sceneRidges(p, uTime);
    else                     scene = sceneRoad(p, uTime);

    /* Card fill, standing in for the CSS gradient that dz3d-live turns off
       (linear-gradient(155deg, rgba(25,25,25,.98), rgba(7,7,7,.98))). */
    vec3 base = mix(vec3(0.098), vec3(0.027), clamp(p.y * 0.85 + p.x * 0.15, 0.0, 1.0));

    /* Same top-weighted dissolve as the CSS mask-image: the body copy and the
       format pill sit low in the card. styles.css keeps its ::after scrim over
       this canvas, so readability does not rest on this one line. */
    float sceneA = (1.0 - smoothstep(0.44, 0.98, p.y)) * (uSceneMax + uHover * 0.20);
    vec3 col = mix(base, scene, clamp(sceneA, 0.0, 1.0));

    float d = roundedBox((vUv - 0.5) * uCardPx, uCardPx * 0.5, uRadiusPx);
    float a = (1.0 - smoothstep(-1.0, 0.5, d)) * uReveal;

    // three's WebGLRenderer is premultiplied-alpha by default
    gl_FragColor = vec4(col * a, a);
  }
`;

/* ── scene ───────────────────────────────────────────────────────────────── */

function createScene(grid) {
  const cardEls = Array.from(grid.querySelectorAll(CARD_SEL));
  if (!cardEls.length) return null;

  const canvas = document.createElement('canvas');
  canvas.className = CANVAS_CLASS;
  canvas.setAttribute('aria-hidden', 'true');
  // First child so the cards, which come after it in DOM order, paint on top.
  grid.insertBefore(canvas, grid.firstChild);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: true, powerPreference: 'low-power',
    });
  } catch (err) {
    console.warn('[SpinLog Docs3D] WebGL unavailable; keeping the CSS scenes.', err);
    canvas.remove();
    return null;
  }

  const compact = window.innerWidth < 900;
  const quality = {
    /* The shader antialiases its own edges with smoothstep, so there is nothing
       for extra samples to resolve — this is a gradient field, not geometry.
       Capping at/below 1 device pixel per CSS pixel keeps the whole pass around
       200k fragments on desktop. */
    dprCap: compact ? 0.85 : 1.0,
  };

  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  // Each card is a separate scissored pass; a per-pass clear would wipe the
  // previous card. The whole canvas is cleared once per frame in update().
  renderer.autoClear = false;

  const uniforms = {
    uTime: { value: 0 },
    uVariant: { value: 0 },
    uCardPx: { value: new THREE.Vector2(1, 1) },
    uRadiusPx: { value: 24 },
    uHover: { value: 0 },
    uReveal: { value: 0 },
    uSceneMax: { value: 0.72 },
  };

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(geometry, material));

  const cards = cardEls.map(el => ({
    el,
    variant: VARIANT[el.dataset.type] ?? 1,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    radius: 24,
    hover: 0,
    hoverTarget: 0,
  }));

  const onEnter = (c) => () => { c.hoverTarget = 1; };
  const onLeave = (c) => () => { c.hoverTarget = 0; };
  cards.forEach(c => {
    c._enter = onEnter(c);
    c._leave = onLeave(c);
    c.el.addEventListener('pointerenter', c._enter, { passive: true });
    c.el.addEventListener('pointerleave', c._leave, { passive: true });
  });

  const state = {
    renderer, scene, camera, geometry, material, uniforms, canvas, cards, quality,
    reveal: 0,
    gridH: 1,
    verified: false,
  };

  /* Rects are measured here and NOT in the frame loop. getBoundingClientRect on
     three cards every frame forces a style+layout flush, which is exactly the
     scroll cost this page is already careful about. They are relative to the
     grid, so scrolling cannot invalidate them — only a resize or reflow can,
     and a ResizeObserver covers that. */
  state.layout = () => {
    const g = grid.getBoundingClientRect();
    if (g.width < 1 || g.height < 1) return false;   // section still hidden

    const dpr = Math.min(window.devicePixelRatio || 1, state.quality.dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(g.width, g.height, false);
    state.gridH = g.height;

    /* Match the 760px breakpoint where styles.css drops --dz-scene-opacity to
       .44 for the static scenes. Without this the scene visibly JUMPS brighter
       mid-crossfade on a phone, because the canvas would come in at desktop
       strength over a card that was deliberately calmer. Read from the viewport,
       not the grid, so it tracks the media query rather than approximating it. */
    uniforms.uSceneMax.value = window.innerWidth <= 760 ? 0.50 : 0.72;

    for (const c of state.cards) {
      const r = c.el.getBoundingClientRect();
      c.rect = {
        x: r.left - g.left,
        // WebGL viewports are bottom-origin; the DOM is top-origin.
        y: g.height - (r.top - g.top) - r.height,
        w: r.width,
        h: r.height,
      };
      const radius = parseFloat(getComputedStyle(c.el).borderTopLeftRadius);
      c.radius = Number.isFinite(radius) ? radius : 24;
    }
    return true;
  };

  state.update = (t, dt) => {
    if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + Math.max(dt, 0.016) * 2.2);

    // Full-canvas clear must happen with the scissor OFF, or it only clears the
    // last card's box and the other two accumulate.
    renderer.setScissorTest(false);
    renderer.clear(true, false, false);
    renderer.setScissorTest(true);

    for (const c of state.cards) {
      const { x, y, w, h } = c.rect;
      if (w < 1 || h < 1) continue;

      const target = c.el.classList.contains('dragover') ? 1 : c.hoverTarget;
      c.hover += (target - c.hover) * Math.min(1, dt * 7);

      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);

      uniforms.uTime.value = t;
      uniforms.uVariant.value = c.variant;
      uniforms.uCardPx.value.set(w, h);
      uniforms.uRadiusPx.value = c.radius;
      uniforms.uHover.value = c.hover;
      uniforms.uReveal.value = state.reveal;

      renderer.render(scene, camera);
    }

    renderer.setScissorTest(false);
  };

  /* Prove the shader actually produces pixels before we hide the working CSS
     art. A material whose program fails to link leaves a perfectly valid
     renderer that draws nothing, and that would show as three empty cards.

     This renders one 8x8 frame into an OFFSCREEN RENDER TARGET and reads that
     back. The first version of this check read the default framebuffer instead,
     which was a real bug: a default-framebuffer readback is only valid before
     the frame is composited, so on a real GPU it can legitimately come back as
     zeroes even though the canvas is drawing correctly. The check then called
     die() and pinned the card backdrop to the CSS fallback for the rest of the
     session — the safety net causing the failure it was meant to catch. It
     passed under SwiftShader, which is why it survived the first review.
     A framebuffer object has no such constraint: readRenderTargetPixels is
     defined at any time.

     uRadiusPx is forced to 0 for the probe, otherwise the corner SDF would mask
     an 8x8 quad down to nothing and every device would look like a failure. */
  state.verifyShader = () => {
    let target = null;
    const saved = {
      cardPx: uniforms.uCardPx.value.clone(),
      radius: uniforms.uRadiusPx.value,
      reveal: uniforms.uReveal.value,
      variant: uniforms.uVariant.value,
      time: uniforms.uTime.value,
    };
    try {
      target = new THREE.WebGLRenderTarget(8, 8);
      uniforms.uCardPx.value.set(8, 8);
      uniforms.uRadiusPx.value = 0;
      uniforms.uReveal.value = 1;
      uniforms.uVariant.value = 1;   // ridges: has a lit sky, so RGB is non-zero
      uniforms.uTime.value = 1;

      const prevScissor = renderer.getScissorTest();
      renderer.setScissorTest(false);
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);

      const px = new Uint8Array(8 * 8 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 8, 8, px);

      renderer.setRenderTarget(null);
      renderer.setScissorTest(prevScissor);

      let maxAlpha = 0, maxRgb = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > maxAlpha) maxAlpha = px[i + 3];
        maxRgb = Math.max(maxRgb, px[i], px[i + 1], px[i + 2]);
      }
      state.verifyPixels = { maxAlpha, maxRgb };
      return maxAlpha > 200 && maxRgb > 2;
    } catch (err) {
      console.warn('[SpinLog Docs3D] Shader verification threw.', err);
      return false;
    } finally {
      target?.dispose();
      uniforms.uCardPx.value.copy(saved.cardPx);
      uniforms.uRadiusPx.value = saved.radius;
      uniforms.uReveal.value = saved.reveal;
      uniforms.uVariant.value = saved.variant;
      uniforms.uTime.value = saved.time;
    }
  };

  state.dispose = () => {
    state.cards.forEach(c => {
      c.el.removeEventListener('pointerenter', c._enter);
      c.el.removeEventListener('pointerleave', c._leave);
    });
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    canvas.remove();
  };

  // Run the probe once, here, rather than mid-flight in the render loop. If the
  // shader cannot draw we never touch the DOM classes at all, so the CSS scenes
  // simply stay up and nothing flickers.
  if (!state.verifyShader()) {
    console.warn('[SpinLog Docs3D] Shader produced no pixels; keeping the CSS scenes.',
      state.verifyPixels);
    state.dispose();
    return null;
  }

  return state;
}

/* ── controller ──────────────────────────────────────────────────────────── */

function boot() {
  const grid = document.querySelector(GRID_SEL);
  if (!grid) return;

  let state = null;
  let raf = 0;
  let running = false;
  let enabled = true;
  let visible = false;
  let lastFrame = 0;
  let elapsed = 0;
  let slowFrames = 0;
  let downgraded = false;
  let dead = false;

  /* Reduced motion: never boot WebGL, and tear it down if the setting is turned
     on later. home3d.js takes the opposite line and paints one static frame,
     because there the backdrop is a PHOTOGRAPH with no CSS equivalent, so
     skipping it would mean never seeing the image at all. Here styles.css
     already draws these same three scenes as static SVG — that IS the still
     frame, and it is what the user is looking at before this file loads.
     Spinning up a GL context to redraw it identically would be pure cost. */
  let reduced = prefersReducedMotion();

  /** Hand back to the CSS scenes and stay there. */
  function die(reason) {
    if (reason) console.warn('[SpinLog Docs3D]', reason);
    dead = true;
    stop();
    grid.classList.remove(LIVE_CLASS);
    state?.dispose();
    state = null;
  }

  function downgrade() {
    if (downgraded || !state) return;
    downgraded = true;
    state.quality.dprCap *= 0.7;
    state.layout();
    console.info('[SpinLog Docs3D] Reduced backdrop quality to keep frames smooth.');
  }

  /* One frame's worth of work, with no scheduling in it. Split out from frame()
     so the harness can drive identical steps without depending on rAF, which
     fires only a handful of times in headless Chrome. */
  function step(dt) {
    elapsed += dt;
    state.update(elapsed, dt);

    /* Hand over on the first real frame. The shader was already proven to draw
       during createScene, so there is nothing left to wait for and no reason to
       gate this on the reveal ramp — the CSS opacity transition on .dz3d-canvas
       does the visible crossfade. */
    if (!state.verified) {
      state.verified = true;
      grid.classList.add(LIVE_CLASS);
      console.info('[SpinLog Docs3D] Animated backdrop live.');
    }
  }

  function frame(now) {
    if (!running || !state) return;
    raf = requestAnimationFrame(frame);
    if (now - lastFrame < MIN_FRAME_MS) return;

    const deltaMs = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    const dt = Math.min(deltaMs, 100) / 1000;

    if (deltaMs > 48 && elapsed > 2) {
      if (++slowFrames > 24) downgrade();
    } else if (slowFrames > 0) slowFrames--;

    try {
      step(dt);
    } catch (err) {
      die('Render failed, restoring the CSS scenes.');
    }
  }

  function ensureScene() {
    if (dead) return false;
    if (state) return true;
    state = createScene(grid);
    if (!state) { dead = true; return false; }
    state.canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      die('WebGL context lost.');
    }, { once: true });
    // layout() can legitimately fail here if #docs is still display:none; the
    // scene is kept and the ResizeObserver retries once the grid gets a box.
    state.layout();
    return true;
  }

  function start() {
    if (running || dead || reduced || !enabled || !visible) return;
    if (!ensureScene()) return;
    if (!state.layout()) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ── listeners ── */

  /* Visibility, not the router, drives this. #docs is display:none when
     inactive, so a zero-size intersection already covers navigation, and the
     observer additionally stops the loop when the grid scrolls off a long
     Documents page — which a router hook would not. Nothing in script.js
     needs to know this file exists. */
  /** Straight geometry check, used as a backstop for the observer. */
  function looksOnScreen() {
    const r = grid.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return r.bottom > -120 && r.top < (window.innerHeight || 0) + 120;
  }

  if ('IntersectionObserver' in window) {
    let delivered = false;
    new IntersectionObserver((entries) => {
      delivered = true;
      visible = entries.some(e => e.isIntersecting);
      if (visible) start(); else stop();
    }, { rootMargin: '120px 0px' }).observe(grid);

    /* Backstop. The observer is the right tool and normally fires immediately
       with the initial state, but if it never delivers, the backdrop would sit
       silently on the CSS fallback with no way to tell from the outside. Checking
       the geometry once costs one layout read at startup. */
    setTimeout(() => {
      if (delivered || dead || running) return;
      console.warn('[SpinLog Docs3D] IntersectionObserver never reported; using a geometry check.');
      if (looksOnScreen()) { visible = true; start(); }
    }, 1200);
  } else {
    visible = true;
    start();
  }

  if ('ResizeObserver' in window) {
    let timer = 0;
    new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!state) return;
        state.layout();
        // Section just became visible, or the grid reflowed while paused.
        if (!running) start();
      }, 120);
    }).observe(grid);
  }

  window.addEventListener('orientationchange', () => {
    setTimeout(() => state?.layout(), 220);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  window.SpinLogDocs3D = {
    isRunning: () => running,
    isEnabled: () => enabled,
    setAnimating(on) {
      if (on) { start(); return running; }
      stop();
      return running;
    },
    setEnabled(on) {
      enabled = !!on;
      if (enabled) start();
      else { stop(); grid.classList.remove(LIVE_CLASS); }
      return enabled;
    },
    /** Harness: drive the visibility gate directly. IntersectionObserver does
     *  not deliver reliably under headless virtual time, which would otherwise
     *  leave every WebGL path — including the failure path — untestable. */
    _forceVisible(on) {
      visible = !!on;
      if (visible) start(); else stop();
      return { visible, running, dead, live: grid.classList.contains(LIVE_CLASS) };
    },

    /** Harness: run n real frame steps synchronously. requestAnimationFrame
     *  fires only a few times in headless Chrome, so waiting on it cannot get
     *  the reveal ramp or the go-live check to run. This drives the same step()
     *  the render loop uses. */
    _pump(n, dt) {
      if (!state) return { error: 'no scene' };
      const count = Math.max(1, Math.min(600, n | 0));
      const delta = typeof dt === 'number' ? dt : 0.025;
      let ran = 0;
      for (let i = 0; i < count; i++) {
        if (!state || dead) break;
        try { step(delta); ran++; }
        catch (err) { return { error: String(err), ran }; }
      }
      return {
        ran,
        elapsed: Number(elapsed.toFixed(3)),
        reveal: state ? Number(state.reveal.toFixed(3)) : null,
        live: grid.classList.contains(LIVE_CLASS),
        dead,
      };
    },

    /** Harness: render one frame at an explicit shader time and check-sum a
     *  horizontal strip of each card. Proves the scenes respond to uTime, and
     *  that the three cards genuinely differ, without depending on wall-clock
     *  timing — rAF does not advance under a virtual-time budget. */
    _probeFrame(t) {
      if (!state) return null;
      const saved = state.reveal;
      state.reveal = 1;
      try {
        state.update(Number(t), 0.025);
      } catch (err) {
        state.reveal = saved;
        return { error: String(err) };
      }
      const gl = state.renderer.getContext();
      const dpr = state.renderer.getPixelRatio();
      const rows = state.cards.map(c => {
        const w = Math.max(1, Math.floor(c.rect.w * dpr) - 2);
        const buf = new Uint8Array(w * 4);
        gl.readPixels(
          Math.floor(c.rect.x * dpr) + 1,
          Math.floor((c.rect.y + c.rect.h * 0.62) * dpr),
          w, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf
        );
        let sum = 0, alpha = 0;
        for (let i = 0; i < buf.length; i += 4) {
          sum += buf[i] + buf[i + 1] * 3 + buf[i + 2] * 7;
          alpha += buf[i + 3];
        }
        return { type: c.el.dataset.type, sum, alphaMean: Math.round(alpha / w) };
      });
      state.reveal = saved;
      return rows;
    },

    /** Harness: render one frame at an explicit shader time and return the whole
     *  canvas as a PNG data URL. toDataURL is valid here only because it runs in
     *  the same task as the draw — the context is not preserveDrawingBuffer. */
    _snapshot(t) {
      if (!state) return null;
      const saved = state.reveal;
      state.reveal = 1;
      try {
        state.update(Number(t), 0.025);
        return state.canvas.toDataURL('image/png');
      } catch (err) {
        return null;
      } finally {
        state.reveal = saved;
      }
    },

    /** One-line answer to "why can't I see it?", for the console. */
    _why() {
      if (reduced) return 'OS reduce-motion is on, so WebGL is deliberately not started.';
      if (dead) return 'WebGL unavailable or the shader drew nothing; showing the CSS scenes.';
      if (!enabled) return 'Disabled via setEnabled(false).';
      if (!visible) return 'The archives grid is not on screen yet (open Documents and scroll to it).';
      if (!state) return 'Scene not created yet.';
      if (!grid.classList.contains(LIVE_CLASS)) return 'Scene built but not handed over yet.';
      if (!running) return 'Live, but the loop is paused (tab hidden or scrolled away).';
      return 'Live and animating.';
    },

    _debug() {
      if (!state) return { live: false, dead, reduced, visible, enabled, why: this._why() };
      const info = state.renderer.info.render;
      return {
        live: grid.classList.contains(LIVE_CLASS),
        running,
        dead,
        calls: info.calls,
        frame: info.frame,
        triangles: info.triangles,
        dpr: state.renderer.getPixelRatio(),
        reveal: Number(state.reveal.toFixed(2)),
        elapsed: Number(elapsed.toFixed(2)),
        verifyPixels: state.verifyPixels,
        why: this._why(),
        cards: state.cards.map(c => ({
          type: c.el.dataset.type,
          variant: c.variant,
          rect: [Math.round(c.rect.x), Math.round(c.rect.y),
                 Math.round(c.rect.w), Math.round(c.rect.h)],
          radius: c.radius,
          hover: Number(c.hover.toFixed(2)),
        })),
        downgraded,
      };
    },
    destroy() {
      stop();
      grid.classList.remove(LIVE_CLASS);
      state?.dispose();
      state = null;
      dead = true;
    },
  };

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq) {
    const onChange = () => {
      reduced = mq.matches;
      if (!reduced) { start(); return; }
      // Give the cards back to CSS rather than freezing a GL frame over them.
      stop();
      grid.classList.remove(LIVE_CLASS);
      state?.dispose();
      state = null;
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
} catch (err) {
  console.warn('[SpinLog Docs3D] Backdrop failed to initialise.', err);
}
