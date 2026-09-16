/* ==========================================================================
   SpinLog v1.7 | home3d.js — three.js site backdrop
   --------------------------------------------------------------------------
   One canvas, two passes, one render loop:

     1. Background pass (orthographic fullscreen quad)
        Imgs/bike-bg.webp driven through a fragment shader: cover-fit, a slow
        breathing zoom, pointer and scroll parallax, a faint heat shimmer, a
        warm grade, and a vignette that keeps the page content readable. This
        is the site background — the CSS gradient underneath is the fallback.

     2. Ember pass (perspective points)
        A drifting spark field layered over the photo. All motion lives in the
        vertex shader, so the loop does no per-particle CPU work.

   Strictly decorative. Every failure path ends in `is-dead` on the canvas and
   the CSS gradient takes over, so the page never depends on this file.

   Public API (window.SpinLog3D):
     .isRunning() / .isEnabled() / .setEnabled(bool)
     ._debug()   render stats, used by the test harness
     .destroy()  tear down and release the GL context
   ========================================================================== */

import * as THREE from '../../vendor/three.module.min.js';

const CANVAS_ID = 'dkScene';
// Note the deliberate asymmetry with the import above: an ES module specifier
// resolves against THIS file's URL (src/js/), but BG_URL is handed to
// THREE.TextureLoader, which resolves it against the *document* base URL
// (the site root). Both point at the same tree from different origins.
const BG_URL = './assets/img/bike-bg.webp';

const EMBER_A = 0xfb6900;
const EMBER_B = 0xffb000;

const prefersReducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ── background pass ─────────────────────────────────────────────────────── */

const BG_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BG_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D uTex;
  uniform vec2  uRes;      // canvas size in px
  uniform vec2  uTexRes;   // texture size in px
  uniform float uTime;
  uniform vec2  uPointer;  // -1..1, eased
  uniform float uScroll;   // 0..1
  uniform float uReveal;   // 0..1 fade-in once the texture has decoded
  uniform float uFrost;    // 0 plain photo .. 1 full frosted glass
  uniform float uLod;      // mip bias for the frost taps
  uniform float uMotion;   // 0 disables the animated parts

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  /* Value noise. Used for three different things at three different scales:
     the crystal refraction that warps the lookup, and the sparkle. */
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /* Frosted-glass diffusion: a 12-tap golden-angle disc, sampled from a mip
     level rather than the full-resolution image.

     sqrt() on the radius spreads the taps evenly over the disc AREA instead of
     bunching them at the centre.

     Division of labour matters here. The WIDE part of the diffusion comes from
     the mip bias, not from the taps: a mip level is an exact box average of its
     whole neighbourhood, so it is smooth by construction and costs one fetch.
     The taps then only have to dissolve mip blockiness, which is a SHORT
     distance, and 8 taps over ~one mip texel is dense enough for that.

     The sample pattern is FIXED, not rotated per pixel. A per-pixel hash
     rotation is the standard trick for hiding ring artefacts in a sparse disc
     blur, and it was actively wrong here: with only 8 taps, neighbouring pixels
     average completely different sample sets, so the rotation converts ring
     error into per-pixel variance. Over the high-gradient sunset band that
     showed up as harsh salt-and-pepper noise heavy enough to erase the bike.
     With the mip carrying the wide average there is no ring error left to hide,
     so the dither is pure downside. */
  vec3 frostSample(vec2 uv, vec2 rad, float lod) {
    const float GOLDEN_ANGLE = 2.39996323;
    const float TAPS = 8.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float fi = float(i) + 0.5;
      float a = GOLDEN_ANGLE * fi;
      vec2 off = vec2(cos(a), sin(a)) * sqrt(fi / TAPS);
      sum += texture2D(uTex, clamp(uv + off * rad, vec2(0.002), vec2(0.998)), lod).rgb;
    }
    return sum / TAPS;
  }

  void main() {
    float screenAspect = uRes.x / max(uRes.y, 1.0);
    float imageAspect  = uTexRes.x / max(uTexRes.y, 1.0);

    /* object-fit: cover, done in the shader so it survives any viewport.
       fit is the fraction of the texture each axis samples, so it must MULTIPLY
       the centred UV. Dividing by it (as this did) is contain with the sign
       flipped: on a 1440x900 screen that was a harmless 5% overscan, but on a
       390x844 phone fit.x is 0.26, so dividing spread the UV over 0.5 +/- 1.92
       and every pixel outside the texture clamped to its edge column. The phone
       backdrop was a smear of one column of pixels. */
    vec2 fit = (screenAspect > imageAspect)
      ? vec2(1.0, imageAspect / screenAspect)
      : vec2(screenAspect / imageAspect, 1.0);

    /* Reframe toward the sun instead of the geometric centre.
       The shot is a night scene whose left third is near-black sky and hillside,
       and that black third is exactly what a centred cover-fit put in the page
       gutters — the only place the backdrop is ever unobstructed. Measured, the
       canvas contributed +0.000 luminance there.
       Biasing the sample window to (0.72, 0.42) keeps the sun, the ridgeline and
       the wet-road reflections. It is expressed as a window centre rather than
       an extra zoom so that portrait viewports, which already crop hard, get the
       reframing for free without any further upscaling. */
    const vec2 anchor = vec2(0.72, 0.42);
    float zoom = 1.25 + sin(uTime * 0.06) * 0.02 * uMotion;

    vec2 halfWin = 0.5 * fit / zoom;
    // keep the window inside the texture, leaving a little room for parallax
    vec2 lo = min(halfWin + 0.04, vec2(0.5));
    vec2 hi = max(1.0 - halfWin - 0.04, vec2(0.5));
    vec2 centre = clamp(anchor, lo, hi);
    vec2 uv = (vUv - 0.5) * fit / zoom + centre;

    // parallax: pointer pushes against the movement, scrolling drifts down
    uv += vec2(-uPointer.x, uPointer.y) * 0.014 * uMotion;
    uv.y += uScroll * 0.055;

    /* --- Frost -----------------------------------------------------------
       Aspect-corrected noise space, so the crystal texture is not stretched on
       wide viewports. */
    vec2 nUv = vUv * vec2(max(screenAspect, 1.0), 1.0);

    /* uv is in texture space, and the cover fit plus zoom mean one screen pixel
       is (fit / zoom / uRes) of it. Converting through that factor keeps both
       the refraction and the blur radius measured in SCREEN pixels, so the
       frost looks identical on a phone and on a 1600px desktop instead of
       scaling with the crop. */
    vec2 toUv = fit / zoom / uRes;

    // crystal refraction: two noise scales, replacing the old heat shimmer.
    // A slow drift keeps it alive; uMotion freezes it for reduced motion.
    float w1 = vnoise(nUv *  7.0 + uTime * 0.020 * uMotion);
    float w2 = vnoise(nUv * 23.0 - uTime * 0.015 * uMotion);
    uv += (vec2(w1, w2) - 0.5) * 9.0 * uFrost * toUv;

    /* The mip bias supplies the wide diffusion; the 9px tap radius only has to
       cover roughly one mip texel to dissolve its blockiness.
       Both scale with uFrost so uFrost = 0 is a genuinely sharp photo —
       otherwise the "no frost" state still reads a blurred mip and there is no
       honest baseline to measure the effect against. */
    vec3 col = frostSample(uv, 9.0 * uFrost * toUv, uLod * uFrost);

    // Part-desaturate and warm-grade. The old values here (0.5 desat, gamma
    // 1.3, exposure 0.34, 0.8 vignette) drove a mid-grey down to ~0.03 — the
    // photo was technically rendering and technically invisible. body now
    // carries a translucent scrim that handles legibility, so this pass no
    // longer has to crush the image to protect the text on top of it.
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 0.62);
    col *= vec3(1.10, 0.95, 0.80);
    col = pow(max(col, 0.0), vec3(1.08));
    col *= 1.45;

    // Gentle vignette only. A strong one is counterproductive here: the cards
    // already cover the middle, so the edges are the only place the backdrop is
    // ever seen and darkening them hides the whole effect.
    float d = length((vUv - 0.5) * vec2(max(screenAspect, 1.0), 1.0));
    col *= 1.0 - smoothstep(0.72, 1.45, d) * 0.26;

    // warm lift in the top-left, matching the CSS gradient it replaces
    float glow = 1.0 - smoothstep(0.0, 0.85, length((vUv - vec2(0.1, 0.92)) * vec2(1.0, 1.6)));
    col += vec3(0.10, 0.038, 0.0) * glow;

    /* Light scattering through the frost. Blur alone reads as "out of focus";
       what makes it read as frozen glass is that bright regions bleed a cool
       haze and the whole thing picks up a faint crystalline sparkle. Both are
       gated on luminance so the dark corners stay dark. */
    float lit = smoothstep(0.04, 0.50, dot(col, vec3(0.299, 0.587, 0.114)));
    col += vec3(0.030, 0.042, 0.064) * lit * uFrost;

    /* Crystal glints. These have to be LOW frequency: at 190 cells across the
       frame the cells landed at ~4 buffer pixels, and since the backdrop renders
       below 1 device pixel per CSS pixel the browser's upscale turned them into
       dense blocky salt-and-pepper that swamped the photo entirely. 46 cells is
       ~30px per crystal, which survives the upscale and actually reads as frost.
       Sparse and faint on purpose — this is a texture hint, not a snow filter. */
    float sparkle = vnoise(nUv * 46.0);
    sparkle = pow(max(sparkle - 0.80, 0.0) / 0.20, 2.0);
    col += vec3(0.55, 0.62, 0.78) * sparkle * 0.05 * lit * uFrost;

    gl_FragColor = vec4(col * uReveal, 1.0);
  }
`;

function buildBackground() {
  const uniforms = {
    uTex: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTexRes: { value: new THREE.Vector2(1600, 900) },
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uScroll: { value: 0 },
    // frosted-glass strength, 0 = plain photo, 1 = full frost
    uFrost: { value: 1 },
    // mip bias for the blur taps; needs generateMipmaps on the texture.
    // This carries the wide part of the diffusion (see frostSample).
    uLod: { value: 3.2 },
    uReveal: { value: 0 },
    uMotion: { value: 1 },
  };

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: BG_VERT,
    fragmentShader: BG_FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(geometry, material));

  return { scene, camera, uniforms, geometry, material };
}

/* ── ember pass ──────────────────────────────────────────────────────────── */

/** Soft radial sprite, drawn once into a small canvas. */
function makeEmberTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const EMBER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uFieldHeight;
  uniform float uSizeScale;

  attribute float aSeed;
  attribute float aSize;
  attribute float aSpeed;

  varying float vSeed;
  varying float vFade;

  void main() {
    vSeed = aSeed;
    vec3 p = position;

    // Rise, then wrap back to the bottom of the field. Doing the wrap here
    // rather than on the CPU is the whole point of this shader.
    p.y = mod(p.y + uTime * aSpeed + uFieldHeight * 0.5, uFieldHeight) - uFieldHeight * 0.5;

    p.x += sin(uTime * 0.22 + aSeed * 8.0) * 0.55 + sin(uTime * 0.07 + aSeed * 21.0) * 0.28;
    p.z += cos(uTime * 0.15 + aSeed * 13.0) * 0.35;

    // fade at both ends so the wrap is invisible
    vFade = 1.0 - smoothstep(0.62, 1.0, abs(p.y) / (uFieldHeight * 0.5));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (14.0 / max(-mv.z, 0.001));
  }
`;

const EMBER_FRAG = /* glsl */`
  uniform sampler2D uSprite;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying float vSeed;
  varying float vFade;

  void main() {
    float mask = texture2D(uSprite, gl_PointCoord).a;
    if (mask < 0.01) discard;
    gl_FragColor = vec4(mix(uColorA, uColorB, vSeed), mask * uOpacity * vFade);
  }
`;

function buildEmbers(count, spread, height, sprite, sizeScale, opacity) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const speeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = (Math.random() - 0.5) * height;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread * 0.6;
    seeds[i] = Math.random();
    sizes[i] = 0.5 + Math.random() * 1.7;
    speeds[i] = 0.12 + Math.random() * 0.42;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: EMBER_VERT,
    fragmentShader: EMBER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uFieldHeight: { value: height },
      uSizeScale: { value: sizeScale },
      uSprite: { value: sprite },
      uColorA: { value: new THREE.Color(EMBER_A) },
      uColorB: { value: new THREE.Color(EMBER_B) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geo, mat);
}

/* ── scene ───────────────────────────────────────────────────────────────── */

function createScene(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: true, powerPreference: 'low-power',
    });
  } catch (err) {
    console.warn('[SpinLog 3D] WebGL unavailable; the CSS gradient stands in.', err);
    return null;
  }

  const compact = window.innerWidth < 900;
  const quality = {
    /* Deliberately BELOW 1 device pixel per CSS pixel. This used to be 1.25 /
       1.6, which is the right call for a crisp scene and the wrong one for a
       frosted backdrop: the whole pass is a 22px blur, so rendering it at full
       resolution buys detail the blur immediately throws away.
       Dropping to 0.8 / 0.65 cuts the pixels the frost shader has to touch by
       ~1.6x on desktop and ~2.4x on a phone, and the browser's upscale of the
       canvas adds a little extra softening for free.
       Note this is a pixel COUNT reduction, which is a real saving on any
       rasteriser. Cheaper per-fetch tricks are not: sampling a mip is faster on
       a GPU's texture units but slower in a software rasteriser, so it is not
       something to rely on across devices. */
    dprCap: compact ? 0.65 : 0.8,
    count: Math.round(Math.min(compact ? 520 : 1400,
      Math.max(220, (window.innerWidth * window.innerHeight) / 1500))),
    sizeScale: compact ? 0.85 : 1,
  };

  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;   // background pass draws first, embers layer on top

  const bg = buildBackground();

  const emberScene = new THREE.Scene();
  const emberCam = new THREE.PerspectiveCamera(56, 1, 0.1, 90);
  emberCam.position.set(0, 0, 9);

  const sprite = makeEmberTexture();
  const near = buildEmbers(Math.round(quality.count * 0.62), 26, 22, sprite, quality.sizeScale, 0.5);
  near.position.z = 1.5;
  const far = buildEmbers(Math.round(quality.count * 0.38), 40, 30, sprite, quality.sizeScale * 0.7, 0.3);
  far.position.z = -9;
  emberScene.add(near, far);

  const state = {
    renderer, bg, emberScene, emberCam, sprite, quality,
    embers: [near, far],
    pointer: { x: 0, y: 0 }, target: { x: 0, y: 0 },
    scrollNorm: 0,
    textureReady: false,
    reveal: 0,
  };

  // Load the backdrop photo. Until it decodes, uReveal stays 0 and the CSS
  // gradient below the canvas is what the user sees.
  new THREE.TextureLoader().load(
    BG_URL,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      /* Mipmaps exist purely so the frost blur can read pre-averaged levels
         (see uLod in the shader). The image is 1600x900 — non power of two,
         which WebGL1 could not mipmap, but three r163+ is WebGL2-only and
         WebGL2 has no such restriction. */
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      bg.uniforms.uTex.value = tex;
      bg.uniforms.uTexRes.value.set(tex.image.width, tex.image.height);
      state.textureReady = true;
      state.bgTexture = tex;
    },
    undefined,
    () => console.warn('[SpinLog 3D] Backdrop image failed to load; keeping the gradient.')
  );

  state.layout = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, state.quality.dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    bg.uniforms.uRes.value.set(w, h);
    emberCam.aspect = w / h;
    emberCam.updateProjectionMatrix();
    state.embers.forEach(l => { l.material.uniforms.uPixelRatio.value = dpr; });
  };

  state.update = (t, dt, motion) => {
    // ease the pointer so parallax glides instead of snapping
    state.pointer.x += (state.target.x - state.pointer.x) * 0.045;
    state.pointer.y += (state.target.y - state.pointer.y) * 0.045;

    if (state.textureReady && state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt * 0.8);

    bg.uniforms.uTime.value = t;
    bg.uniforms.uPointer.value.set(state.pointer.x, state.pointer.y);
    bg.uniforms.uScroll.value = state.scrollNorm;
    bg.uniforms.uReveal.value = state.reveal;
    bg.uniforms.uMotion.value = motion ? 1 : 0;

    state.embers.forEach(l => { l.material.uniforms.uTime.value = t; });
    emberCam.position.x = state.pointer.x * 1.1;
    emberCam.position.y = state.pointer.y * 0.7 - state.scrollNorm * 1.6;
    emberCam.lookAt(0, -state.scrollNorm * 0.8, 0);

    renderer.clear();
    renderer.render(bg.scene, bg.camera);
    renderer.render(state.emberScene, emberCam);
  };

  state.dispose = () => {
    state.embers.forEach(l => { l.geometry.dispose(); l.material.dispose(); });
    bg.geometry.dispose();
    bg.material.dispose();
    state.bgTexture?.dispose();
    sprite.dispose();
    renderer.dispose();
  };

  state.layout();
  return state;
}

/* ── controller ──────────────────────────────────────────────────────────── */

function boot() {
  const canvas = document.getElementById(CANVAS_ID);
  if (!canvas) return;

  let state = null;
  let raf = 0;
  let running = false;
  let enabled = true;
  let lastFrame = 0;
  let elapsed = 0;
  let slowFrames = 0;
  let downgraded = false;

  const MIN_FRAME_MS = 1000 / 48;  // a backdrop does not need 120fps

  function die(reason) {
    if (reason) console.warn('[SpinLog 3D]', reason);
    stop();
    canvas.classList.remove('is-live');
    canvas.classList.add('is-dead');
  }

  /** Halve the cost once, if the device is clearly struggling. */
  function downgrade() {
    if (downgraded || !state) return;
    downgraded = true;
    // Was setPixelRatio(1) — which now RAISES the resolution, since the frost
    // backdrop deliberately renders below 1. Step the cap down instead.
    state.quality.dprCap *= 0.7;
    state.layout();
    state.embers.forEach(l => {
      const n = l.geometry.getAttribute('position').count;
      l.geometry.setDrawRange(0, Math.floor(n / 2));
    });
    console.info('[SpinLog 3D] Reduced backdrop quality to keep frames smooth.');
  }

  function frame(now) {
    if (!running || !state) return;
    raf = requestAnimationFrame(frame);
    if (now - lastFrame < MIN_FRAME_MS) return;

    const deltaMs = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    const dt = Math.min(deltaMs, 100) / 1000;
    elapsed += dt;

    if (deltaMs > 42 && elapsed > 2) {
      if (++slowFrames > 24) downgrade();
    } else if (slowFrames > 0) slowFrames--;

    try {
      state.update(elapsed, dt, true);
    } catch (err) {
      die('Render failed, disabling the backdrop.');
    }
  }

  function ensureScene() {
    if (state) return true;
    state = createScene(canvas);
    if (!state) { die(); return false; }
    canvas.classList.remove('is-dead');
    canvas.classList.add('is-live');
    canvas.addEventListener('webglcontextlost',
      () => { state = null; die('WebGL context lost.'); }, { once: true });
    return true;
  }

  function start() {
    if (running || !enabled || prefersReducedMotion()) return;
    if (!ensureScene()) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /**
   * Reduced motion: the backdrop is content, not decoration, so it still gets
   * drawn — just once, with every animated term switched off. Hiding it would
   * mean anyone with the OS setting on never sees the photo at all.
   */
  function renderStill() {
    if (!ensureScene()) return;
    let tries = 0;
    const paint = () => {
      state.reveal = state.textureReady ? 1 : 0;
      state.update(0, 0, false);
      // the texture decodes asynchronously; retry briefly until it lands
      if (!state.textureReady && ++tries < 40) setTimeout(paint, 100);
    };
    paint();
  }

  /* ── listeners ── */

  let resizeTimer = 0;
  const relayout = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state) return;
      state.layout();
      if (!running) renderStill();
    }, 140);
  };
  window.addEventListener('resize', relayout, { passive: true });
  window.addEventListener('orientationchange', relayout, { passive: true });

  window.addEventListener('pointermove', (ev) => {
    if (!state || ev.pointerType === 'touch') return;
    state.target.x = (ev.clientX / window.innerWidth - 0.5) * 2;
    state.target.y = -(ev.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  /* Scroll drives the backdrop parallax. Two things matter for scroll
     smoothness here:
       1. Never read layout inside a scroll handler. This used to read
          document.documentElement.scrollHeight on every scroll event, which
          forces a style+layout flush if anything is dirty — expensive on the
          Service and Documents pages, which are long lists behind a 331 KB
          stylesheet. The value also cannot change mid-scroll, so re-reading it
          was pure waste.
       2. Never do the work more than once per frame. */
  let scrollMax = 1;
  let scrollQueued = false;

  const measureScrollMax = () => {
    scrollMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  };
  const applyScroll = () => {
    scrollQueued = false;
    if (state) state.scrollNorm = Math.min(1, Math.max(0, window.scrollY / scrollMax));
  };

  window.addEventListener('scroll', () => {
    if (!state || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(applyScroll);
  }, { passive: true });

  measureScrollMax();
  // Page height changes when the router swaps sections, so re-measure from a
  // ResizeObserver rather than from the scroll handler.
  if ('ResizeObserver' in window) {
    let sizeTimer = 0;
    new ResizeObserver(() => {
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(measureScrollMax, 120);
    }).observe(document.documentElement);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq) {
    const onChange = () => { if (mq.matches) { stop(); renderStill(); } else start(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  window.SpinLog3D = {
    isRunning: () => running,
    isEnabled: () => enabled,
    /**
     * Pause the render loop WITHOUT hiding the canvas. The router calls this so
     * a full-viewport WebGL scene is not redrawing at 48fps, with its shader
     * driven by scroll offset, while you scroll a long table on Service or
     * Documents. The last frame is re-rendered before stopping so the canvas
     * keeps showing the backdrop rather than an empty buffer — and if the
     * browser does discard the buffer, alpha:true means the static CSS photo on
     * html::before shows through instead of a black rectangle.
     */
    setAnimating(on) {
      if (on) { start(); return running; }
      if (running) {
        stop();
        try { state?.update(elapsed, 0, true); } catch { /* leave it as-is */ }
      }
      return running;
    },
    setEnabled(on) {
      enabled = !!on;
      if (enabled) start();
      else { stop(); canvas.classList.remove('is-live'); }
      return enabled;
    },
    /** Frost strength, 0..1. Exposed so the test harness can measure that the
     *  diffusion is genuinely happening rather than trusting the shader. */
    _setFrost(v) {
      if (!state) return null;
      const f = Math.max(0, Math.min(1, Number(v)));
      state.bg.uniforms.uFrost.value = f;
      if (!running) { try { state.update(elapsed, 0, true); } catch { /* ignore */ } }
      return f;
    },
    /** Mip bias for the frost taps. Exposed so the harness can prove the mipmap
     *  chain exists — if it silently failed, the bias would be a no-op. */
    _setLod(v) {
      if (!state) return null;
      state.bg.uniforms.uLod.value = Number(v);
      if (!running) { try { state.update(elapsed, 0, true); } catch { /* ignore */ } }
      return state.bg.uniforms.uLod.value;
    },
    _debug() {
      if (!state) return { live: false };
      const info = state.renderer.info.render;
      return {
        live: true,
        calls: info.calls,
        frame: info.frame,
        points: info.points,
        triangles: info.triangles,
        dpr: state.renderer.getPixelRatio(),
        textureReady: state.textureReady,
        reveal: Number(state.reveal.toFixed(2)),
        texRes: [state.bg.uniforms.uTexRes.value.x, state.bg.uniforms.uTexRes.value.y],
        scroll: Number(state.scrollNorm.toFixed(3)),
        downgraded,
        elapsed: Number(elapsed.toFixed(2)),
      };
    },
    destroy() {
      stop();
      state?.dispose();
      state = null;
      canvas.classList.remove('is-live');
    },
  };

  if (prefersReducedMotion()) {
    if ('requestIdleCallback' in window) requestIdleCallback(() => renderStill(), { timeout: 1200 });
    else setTimeout(renderStill, 220);
    return;
  }

  // let first paint and the critical CSS settle before spinning up WebGL
  if ('requestIdleCallback' in window) requestIdleCallback(() => start(), { timeout: 1200 });
  else setTimeout(start, 220);
}

try {
  boot();
} catch (err) {
  console.warn('[SpinLog 3D] Backdrop failed to initialise.', err);
  document.getElementById(CANVAS_ID)?.classList.add('is-dead');
}
