(function () {
  const root = document.querySelector("[data-coverflow]");
  if (!root) return;

  const stage = root.querySelector(".flow-stage");
  const buttons = [...root.querySelectorAll(".flow-select")];
  const panels = [...root.querySelectorAll(".flow-panel")];
  const randomBtn = document.querySelector(".flow-random");
  const live = root.querySelector("#flow-live");
  if (!stage || buttons.length === 0) return;

  // Shallow ring, tight row. Depth is the wide ellipse: a large radius with
  // Z_SCALE compressing it, so each step falls back only a little. Horizontal
  // spacing is the original flat row — the first neighbour sits `stride`
  // cover-widths over, and each one after that only `pack` — so the sleeves
  // stay close and overlap slightly. A cover off centre turns inward, outer
  // edge back, and that turn eases to 0 at the centre. `lip` and `poke` keep
  // the nearer face in front, because the inner edge of an inward tilt swings
  // toward the viewer. Stride is also the drag scale and is unchanged.
  const ARC_STEP = (36 * Math.PI) / 180;
  const ARC_RATIO = 1.58;
  const Z_SCALE = 0.3;
  const ARC_SCALE = 0.84;
  const TILT_MAX = 18.7;
  const TILT_K = 1.5;
  const POKE_K = 1.05;
  const LIP = 0.06;
  const LIP_K = 1.4;
  const Z_BIAS = 0.02;
  const FADE_AT = 2.6;
  const FADE_END = 3.5;
  // Past this, the sleeve is fully faded. Skip painting it.
  const RENDER_REACH = 3.6;
  let stride = 1.06;
  let pack = 0.18;

  // Direction lock. Until the finger has moved LOCK_PX, the gesture is undecided.
  // A tie at the very start can be vertical. A thumb arcs, so a flick that is
  // sideways by the time the finger lifts is still a horizontal gesture.
  const LOCK_PX = 10;

  // Inertia. `index` is a continuous album position, not a whole step.
  // Coast decelerates at FRICTION albums/s^2 (travel = v^2 / (2 * FRICTION)),
  // then a soft underdamped spring settles on the nearest cover.
  // Past either end, motion compresses by RUBBER up to RUBBER_LIMIT albums.
  const FRICTION = 7.5;
  const SNAP_AT = 0.8;
  const SPRING = 42;
  const DAMPING = 11.5;
  const RUBBER = 0.32;
  const RUBBER_LIMIT = 0.45;
  const MAX_SPEED = 18;
  const WHEEL_QUIET_MS = 90;
  // Last ~100ms of real touchmove points. iOS often ends a flick with a
  // stationary sample, or with touchend long enough after the last move that a
  // short gap would look like the finger had already stopped.
  const SAMPLE_MS = 100;
  // iOS delivers touchend well after the last real move. A short gap is still a flick.
  const RELEASE_GAP = 180;

  const maxIndex = buttons.length - 1;

  // Random-track glide. Same rAF loop as coast/spring. Ease-out cubic
  // (Hermite with end velocity 0 and start slope 3) so a long trip is a fast
  // spin that lands exactly on the target. Duration is ~0.6s for one step and
  // ~1.6s by 40 steps.
  const SPIN_NEAR_S = 0.6;
  const SPIN_FAR_S = 1.6;
  const SPIN_FAR_STEPS = 40;
  const SPIN_SLOPE = 3;

  let index = 0;
  let shown = 0;
  let coverWidth = 0;
  let arcRadius = 0;
  let lipPx = 0;
  let zBiasPx = 0;
  let spin = null;
  const recentPicks = [];
  const primedImages = new WeakSet();
  const warmedSrc = new Set();
  const warmers = [];
  let drag = null;
  let ignoreClick = false;
  let phase = "idle";
  let velocity = 0;
  let target = 0;
  let raf = 0;
  let lastFrame = 0;
  let wheelTimer = 0;
  let wheelSamples = [];
  let ignoreTimer = 0;
  let flipped = null;
  let linkTouch = null;
  let openingLink = false;
  let swallowClicksUntil = 0;

  const debugOn = (() => {
    try {
      return new URLSearchParams(window.location.search).get("debug") === "1";
    } catch {
      return false;
    }
  })();
  const debugState = { lock: "none", samples: 0, velocity: "—", path: "none" };
  let debugEl = null;

  function renderDebug() {
    if (!debugEl) return;
    const lock = drag ? drag.axis || "undecided" : debugState.lock;
    const samples = drag ? drag.samples.length : debugState.samples;
    debugEl.textContent = [
      "lock: " + lock,
      "samples: " + samples,
      "velocity: " + debugState.velocity,
      "path: " + debugState.path,
    ].join("\n");
  }

  function note(path, velocity, samples, lock) {
    debugState.path = path;
    if (typeof velocity === "number" && Number.isFinite(velocity)) debugState.velocity = velocity.toFixed(2);
    if (typeof samples === "number") debugState.samples = samples;
    if (lock) debugState.lock = lock;
    renderDebug();
  }

  function armIgnoreClick() {
    ignoreClick = true;
    window.clearTimeout(ignoreTimer);
    const clear = () => {
      if (phase === "drag" || phase === "coast" || phase === "spring") {
        ignoreTimer = window.setTimeout(clear, 180);
        return;
      }
      ignoreClick = false;
    };
    ignoreTimer = window.setTimeout(clear, 700);
  }

  function backOf(item) {
    return buttons[item].closest(".flow-cover").querySelector(".flow-back");
  }

  function warmBack(back) {
    back.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src) return;
      img.loading = "eager";
      if (!img.complete && !img.currentSrc) img.src = src;
    });
  }

  // Layout boxes, not the rotated getClientRects. At 0° and 180° a Y-flip
  // lands on the same rectangle, including when WebKit's hit testing misses
  // a preserve-3d face.
  function linkLayoutRect(link) {
    const cover = link.closest(".flow-cover");
    if (!cover) return null;
    const base = cover.getBoundingClientRect();
    let x = 0;
    let y = 0;
    let node = link;
    let guard = 0;
    while (node && node !== cover && guard < 12) {
      x += node.offsetLeft;
      y += node.offsetTop;
      const next = node.offsetParent;
      if (!next) break;
      node = next;
      guard += 1;
    }
    if (node !== cover) return link.getBoundingClientRect();
    const width = link.offsetWidth;
    const height = link.offsetHeight;
    return { left: base.left + x, top: base.top + y, right: base.left + x + width, bottom: base.top + y + height, width, height };
  }

  function showingBackItem() {
    if (flipped !== null) return flipped;
    if (flipJob && flipJob.to !== 0) return flipJob.item;
    if (flipJob) {
      const back = backOf(flipJob.item);
      if (back && !back.hidden) return flipJob.item;
    }
    return null;
  }

  function backLinkAt(clientX, clientY) {
    const item = showingBackItem();
    if (item === null) return null;
    const back = backOf(item);
    if (!back || back.hidden) return null;
    const direct = document.elementFromPoint(clientX, clientY);
    if (direct && direct.closest) {
      const link = direct.closest(".flow-back a");
      if (link && back.contains(link)) return link;
    }
    const links = back.querySelectorAll("a");
    for (const link of links) {
      const rect = linkLayoutRect(link);
      if (!rect || rect.width < 2 || rect.height < 2) continue;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return link;
    }
    return null;
  }

  function followBackLink(link) {
    if (!link || openingLink) return;
    openingLink = true;
    ignoreClick = false;
    window.clearTimeout(ignoreTimer);
    link.click();
    openingLink = false;
    // A touch can still synthesize a click after we opened the link. Eat that one.
    swallowClicksUntil = performance.now() + 700;
  }

  function pointHitsBackLink(event) {
    const direct = event.target && event.target.closest ? event.target.closest(".flow-back a") : null;
    if (direct && stage.contains(direct)) return direct;
    if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) return null;
    if (typeof event.clientX !== "number") return null;
    return backLinkAt(event.clientX, event.clientY);
  }

  // The sleeve turns on rAF, not a CSS transition. WebKit paints a
  // preserve-3d back face through the artwork even with backface-visibility,
  // so the back stays out of the render tree (hidden) until the turn passes
  // 90°. Below that the front is the only face; above it the front is hidden
  // and the back is shown. Side covers never leave hidden.
  const FLIP_MS = 540;
  let flipJob = null;

  function flipParts(item) {
    const button = buttons[item];
    if (!button) return null;
    const cover = button.closest(".flow-cover");
    if (!cover) return null;
    return {
      button,
      cover,
      flip: cover.querySelector(".flow-flip"),
      back: cover.querySelector(".flow-back"),
    };
  }

  function readFlipAngle(flipEl) {
    if (!flipEl) return 0;
    const inline = flipEl.style.transform || "";
    const inlineMatch = inline.match(/rotateY\(\s*(-?[\d.]+)deg\s*\)/i);
    if (inlineMatch) {
      let angle = Number(inlineMatch[1]);
      if (!Number.isFinite(angle)) return 0;
      angle = ((angle % 360) + 360) % 360;
      if (angle > 180) angle = 360 - angle;
      return angle;
    }
    const transform = getComputedStyle(flipEl).transform;
    if (!transform || transform === "none") return 0;
    const m = transform.match(/matrix3d\(([^)]+)\)/);
    if (!m) return 0;
    const p = m[1].split(",").map((n) => Number(n.trim()));
    let angle = (Math.atan2(p[8], p[0]) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    if (angle > 180) angle = 360 - angle;
    return angle;
  }

  // cubic-bezier(0.4, 0.05, 0.2, 1). Same curve the flip used as a transition.
  function flipEase(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const x1 = 0.4;
    const y1 = 0.05;
    const x2 = 0.2;
    const y2 = 1;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const slope = sampleDX(t);
      if (Math.abs(slope) < 1e-6) break;
      const next = t - (sampleX(t) - x) / slope;
      if (!Number.isFinite(next)) break;
      t = Math.max(0, Math.min(1, next));
    }
    // Newton can stall on a flat derivative. Bisect the remainder.
    let lo = 0;
    let hi = 1;
    if (Math.abs(sampleX(t) - x) > 1e-4) {
      for (let i = 0; i < 12; i += 1) {
        const mid = (lo + hi) / 2;
        if (sampleX(mid) < x) lo = mid;
        else hi = mid;
      }
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  }

  function concealBack(node) {
    if (!node || !node.back) return;
    const restore = !node.back.hidden && node.back.contains(document.activeElement);
    node.back.hidden = true;
    node.back.inert = true;
    node.back.setAttribute("aria-hidden", "true");
    node.cover.classList.remove("is-showing-back");
    if (restore) node.button.focus({ preventScroll: true });
  }

  function concealOtherBacks(except) {
    for (let item = 0; item < buttons.length; item += 1) {
      if (item === except) continue;
      const node = flipParts(item);
      if (!node || !node.back || node.back.hidden) continue;
      concealBack(node);
      if (node.flip) node.flip.style.transform = "rotateY(0deg)";
      node.cover.classList.remove("is-flipped");
      node.button.setAttribute("aria-expanded", "false");
    }
  }

  function stopFlipJob() {
    if (flipJob && flipJob.raf) cancelAnimationFrame(flipJob.raf);
    flipJob = null;
  }

  function paintFlip(item, angle) {
    const node = flipParts(item);
    if (!node || !node.flip) return;
    const deg = Math.max(0, Math.min(180, angle));
    const turn = `rotateY(${deg.toFixed(3)}deg)`;
    node.flip.style.transform = turn;
    const showBack = deg >= 90;
    if (!node.back) {
      node.cover.classList.toggle("is-showing-back", showBack);
      return;
    }
    if (showBack) {
      concealOtherBacks(item);
      node.cover.classList.add("is-showing-back");
      if (node.back.hidden) {
        node.back.hidden = false;
        warmBack(node.back);
      }
      node.back.inert = false;
      node.back.removeAttribute("aria-hidden");
      return;
    }
    concealBack(node);
  }

  function runFlip(item, to) {
    const node = flipParts(item);
    if (!node || !node.flip) return;
    const from = readFlipAngle(node.flip);
    stopFlipJob();
    if (Math.abs(from - to) < 0.4) {
      paintFlip(item, to);
      return;
    }
    const start = performance.now();
    const job = { item, raf: 0, to };
    flipJob = job;
    const tick = (now) => {
      if (flipJob !== job) return;
      const u = Math.min(1, (now - start) / FLIP_MS);
      paintFlip(item, from + (to - from) * flipEase(u));
      if (u < 1) {
        job.raf = requestAnimationFrame(tick);
        return;
      }
      paintFlip(item, to);
      if (flipJob === job) flipJob = null;
    };
    job.raf = requestAnimationFrame(tick);
  }

  function openFlip(item) {
    if (flipped !== null && flipped !== item) snapFlip(flipped);
    else if (flipJob && flipJob.item !== item) snapFlip(flipJob.item);
    const node = flipParts(item);
    if (!node) return;
    flipped = item;
    node.cover.classList.add("is-flipped");
    node.button.setAttribute("aria-expanded", "true");
    runFlip(item, 180);
  }

  function snapFlip(item) {
    const node = flipParts(item);
    if (flipJob && flipJob.item === item) stopFlipJob();
    if (!node) return;
    node.cover.classList.remove("is-flipped");
    node.button.setAttribute("aria-expanded", "false");
    if (node.flip) node.flip.style.transform = "rotateY(0deg)";
    concealBack(node);
  }

  function closeFlip(options) {
    const item = flipped !== null ? flipped : flipJob ? flipJob.item : null;
    if (item == null) return;
    const node = flipParts(item);
    if (node) {
      node.cover.classList.remove("is-flipped");
      node.button.setAttribute("aria-expanded", "false");
    }
    flipped = null;
    if (options && options.animate) {
      runFlip(item, 0);
      return;
    }
    snapFlip(item);
  }

  function toggleFlip() {
    const center = clamp(Math.round(index));
    if (flipped === center || (flipped === null && flipJob && flipJob.item === center && flipJob.to === 180)) {
      closeFlip({ animate: true });
      return;
    }
    openFlip(center);
  }

  function activateCover(next, interrupted) {
    if (next === clamp(Math.round(index)) && !interrupted) {
      toggleFlip();
      return;
    }
    closeFlip();
    goTo(next);
  }

  function horizontalIntent(dx, dy) {
    return Math.abs(dx) >= LOCK_PX && Math.abs(dx) >= Math.abs(dy) * 0.75;
  }

  function freezeTransitions() {
    buttons.forEach((button) => {
      button.closest(".flow-cover").style.transition = "none";
    });
  }

  function clamp(value) {
    return Math.min(maxIndex, Math.max(0, value));
  }

  function clampSpeed(value) {
    return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, value));
  }

  function span() {
    return Math.max(coverWidth * stride, 1);
  }

  function measure() {
    coverWidth = buttons[0].closest(".flow-cover").offsetWidth || coverWidth;
    const narrow = stage.clientWidth < 620;
    stride = narrow ? 0.9 : 1.06;
    pack = narrow ? 0.16 : 0.18;
    arcRadius = coverWidth * ARC_RATIO;
    lipPx = coverWidth * LIP;
    zBiasPx = coverWidth * Z_BIAS;
  }

  // x is the original flat-row spacing. z is the shallow ellipse. rot is the
  // inward tilt: positive rotateY on the right sends that cover's right edge
  // back, and the mirror of that on the left. It is 0 at delta 0 and smooth
  // through the centre, so a drag, flick, or shuffle never snaps the angle.
  function place(delta) {
    const distance = Math.abs(delta);
    const absTheta = distance * ARC_STEP;
    const sign = delta < 0 ? -1 : delta > 0 ? 1 : 0;
    const scale = Math.pow(ARC_SCALE, distance);
    const half = (coverWidth * scale) / 2;
    const x =
      distance <= 1
        ? delta * coverWidth * stride
        : sign * coverWidth * (stride + (distance - 1) * pack);
    const zCircle = (Math.cos(absTheta) - 1) * arcRadius * Z_SCALE;
    const tilt = TILT_MAX * (1 - Math.exp(-distance * TILT_K));
    const rot = delta < 0 ? -tilt : delta > 0 ? tilt : 0;
    const poke = half * Math.sin((tilt * Math.PI) / 180);
    const lip = lipPx * (1 - Math.exp(-distance * LIP_K));
    const z = zCircle - poke * POKE_K - lip - distance * zBiasPx;
    let shade = Math.min(0.48, distance * 0.12);
    if (distance > FADE_AT) {
      const t = Math.min(1, (distance - FADE_AT) / (FADE_END - FADE_AT));
      shade += (1 - shade) * t;
    }
    // The floor reflection reads on the centred sleeve. On the curve it
    // tilts into the neighbours, so it is gone within one step.
    const reflect = distance >= 0.85 ? 0 : 1 - distance / 0.85;
    return { x, z, rot, scale, shade, reflect, distance };
  }

  // Pulling past either end shortens the travel, and it never goes past RUBBER_LIMIT.
  function resist(raw) {
    if (raw < 0) return -Math.min(RUBBER_LIMIT, -raw * RUBBER);
    if (raw > maxIndex) return maxIndex + Math.min(RUBBER_LIMIT, (raw - maxIndex) * RUBBER);
    return raw;
  }

  function syncCaption(active) {
    if (active === shown) return;
    shown = active;
    panels.forEach((panel, item) => {
      panel.hidden = item !== active;
    });
    buttons.forEach((button, item) => {
      if (item === active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    const summary = buttons[active].getAttribute("data-summary");
    if (live && summary) live.textContent = summary;
  }

  function paint() {
    if (!coverWidth) measure();
    const hold = phase === "drag" || phase === "coast" || phase === "spring" || phase === "wheel" || phase === "spin";
    buttons.forEach((button, item) => {
      const cover = button.closest(".flow-cover");
      const delta = item - index;
      const distance = Math.abs(delta);
      // Only the sleeves on the near arc are drawn. The rest of the crate
      // stays in the list for the keyboard and the caption, but it is not painted.
      if (distance > RENDER_REACH) {
        if (!cover.classList.contains("is-culled")) {
          cover.classList.add("is-culled");
          cover.style.pointerEvents = "none";
        }
        return;
      }
      const spot = place(delta);
      if (cover.classList.contains("is-culled")) cover.classList.remove("is-culled");
      if (hold) cover.style.transition = "none";
      // One transform, depth ordered the same way as z-index. Sub-pixel x/z
      // avoids a one-pixel pop when two faces pass, which WebKit otherwise
      // paints as a flicker. Opacity stays at 1 so a faded sleeve cannot
      // flatten and jump in front of the one nearer the viewer.
      cover.style.transform = `translate3d(${spot.x.toFixed(2)}px, 0, ${spot.z.toFixed(2)}px) rotateY(${spot.rot.toFixed(2)}deg) scale(${spot.scale.toFixed(4)})`;
      cover.style.zIndex = String(5000 - Math.round(distance * 100));
      cover.style.setProperty("--shade", spot.shade.toFixed(3));
      cover.style.setProperty("--reflect", spot.reflect.toFixed(3));
      cover.style.opacity = "";
      cover.style.pointerEvents = spot.shade > 0.97 ? "none" : "";
    });
    syncCaption(clamp(Math.round(index)));
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function ensureLoop() {
    if (raf) return;
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function markGliding() {
    freezeTransitions();
    root.classList.add("is-gliding");
    root.classList.remove("is-dragging");
  }

  function armSpring(next) {
    target = clamp(next);
    phase = "spring";
    markGliding();
  }

  function armCoast() {
    phase = "coast";
    markGliding();
  }

  function startSpring(next) {
    armSpring(next);
    ensureLoop();
  }

  function startCoast() {
    armCoast();
    ensureLoop();
  }

  function finishIdle() {
    phase = "idle";
    velocity = 0;
    spin = null;
  }

  // The glide is the feature, including on phones with Reduce Motion turned on.
  // prefers-reduced-motion still quiets decorative transitions in the stylesheet.
  function goTo(next) {
    closeFlip();
    spin = null;
    velocity = 0;
    startSpring(next);
  }

  function spinSeconds(distance) {
    const steps = Math.max(1, Math.abs(distance));
    const t = Math.min(1, Math.log2(steps) / Math.log2(SPIN_FAR_STEPS));
    return SPIN_NEAR_S + (SPIN_FAR_S - SPIN_NEAR_S) * t;
  }

  // Ease-out cubic when v0 is 3 * delta / duration. A same-direction velocity
  // is kept only while the opening slope stays at or under that, so the glide
  // never reverses or overshoots the record it is aiming at.
  function planSpin(dest) {
    const from = index;
    const delta = dest - from;
    const distance = Math.abs(delta);
    if (distance < 0.0008) return null;
    let duration = spinSeconds(distance);
    let v0 = (SPIN_SLOPE * delta) / duration;
    const sameWay = delta * velocity > 0 && Math.abs(velocity) > 0.08;
    if (sameWay) {
      const keepDuration = (SPIN_SLOPE * distance) / Math.abs(velocity);
      if (keepDuration >= 0.34 && keepDuration <= SPIN_FAR_S) {
        duration = keepDuration;
        v0 = velocity;
      } else if (keepDuration > SPIN_FAR_S) {
        duration = SPIN_FAR_S;
        const slope = (velocity * duration) / delta;
        if (slope > 0 && slope <= SPIN_SLOPE) v0 = velocity;
        else v0 = (SPIN_SLOPE * delta) / duration;
      } else {
        duration = Math.min(duration, 0.48);
        v0 = (SPIN_SLOPE * delta) / duration;
      }
    }
    if (!(duration > 0)) duration = SPIN_NEAR_S;
    return { from, to: dest, start: performance.now(), duration, v0 };
  }

  function primeArtwork(from, to) {
    const lo = Math.max(0, Math.floor(Math.min(from, to)) - 2);
    const hi = Math.min(maxIndex, Math.ceil(Math.max(from, to)) + 2);
    for (let item = lo; item <= hi; item += 1) {
      buttons[item].closest(".flow-cover").querySelectorAll(".flow-sleeve img, .flow-reflect img").forEach((img) => {
        if (primedImages.has(img)) return;
        primedImages.add(img);
        const src = img.getAttribute("src");
        if (!src) return;
        // Lazy sleeves sit off to the side, so a fast spin would otherwise
        // fly past an empty square. Kick the decode before they reach center.
        img.loading = "eager";
        if (!img.complete && !img.currentSrc) img.src = src;
        if (typeof img.decode === "function") img.decode().catch(() => {});
        if (warmedSrc.has(src)) return;
        warmedSrc.add(src);
        const warm = new Image();
        warm.decoding = "async";
        warm.src = src;
        warmers.push(warm);
      });
    }
  }

  function armSpin(dest) {
    closeFlip();
    window.clearTimeout(wheelTimer);
    wheelTimer = 0;
    drag = null;
    const plan = planSpin(clamp(Math.round(dest)));
    if (!plan) {
      index = clamp(Math.round(dest));
      spin = null;
      finishIdle();
      root.classList.remove("is-gliding", "is-dragging");
      paint();
      return;
    }
    spin = plan;
    phase = "spin";
    velocity = plan.v0;
    markGliding();
    primeArtwork(plan.from, plan.to);
    note("spin", plan.v0, 0, "none");
    ensureLoop();
  }

  function pickRandom() {
    const count = buttons.length;
    if (count < 2) return null;
    const focused = clamp(Math.round(index));
    const banned = new Set([focused]);
    const preferred = [];
    if (spin && spin.to !== focused) preferred.push(spin.to);
    for (let item = recentPicks.length - 1; item >= 0 && preferred.length < 4; item -= 1) {
      preferred.push(recentPicks[item]);
    }
    preferred.forEach((item) => {
      if (banned.size >= count - 1) return;
      banned.add(item);
    });
    const pool = [];
    for (let item = 0; item < count; item += 1) {
      if (!banned.has(item)) pool.push(item);
    }
    if (pool.length === 0) return null;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    recentPicks.push(choice);
    if (recentPicks.length > 6) recentPicks.shift();
    return choice;
  }

  function onRandom(event) {
    event.preventDefault();
    closeFlip();
    const choice = pickRandom();
    if (choice === null) return;
    armSpin(choice);
  }

  function stepSpin(now) {
    if (!spin) {
      finishIdle();
      return;
    }
    const elapsed = (now - spin.start) / 1000;
    const spanT = spin.duration > 0 ? elapsed / spin.duration : 1;
    if (spanT >= 1) {
      index = spin.to;
      velocity = 0;
      spin = null;
      finishIdle();
      return;
    }
    const u = spanT < 0 ? 0 : spanT;
    const from = spin.from;
    const to = spin.to;
    const tangent = spin.v0 * spin.duration;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    let next = h00 * from + h10 * tangent + h01 * to;
    if (to >= from) next = Math.min(to, Math.max(from, next));
    else next = Math.max(to, Math.min(from, next));
    index = next;
    const dh00 = 6 * u2 - 6 * u;
    const dh10 = 3 * u2 - 4 * u + 1;
    const dh01 = -6 * u2 + 6 * u;
    velocity = (dh00 * from + dh10 * tangent + dh01 * to) / spin.duration;
  }

  function stepCoast(dt) {
    if (index < 0 || index > maxIndex) {
      const edge = index < 0 ? 0 : maxIndex;
      velocity += (edge - index) * 70 * dt - velocity * 14 * dt;
      index += velocity * dt;
      const backInside = (edge === 0 && index >= 0) || (edge === maxIndex && index <= maxIndex);
      if (backInside && Math.abs(velocity) < SNAP_AT) armSpring(edge);
      else if (Math.abs(index - edge) < 0.008 && Math.abs(velocity) < 0.06) {
        index = edge;
        finishIdle();
      }
      return;
    }

    const sign = Math.sign(velocity);
    if (sign === 0) {
      armSpring(clamp(Math.round(index)));
      return;
    }
    const nextV = velocity - sign * FRICTION * dt;
    if (Math.sign(nextV) !== sign) {
      velocity = 0;
      armSpring(clamp(Math.round(index)));
      return;
    }
    velocity = nextV;
    index += velocity * dt;
    if (index < 0 || index > maxIndex) {
      const edge = index < 0 ? 0 : maxIndex;
      const over = index - edge;
      index = edge + Math.sign(over) * Math.min(Math.abs(over) * RUBBER, RUBBER_LIMIT);
      if ((index - edge) * velocity > 0) velocity *= 0.45;
      return;
    }
    if (Math.abs(velocity) < SNAP_AT) armSpring(clamp(Math.round(index)));
  }

  function stepSpring(dt) {
    const offset = index - target;
    velocity += (-SPRING * offset - DAMPING * velocity) * dt;
    index += velocity * dt;
    if (Math.abs(index - target) < 0.0015 && Math.abs(velocity) < 0.02) {
      index = target;
      finishIdle();
    }
  }

  function frame(now) {
    const dt = Math.min(0.034, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (phase === "coast") stepCoast(dt);
    else if (phase === "spring") stepSpring(dt);
    else if (phase === "spin") stepSpin(now);
    paint();
    if (phase === "coast" || phase === "spring" || phase === "spin") {
      raf = requestAnimationFrame(frame);
      return;
    }
    raf = 0;
    root.classList.remove("is-gliding", "is-dragging");
    // Drop the inline transition only after this frame's transform is committed,
    // so restoring the stylesheet transition does not replay the settle.
    window.requestAnimationFrame(() => {
      if (phase !== "idle") return;
      buttons.forEach((button) => {
        button.closest(".flow-cover").style.transition = "";
      });
    });
  }

  function release(speed) {
    velocity = clampSpeed(speed);
    if ((index < 0 || index > maxIndex) && (index < 0 ? velocity < 0 : velocity > 0)) velocity = 0;
    if (Math.abs(velocity) < SNAP_AT) {
      const edge = index < 0 ? 0 : index > maxIndex ? maxIndex : clamp(Math.round(index));
      startSpring(edge);
      return;
    }
    startCoast();
  }

  // event.timeStamp and performance.now() stay on their own clocks. iOS Safari's
  // touchend.timeStamp uses a different origin from performance.now() (and sometimes
  // from the touchmove stamps). Subtracting those values made every flick look
  // paused, so release() took the settle spring — one cover, fixed ease, no coast.
  function eventStamp(event) {
    const stamp = event && event.timeStamp;
    if (typeof stamp === "number" && Number.isFinite(stamp) && stamp > 0) return stamp;
    return performance.now();
  }

  function pushSample(samples, x, stamp, now) {
    const prev = samples[samples.length - 1];
    if (prev) {
      const gap = stamp - prev.stamp;
      if (!(gap >= 0 && gap < 2000)) stamp = prev.stamp + Math.max(0, now - prev.now);
    }
    // A stationary touchmove repeats the last coordinate. Keeping it stretches
    // the window and makes a fast flick look like it stopped.
    if (prev && Math.abs(x - prev.x) < 1) return;
    samples.push({ x, stamp, now });
    while (samples.length > 2 && stamp - samples[0].stamp > SAMPLE_MS) samples.shift();
  }

  function speedFrom(samples, lastEventNow, upNow, sawMove) {
    if (samples.length < 2) return 0;
    // Time since the last touchmove, on performance.now() only. A stationary
    // sample refreshes lastEventNow without entering the velocity window, so a
    // touchend 60–120ms later still counts as a flick. touchend.timeStamp is
    // not read here.
    if (sawMove && upNow - lastEventNow > RELEASE_GAP) return 0;
    const last = samples[samples.length - 1];
    const stampSpan = last.stamp - samples[0].stamp;
    const useStamp = stampSpan >= 8 && stampSpan < 2000;
    const recent = samples.filter((sample) => {
      const age = useStamp ? last.stamp - sample.stamp : last.now - sample.now;
      return age >= 0 && age <= SAMPLE_MS;
    });
    const windowed = recent.length >= 2 ? recent : samples;
    const first = windowed[0];
    const dx = first.x - last.x;
    if (Math.abs(dx) < 2) return 0;
    let dt = useStamp ? last.stamp - first.stamp : last.now - first.now;
    if (!(dt >= 8)) dt = Math.max(16, (windowed.length - 1) * 16);
    return (dx / span()) / (dt / 1000);
  }

  // preserve-3d hit testing misses part of a rotated sleeve, so a tap uses the cover's box.
  function coverIndexAt(clientX, clientY) {
    let best = null;
    buttons.forEach((button, item) => {
      const rect = button.closest(".flow-cover").getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
      const distance = Math.abs(item - index);
      if (!best || distance < best.distance) best = { item, distance };
    });
    return best ? best.item : null;
  }

  function step(direction) {
    closeFlip();
    const spinning = phase === "spin";
    const carried = spinning ? velocity : 0;
    const base = phase === "spring" ? target : clamp(Math.round(index));
    const dest = clamp(base + direction);
    if (dest === base && phase !== "coast" && !spinning) return;
    // A key at the end of the row still has to cancel a running spin.
    if (dest === base && spinning) {
      spin = null;
      if (Math.abs(carried) >= SNAP_AT) release(carried);
      else startSpring(base);
      return;
    }
    goTo(dest);
    const active = document.activeElement;
    if (active && stage.contains(active)) buttons[dest].focus();
  }

  let cancelTimer = 0;

  function beginDrag(id, kind, x, y, stamp, now) {
    const carried = phase === "spin" ? velocity : 0;
    spin = null;
    stopLoop();
    window.clearTimeout(wheelTimer);
    wheelTimer = 0;
    const moving = phase === "coast" || phase === "spring" || phase === "wheel" || phase === "spin";
    if (moving) phase = "drag";
    velocity = 0;
    drag = {
      id,
      kind,
      originX: x,
      originY: y,
      originStamp: stamp,
      originNow: now,
      startIndex: index,
      grabIndex: index,
      moved: false,
      axis: null,
      sawMove: false,
      lastEventNow: now,
      carried,
      interrupted: moving,
      samples: [{ x, stamp, now }],
    };
  }

  function claimHorizontal() {
    closeFlip();
    if (drag.axis === "x") return;
    drag.axis = "x";
    drag.moved = true;
    drag.grabIndex = index;
    window.clearTimeout(wheelTimer);
    wheelTimer = 0;
    window.clearTimeout(cancelTimer);
    cancelTimer = 0;
    stopLoop();
    phase = "drag";
    velocity = 0;
    freezeTransitions();
    root.classList.add("is-dragging");
    root.classList.remove("is-gliding");
  }

  // Touch never recenters on the cover under the finger once the finger has
  // actually moved. That path was goTo(one cover) plus the 480ms CSS ease.
  function promoteSwipe(info, upNow, point) {
    if (info.kind !== "touch" || !point || info.axis === "x") return;
    const dx = point.x - info.originX;
    const dy = point.y - info.originY;
    if (!horizontalIntent(dx, dy)) return;
    closeFlip();
    const endStamp = info.originStamp + Math.max(0, upNow - info.originNow);
    pushSample(info.samples, point.x, endStamp, upNow);
    info.axis = "x";
    info.moved = true;
    info.grabIndex = info.startIndex;
    freezeTransitions();
    root.classList.add("is-dragging");
    root.classList.remove("is-gliding");
    phase = "drag";
    index = resist(info.startIndex - dx / span());
  }

  function finishDrag(info, upNow, point) {
    if (drag === info) drag = null;
    window.clearTimeout(cancelTimer);
    cancelTimer = 0;
    promoteSwipe(info, upNow, point);
    // Any touch, including a tap, owns the follow-up click. Otherwise iOS
    // synthesizes a click on the button and goTo() pulls the row back to it.
    if (info.kind === "touch") armIgnoreClick();

    if (!info.moved) {
      if (info.axis === "y") {
        note("vertical", info.carried || 0, info.samples.length, "y");
        if (phase === "drag") release(info.carried || 0);
        return;
      }
      if (point) {
        const link = backLinkAt(point.x, point.y);
        if (link) {
          if (info.kind !== "touch") armIgnoreClick();
          note("link", 0, info.samples.length, "none");
          followBackLink(link);
          return;
        }
        const picked = coverIndexAt(point.x, point.y);
        if (picked !== null) {
          if (info.kind !== "touch") armIgnoreClick();
          note("tap", 0, info.samples.length, "none");
          activateCover(picked, info.interrupted);
          return;
        }
      }
      if (phase === "drag") {
        if (info.carried && Math.abs(info.carried) >= SNAP_AT) {
          note("coast", info.carried, info.samples.length, info.axis || "none");
          release(info.carried);
          return;
        }
        phase = "idle";
        velocity = 0;
        root.classList.remove("is-dragging", "is-gliding");
      }
      note("none", 0, info.samples.length, info.axis || "none");
      return;
    }

    if (info.kind !== "touch") armIgnoreClick();
    const speed = clampSpeed(speedFrom(info.samples, info.lastEventNow, upNow, info.sawMove));
    note(Math.abs(speed) < SNAP_AT ? "spring" : "coast", speed, info.samples.length, "x");
    release(speed);
  }

  function trackDrag(x, y, stamp, now) {
    pushSample(drag.samples, x, stamp, now);
    const dx = x - drag.originX;
    const dy = y - drag.originY;
    if (drag.axis !== "x") {
      if (!horizontalIntent(dx, dy)) {
        // Tentative only. A later sample can still lock horizontal.
        if (Math.hypot(dx, dy) >= LOCK_PX && Math.abs(dy) > Math.abs(dx)) drag.axis = "y";
        renderDebug();
        return false;
      }
      claimHorizontal();
    }
    index = resist(drag.grabIndex - (x - drag.originX) / span());
    paint();
    renderDebug();
    return true;
  }

  // Mouse. Touch is handled on touch events: iOS does not honor preventDefault
  // on pointermove, and pointercancel there replaces pointerup.
  stage.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "touch" || event.button !== 0 || drag) return;
      if (backLinkAt(event.clientX, event.clientY)) return;
      beginDrag(event.pointerId, "mouse", event.clientX, event.clientY, eventStamp(event), performance.now());
    },
    { passive: true },
  );

  stage.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || drag.kind !== "mouse" || event.pointerId !== drag.id) return;
      drag.sawMove = true;
      drag.lastEventNow = performance.now();
      const horizontal = trackDrag(event.clientX, event.clientY, eventStamp(event), drag.lastEventNow);
      if (!horizontal) return;
      if (drag.moved) {
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {
          /* The pointer can vanish before capture on a quick tap. */
        }
      }
      if (event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  stage.addEventListener(
    "pointerup",
    (event) => {
      if (!drag || drag.kind !== "mouse" || event.pointerId !== drag.id) return;
      finishDrag(drag, performance.now(), { x: event.clientX, y: event.clientY });
    },
    { passive: true },
  );

  stage.addEventListener(
    "pointercancel",
    (event) => {
      if (event.pointerType === "touch") {
        // iOS can cancel the pointer and never deliver touchend. Wait long
        // enough that a real touchend (often 60–120ms after the last move)
        // wins; this is only the fallback when the touch stream dies.
        if (!drag || drag.kind !== "touch" || drag.axis !== "x") return;
        const info = drag;
        const now = performance.now();
        window.clearTimeout(cancelTimer);
        cancelTimer = window.setTimeout(() => {
          cancelTimer = 0;
          if (drag !== info) return;
          finishDrag(info, now, { x: event.clientX, y: event.clientY });
        }, 400);
        return;
      }
      if (!drag || drag.kind !== "mouse" || event.pointerId !== drag.id) return;
      if (drag.axis !== "x") {
        drag = null;
        return;
      }
      finishDrag(drag, performance.now(), null);
    },
    { passive: true },
  );

  function touchById(list, id) {
    if (!list) return null;
    for (const touch of list) {
      if (touch.identifier === id) return touch;
    }
    return null;
  }

  // Non-passive. A passive touchstart lets Safari take the gesture and deliver
  // only touchend, which used to fall through to the one-cover tap path.
  stage.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const link = backLinkAt(touch.clientX, touch.clientY);
      if (link) {
        linkTouch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, link };
        return;
      }
      if (drag) return;
      beginDrag(touch.identifier, "touch", touch.clientX, touch.clientY, eventStamp(event), performance.now());
    },
    { passive: false, capture: true },
  );

  // preventDefault only after the gesture locks horizontal, so a vertical pan
  // still scrolls the page. A vertical-first sample does not give up: the lock
  // can still become horizontal.
  stage.addEventListener(
    "touchmove",
    (event) => {
      if (!drag || drag.kind !== "touch") return;
      const touch = touchById(event.touches, drag.id);
      if (!touch) return;
      drag.sawMove = true;
      drag.lastEventNow = performance.now();
      window.clearTimeout(cancelTimer);
      cancelTimer = 0;
      const horizontal = trackDrag(touch.clientX, touch.clientY, eventStamp(event), drag.lastEventNow);
      if (horizontal && event.cancelable) event.preventDefault();
    },
    { passive: false, capture: true },
  );

  function endTouch(event) {
    if (linkTouch) {
      const start = linkTouch;
      linkTouch = null;
      const touch = touchById(event.changedTouches, start.id);
      if (!touch || event.type === "touchcancel") return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.hypot(dx, dy) >= LOCK_PX) return;
      const link = backLinkAt(touch.clientX, touch.clientY) || start.link;
      if (!link) return;
      // Swallow the synthetic click so it is not retargeted onto the sleeve button.
      if (event.cancelable) event.preventDefault();
      armIgnoreClick();
      followBackLink(link);
      return;
    }
    if (!drag || drag.kind !== "touch") return;
    const touch = touchById(event.changedTouches, drag.id);
    if (!touch) {
      if (event.type === "touchcancel") finishDrag(drag, performance.now(), null);
      return;
    }
    const dx = touch.clientX - drag.originX;
    const dy = touch.clientY - drag.originY;
    const willDrag = drag.axis === "x" || drag.moved || horizontalIntent(dx, dy);
    if (willDrag && event.cancelable) event.preventDefault();
    finishDrag(drag, performance.now(), { x: touch.clientX, y: touch.clientY });
  }

  stage.addEventListener("touchend", endTouch, { passive: false, capture: true });
  stage.addEventListener("touchcancel", endTouch, { passive: true, capture: true });

  stage.addEventListener(
    "click",
    (event) => {
      if (openingLink) return;
      if (ignoreClick || performance.now() < swallowClicksUntil) {
        ignoreClick = false;
        swallowClicksUntil = 0;
        window.clearTimeout(ignoreTimer);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const link = pointHitsBackLink(event);
      if (link) {
        const direct = event.target && event.target.closest ? event.target.closest(".flow-back a") : null;
        if (direct === link) return;
        event.preventDefault();
        event.stopPropagation();
        followBackLink(link);
        return;
      }
      const back = event.target.closest && event.target.closest(".flow-back");
      if (back && stage.contains(back)) {
        event.preventDefault();
        closeFlip({ animate: true });
        return;
      }
      const button = event.target.closest(".flow-select");
      if (!button || !stage.contains(button)) return;
      const next = Number(button.dataset.index);
      if (!Number.isInteger(next)) return;
      note("click", 0, 0, "none");
      activateCover(next, false);
    },
    true,
  );

  function endWheel() {
    wheelTimer = 0;
    const samples = wheelSamples;
    wheelSamples = [];
    if (phase !== "wheel") return;
    if (index < 0 || index > maxIndex) {
      velocity = 0;
      startSpring(index < 0 ? 0 : maxIndex);
      return;
    }
    // One isolated notch has no real release speed. Coast the rest of a single album.
    if (samples.length === 1 && Math.abs(samples[0].d) >= 0.35) {
      const sign = Math.sign(samples[0].d);
      const remain = Math.max(0, 1 - Math.abs(samples[0].d));
      velocity = remain < 0.05 ? 0 : clampSpeed(sign * Math.sqrt(2 * FRICTION * remain));
    }
    if (Math.abs(velocity) >= SNAP_AT) startCoast();
    else startSpring(clamp(Math.round(index)));
  }

  stage.addEventListener(
    "wheel",
    (event) => {
      let dx = event.deltaX;
      const dy = event.deltaY;
      const verticalDominant = Math.abs(dx) <= Math.abs(dy);
      if (verticalDominant && event.shiftKey && dy !== 0) dx = dy;
      else if (verticalDominant) return;
      if (dx === 0) return;
      event.preventDefault();
      closeFlip();
      if (event.deltaMode === 1) dx *= 16;
      else if (event.deltaMode === 2) dx *= stage.clientWidth;

      const now = performance.now();
      if (phase === "spin") velocity = clampSpeed(velocity);
      spin = null;
      stopLoop();
      phase = "wheel";
      freezeTransitions();
      root.classList.add("is-gliding");

      const deltaIndex = dx / span();
      index = resist(index + deltaIndex);
      wheelSamples.push({ d: deltaIndex, t: now });
      wheelSamples = wheelSamples.filter((sample) => now - sample.t <= SAMPLE_MS);
      if (wheelSamples.length >= 2) {
        const elapsed = now - wheelSamples[0].t;
        if (elapsed >= 16) {
          const sum = wheelSamples.reduce((total, sample) => total + sample.d, 0);
          velocity = clampSpeed((sum / elapsed) * 1000);
        }
      }
      paint();
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(endWheel, WHEEL_QUIET_MS);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (flipped === null && !(flipJob && flipJob.to === 180)) return;
      event.preventDefault();
      closeFlip({ animate: true });
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
      return;
    }
    event.preventDefault();
    step(event.key === "ArrowRight" ? 1 : -1);
  });

  const resize = new ResizeObserver(() => {
    measure();
    root.classList.add("is-instant");
    paint();
    window.requestAnimationFrame(() => root.classList.remove("is-instant"));
  });
  resize.observe(stage);

  stage.style.touchAction = "pan-y";
  stage.querySelectorAll("*").forEach((el) => {
    if (el.closest(".flow-back a")) return;
    el.style.touchAction = "pan-y";
  });
  stage.querySelectorAll(".flow-back a").forEach((el) => {
    el.style.setProperty("touch-action", "manipulation", "important");
  });

  if (debugOn) {
    debugEl = document.createElement("div");
    debugEl.setAttribute("data-coverflow-debug", "");
    debugEl.setAttribute("aria-hidden", "true");
    debugEl.style.cssText = [
      "position:fixed",
      "z-index:10000",
      "left:12px",
      "right:12px",
      "bottom:max(12px, env(safe-area-inset-bottom))",
      "margin:0",
      "padding:10px 12px",
      "background:#000",
      "color:#b6ff4a",
      "border:1px solid #b6ff4a",
      "border-radius:8px",
      "font:13px/1.35 ui-monospace, SFMono-Regular, monospace",
      "white-space:pre",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(debugEl);
    renderDebug();
  }

  if (randomBtn) {
    randomBtn.style.touchAction = "manipulation";
    randomBtn.addEventListener("click", onRandom);
  }

  measure();
  paint();
  window.requestAnimationFrame(() => root.classList.add("is-ready"));
})();
