(function () {
  // Desktop apps. Phones and tablets keep the plain https href: iOS and Android
  // already open Spotify and Apple Music through universal links. A primary
  // click elsewhere tries the app, then the web URL if the page is still here
  // after a second. Middle-click and modified clicks use the href as written.
  const APP_OPEN_MS = 1000;
  const SPOTIFY_TYPES = { track: 1, album: 1, playlist: 1, artist: 1, episode: 1, show: 1 };

  function clientKind() {
    const ua = navigator.userAgent || "";
    const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    if (/Android|iPhone|iPad|iPod/i.test(ua) || touchMac) return "mobile";
    if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
    return "desktop";
  }

  function spotifyAppUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return "";
    }
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] && /^intl-[a-z]{2}$/i.test(parts[0])) parts.shift();
    if (parts.length < 2) return "";
    const type = parts[0];
    const id = parts[1];
    if (!SPOTIFY_TYPES[type] || !/^[A-Za-z0-9]+$/.test(id)) return "";
    return "spotify:" + type + ":" + id;
  }

  function appleAppUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return "";
    }
    if (url.protocol !== "https:" || url.hostname !== "music.apple.com") return "";
    return "music://" + url.host + url.pathname + url.search;
  }

  function appUrlFor(href) {
    const kind = clientKind();
    if (kind === "mobile") return "";
    const spotify = spotifyAppUrl(href);
    if (spotify) return spotify;
    if (kind === "mac") return appleAppUrl(href);
    return "";
  }

  let appAttempt = 0;

  function openAppOrWeb(appUrl, webUrl) {
    const token = ++appAttempt;
    const page = window.location.href;
    const started = performance.now();
    let left = false;
    // A custom-protocol attempt blurs the window even when no app is installed
    // and the page stays visible. Visibility, pagehide, or a timer that was
    // delayed because the page went to the background means the app took over.
    const markLeft = () => {
      if (document.hidden || document.visibilityState === "hidden") left = true;
    };
    const onPageHide = () => {
      left = true;
    };
    document.addEventListener("visibilitychange", markLeft);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", markLeft);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", markLeft);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("blur", markLeft);
      if (token !== appAttempt || left) return;
      if (window.location.href !== page) return;
      if (document.hidden || document.visibilityState === "hidden") return;
      const elapsed = performance.now() - started;
      if (elapsed > APP_OPEN_MS + 500 && !document.hasFocus()) return;
      window.location.assign(webUrl);
    }, APP_OPEN_MS);
    window.location.assign(appUrl);
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    const link = target && target.closest ? target.closest("a.icon-btn") : null;
    if (!link || !link.getAttribute("href")) return;
    const appUrl = appUrlFor(link.href);
    if (!appUrl) return;
    event.preventDefault();
    openAppOrWeb(appUrl, link.href);
  });

  const root = document.querySelector("[data-coverflow]");
  if (!root) return;
  if (root.hasAttribute("data-virtual")) {
    const url = root.getAttribute("data-entries");
    fetch(url, { credentials: "omit", mode: "cors" })
      .then((res) => {
        if (!res.ok) throw new Error("entries");
        return res.json();
      })
      .then((data) => start(root, decodeEntries(data)))
      .catch(() => start(root, null));
    return;
  }
  start(root, null);

  function decodeEntries(data) {
    if (!data || !Array.isArray(data.entries)) throw new Error("entries");
    return data.entries.map((row) => ({
      id: row[0],
      type: row[1],
      title: row[2],
      artist: row[3],
      album: row[4] || null,
      postedBy: row[5],
      postedAt: row[6],
      spotify: row[7] || null,
      apple: row[8] || null,
      art: row[9] || null,
      number: String(row[10]),
    }));
  }

  function start(root, virtualEntries) {
  const stage = root.querySelector(".flow-stage");
  const virtual = Array.isArray(virtualEntries) && virtualEntries.length > 0;
  // A large crate keeps a holey list: only sleeves near the centre exist.
  // forEach skips holes, and the index is still the catalog position.
  let buttons = virtual ? new Array(virtualEntries.length) : [...root.querySelectorAll(".flow-select")];
  const panels = [...root.querySelectorAll(".flow-panel")];
  const randomBtn = document.querySelector(".flow-random");
  const live = root.querySelector("#flow-live");
  if (!stage || (!virtual && buttons.length === 0)) return;

  // Overlapping stack on the shallow ring, the same ratios on every screen.
  // The first neighbour sits 0.55 sleeve-widths over and each one after that
  // only 0.22, so the centre covers its neighbour and each neighbour covers
  // the next. Depth is still the wide ellipse. A cover off centre turns
  // inward — outer edge back — to 40° at the first step and about 45° further
  // out, easing to 0 at the centre. The inner edge of that turn swings toward
  // the viewer, so `poke` sets it back onto the curve. Each sleeve carries
  // its own perspective(), and the list is flat, so neighbouring planes are
  // never in one 3D space and cannot clip each other. Stride is only the
  // drag scale and does not set the visual gap.
  const PERSPECTIVE = 7.6;
  const ARC_STEP = (36 * Math.PI) / 180;
  const ARC_RATIO = 1.58;
  const Z_SCALE = 0.3;
  const ARC_SCALE = 0.84;
  const STEP = 0.55;
  const PACK = 0.22;
  const TILT_MAX = 45;
  const TILT_K = Math.log(9);
  const POKE_K = 1;
  const LIP = 0.04;
  const LIP_K = 1.4;
  const Z_BIAS = 0.02;
  const FADE_AT = 2.6;
  const FADE_END = 3.5;
  // Past this, the sleeve is fully faded. Skip painting it.
  const RENDER_REACH = 3.6;
  let stride = 1.06;

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

  let maxIndex = virtual ? virtualEntries.length - 1 : buttons.length - 1;
  const mounted = new Set();

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
    const button = buttons[item];
    if (!button) return null;
    return button.closest(".flow-cover").querySelector(".flow-back");
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
    let probe = buttons[0];
    if (!probe && virtual) {
      for (const item of mounted) {
        if (buttons[item]) {
          probe = buttons[item];
          break;
        }
      }
    }
    if (!probe) return;
    coverWidth = probe.closest(".flow-cover").offsetWidth || coverWidth;
    const narrow = stage.clientWidth < 620;
    stride = narrow ? 0.9 : 1.06;
    arcRadius = coverWidth * ARC_RATIO;
    lipPx = coverWidth * LIP;
    zBiasPx = coverWidth * Z_BIAS;
  }

  // x is the overlapping stack: 0.55 sleeve-widths to the first neighbour,
  // then 0.22. z is the shallow ellipse, pulled back by the inward tilt so
  // the inner edge stays behind the sleeve in front. rot is that tilt:
  // positive rotateY on the right sends that cover's right edge back, and
  // the mirror of that on the left. It is 0 at delta 0 and smooth through
  // the centre, so a drag, flick, or shuffle never snaps the angle.
  function place(delta) {
    const distance = Math.abs(delta);
    const absTheta = distance * ARC_STEP;
    const sign = delta < 0 ? -1 : delta > 0 ? 1 : 0;
    const scale = Math.pow(ARC_SCALE, distance);
    const half = (coverWidth * scale) / 2;
    const x =
      distance <= 1
        ? delta * coverWidth * STEP
        : sign * coverWidth * (STEP + (distance - 1) * PACK);
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
    if (virtual) {
      const entry = virtualEntries[active];
      const panel = panels[0];
      if (panel && entry) {
        panel.hidden = false;
        const title = panel.querySelector(".flow-title");
        const artist = panel.querySelector(".flow-artist");
        if (title.textContent !== entry.title) title.textContent = entry.title;
        if (artist.textContent !== entry.artist) artist.textContent = entry.artist;
      }
      for (const item of mounted) {
        const button = buttons[item];
        if (!button) continue;
        if (item === active) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      }
      if (live && entry) {
        const summary = entrySummary(entry);
        if (live.textContent !== summary) live.textContent = summary;
      }
      return;
    }
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
    syncMounts();
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
      // Project this sleeve on its own. k is the old shared-perspective
      // shrink, baked into x and scale, and perspective() only turns this
      // one face. Nothing is left in a shared z, so a neighbour cannot cut
      // through the sleeve in front. Opacity stays at 1 so a faded sleeve
      // cannot flatten and jump forward.
      const depth = coverWidth * PERSPECTIVE;
      const k = depth / (depth - spot.z);
      const x = spot.x * k;
      const scale = spot.scale * k;
      cover.style.transform = `perspective(${depth.toFixed(2)}px) translate3d(${x.toFixed(2)}px, 0, 0) rotateY(${spot.rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      // Nearer sleeve on top. The index follows the fractional distance, so
      // the two covers swap exactly at the half-step and not on a settle.
      cover.style.zIndex = String(5000 - Math.round(distance * 1000));
      cover.style.setProperty("--shade", spot.shade.toFixed(3));
      cover.style.setProperty("--reflect", spot.reflect.toFixed(3));
      cover.style.opacity = "";
      cover.style.pointerEvents = spot.shade > 0.97 ? "none" : "";
      if (virtual && wantsArt(item)) refreshArt(item, button);
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
    if (virtual) {
      const far = Math.abs(to - from) > 24;
      const lo = far ? Math.round(to) - 2 : Math.floor(Math.min(from, to)) - 2;
      const hi = far ? Math.round(to) + 2 : Math.ceil(Math.max(from, to)) + 2;
      for (let item = lo; item <= hi; item += 1) warmEntry(item);
      return;
    }
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
      const cover = button.closest(".flow-cover");
      if (cover.classList.contains("is-culled")) return;
      const rect = cover.getBoundingClientRect();
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
    if (active && stage.contains(active) && buttons[dest]) buttons[dest].focus();
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

  const MOUNT_RADIUS = 8;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const NAME_ARTICLES = new Set(["the", "a", "an"]);
  let coverProto = null;
  let coversOl = null;
  const ssrCovers = new Map();
  const freeCovers = [];
  let virtualReady = false;

  function formatPostedAt(iso) {
    const match = String(iso).match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/,
    );
    if (!match) return String(iso);
    const [, year, month, day, hourStr, minute] = match;
    const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
    let hour = Number(hourStr);
    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return `${weekday}, ${MONTHS[Number(month) - 1]} ${Number(day)}, ${year} · ${hour}:${minute} ${suffix}`;
  }

  function formatFlipDate(iso) {
    const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (!match) return String(iso);
    return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
  }

  function monogram(artist) {
    const words = String(artist)
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9]/gi, ""))
      .filter(Boolean);
    const usable = words[0] && NAME_ARTICLES.has(words[0].toLowerCase()) ? words.slice(1) : words;
    const pick = usable.length > 0 ? usable : words;
    if (pick.length === 0) return "•";
    const first = pick[0][0];
    const second = pick.length > 1 ? pick[pick.length - 1][0] : pick[0][1] || "";
    return (first + second).toUpperCase();
  }

  function posterSlug(name) {
    return String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function entrySummary(entry) {
    return `${entry.title}, ${entry.artist}, posted by ${entry.postedBy}, ${formatPostedAt(entry.postedAt)}`;
  }

  function httpsOnly(url) {
    return typeof url === "string" && url.startsWith("https://") ? url : "";
  }

  function warmEntry(item) {
    const entry = virtualEntries[item];
    const src = entry && httpsOnly(entry.art);
    if (!src || warmedSrc.has(src)) return;
    warmedSrc.add(src);
    const warm = new Image();
    warm.decoding = "async";
    warm.src = src;
    warmers.push(warm);
  }

  function wantsArt(item) {
    const entry = virtualEntries[item];
    if (!entry || !httpsOnly(entry.art)) return false;
    // A long shuffle is a blur. Preload only the record it lands on.
    // primeArtwork has already started that fetch.
    if (spin && Math.abs(spin.to - spin.from) > 24) {
      return Math.abs(item - spin.to) <= 2 && Math.abs(item - index) <= MOUNT_RADIUS;
    }
    // Sleeves past the visible arc stay mounted so a swipe has a node, but
    // they do not fetch. RENDER_REACH is 3.6.
    return Math.abs(item - index) <= 3.4;
  }

  function wantsBackArt(item) {
    if (!virtualEntries[item] || !httpsOnly(virtualEntries[item].art)) return false;
    if (flipped === item) return true;
    if (spin && Math.abs(item - spin.to) <= 1 && Math.abs(index - spin.to) < 4) return true;
    return Math.abs(item - index) < 0.5 && (!spin || Math.abs(spin.to - spin.from) <= 24);
  }

  function makeImg(src, lazy, priority) {
    const img = document.createElement("img");
    img.alt = "";
    img.width = 600;
    img.height = 600;
    img.draggable = false;
    img.decoding = "async";
    if (lazy) img.loading = "lazy";
    if (priority) img.setAttribute("fetchpriority", "high");
    if (src) img.src = src;
    return img;
  }

  function sleeveSrc(node) {
    const img = node && node.querySelector("img");
    return img ? img.getAttribute("src") || "" : "";
  }

  function ensureSleeve(sleeve, entry, item) {
    if (!sleeve) return;
    const art = httpsOnly(entry.art);
    const show = Boolean(art) && wantsArt(item);
    if (show) {
      if (sleeveSrc(sleeve) === art && !sleeve.classList.contains("is-blank")) return;
      sleeve.classList.remove("is-blank");
      let img = sleeve.querySelector("img");
      if (!img) {
        sleeve.replaceChildren();
        sleeve.appendChild(makeImg(art, Math.abs(item - index) >= 1.2, Math.abs(item - index) < 0.5));
        return;
      }
      img.hidden = false;
      img.loading = Math.abs(item - index) >= 1.2 ? "lazy" : "eager";
      if (img.getAttribute("src") !== art) img.src = art;
      return;
    }
    if (art && sleeveSrc(sleeve) === art) return;
    if (!art) {
      if (sleeve.classList.contains("is-blank") && sleeve.querySelector(".flow-mark")) return;
      sleeve.classList.add("is-blank");
      sleeve.replaceChildren();
      const mark = document.createElement("span");
      mark.className = "flow-mark";
      mark.textContent = monogram(entry.artist);
      sleeve.appendChild(mark);
      return;
    }
    if (sleeve.classList.contains("is-blank") && !sleeve.querySelector("img")) return;
    sleeve.classList.add("is-blank");
    sleeve.replaceChildren();
  }

  function ensureReflect(reflect, entry, item) {
    if (!reflect) return;
    const art = httpsOnly(entry.art);
    const show = Boolean(art) && wantsArt(item);
    if (show) {
      if (sleeveSrc(reflect) === art && !reflect.classList.contains("is-blank")) return;
      reflect.classList.remove("is-blank");
      let img = reflect.querySelector("img");
      if (!img) {
        reflect.replaceChildren();
        reflect.appendChild(makeImg(art, true, false));
        return;
      }
      if (img.getAttribute("src") !== art) img.src = art;
      return;
    }
    if (art && sleeveSrc(reflect) === art) return;
    if (reflect.classList.contains("is-blank") && !reflect.querySelector("img")) return;
    reflect.classList.add("is-blank");
    reflect.replaceChildren();
  }

  function setService(li, url) {
    if (!li) return;
    const link = li.querySelector("a");
    if (!link) return;
    if (!url) {
      li.hidden = true;
      link.removeAttribute("href");
      return;
    }
    li.hidden = false;
    if (link.getAttribute("href") !== url) link.setAttribute("href", url);
  }

  function stampTouch(cover) {
    cover.querySelectorAll("*").forEach((el) => {
      if (el.closest(".flow-back a")) return;
      el.style.touchAction = "pan-y";
    });
    cover.querySelectorAll(".flow-back a").forEach((el) => {
      el.style.setProperty("touch-action", "manipulation", "important");
    });
  }

  function fillCover(cover, entry, item) {
    cover._blanked = false;
    const button = cover.querySelector(".flow-select");
    button.dataset.index = String(item);
    button.dataset.summary = entrySummary(entry);
    button.setAttribute("aria-label", `${entry.title} by ${entry.artist}`);
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-current");
    const flip = cover.querySelector(".flow-flip");
    if (flip) flip.style.transform = "rotateY(0deg)";
    cover.classList.remove("is-flipped", "is-showing-back", "is-culled");
    const back = cover.querySelector(".flow-back");
    if (back) {
      back.id = `flow-back-${item}`;
      button.setAttribute("aria-controls", back.id);
      back.hidden = true;
      back.inert = true;
      back.setAttribute("aria-hidden", "true");
      const title = back.querySelector(".flow-back-title");
      const artist = back.querySelector(".flow-back-artist");
      const album = back.querySelector(".flow-back-album");
      const who = back.querySelector(".poster");
      const time = back.querySelector("time");
      if (title) title.textContent = entry.title;
      if (artist) artist.textContent = entry.artist;
      if (album) {
        album.hidden = !entry.album;
        album.textContent = entry.album || "";
      }
      if (who) {
        who.textContent = entry.postedBy;
        const slug = posterSlug(entry.postedBy);
        who.setAttribute("href", slug ? `/p/${slug}/` : "/");
      }
      if (time) {
        time.setAttribute("datetime", entry.postedAt);
        time.textContent = formatFlipDate(entry.postedAt);
      }
      setService(back.querySelector('[data-svc="spotify"]'), httpsOnly(entry.spotify));
      setService(back.querySelector('[data-svc="apple"]'), httpsOnly(entry.apple));
      const art = back.querySelector(".flow-back-art");
      if (art && !wantsBackArt(item)) art.removeAttribute("src");
    }
    ensureSleeve(cover.querySelector(".flow-sleeve"), entry, item);
    ensureReflect(cover.querySelector(".flow-reflect"), entry, item);
    stampTouch(cover);
  }

  function refreshArt(item, button) {
    const entry = virtualEntries[item];
    if (!entry) return;
    const cover = button.closest(".flow-cover");
    ensureSleeve(cover.querySelector(".flow-sleeve"), entry, item);
    ensureReflect(cover.querySelector(".flow-reflect"), entry, item);
    if (!wantsBackArt(item)) return;
    const art = cover.querySelector(".flow-back-art");
    const src = httpsOnly(entry.art);
    if (art && src && art.getAttribute("src") !== src) art.src = src;
  }

  function ensureVirtual() {
    if (!virtual || virtualReady) return;
    virtualReady = true;
    coversOl = stage.querySelector(".flow-covers");
    coversOl.querySelectorAll(".flow-cover").forEach((cover) => {
      const button = cover.querySelector(".flow-select");
      const item = Number(button && button.dataset.index);
      if (Number.isInteger(item)) ssrCovers.set(item, cover);
    });
    const template = document.getElementById("usb-cover");
    const fromTemplate = template && template.content && template.content.querySelector(".flow-cover");
    if (fromTemplate) coverProto = fromTemplate.cloneNode(true);
    else if (ssrCovers.get(0)) {
      coverProto = ssrCovers.get(0).cloneNode(true);
      coverProto.querySelectorAll("img").forEach((img) => img.removeAttribute("src"));
    }
  }

  const slots = [];

  function fastSpin() {
    return Boolean(spin && Math.abs(spin.to - spin.from) > 24);
  }

  // A long glide reuses the same sleeve nodes. Rewriting the back of every
  // cover it passes would drop frames, and those sleeves are a blur.
  function lightBind(cover, entry, item) {
    const button = cover._select || (cover._select = cover.querySelector(".flow-select"));
    button.dataset.index = String(item);
    if (!entry._summary) entry._summary = entrySummary(entry);
    button.dataset.summary = entry._summary;
    button.setAttribute("aria-label", `${entry.title} by ${entry.artist}`);
    if (!cover._blanked) {
      button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-current");
      cover.classList.remove("is-flipped", "is-showing-back", "is-culled");
      const sleeve = cover.querySelector(".flow-sleeve");
      const reflect = cover.querySelector(".flow-reflect");
      if (sleeve) {
        sleeve.classList.add("is-blank");
        sleeve.replaceChildren();
      }
      if (reflect) {
        reflect.classList.add("is-blank");
        reflect.replaceChildren();
      }
      const back = cover.querySelector(".flow-back");
      if (back && !back.hidden) {
        back.hidden = true;
        back.inert = true;
        back.setAttribute("aria-hidden", "true");
      }
      cover._blanked = true;
    }
  }

  function dropUnusedSsr() {
    for (const [, cover] of ssrCovers) {
      cover.querySelectorAll("img").forEach((img) => img.removeAttribute("src"));
      cover.remove();
    }
    ssrCovers.clear();
  }

  function syncMounts() {
    if (!virtual) return;
    ensureVirtual();
    if (!coverProto || !coversOl) return;
    const blurring = fastSpin();
    const radius = blurring ? 4 : MOUNT_RADIUS;
    let lo = Math.max(0, Math.floor(index) - radius);
    let hi = Math.min(maxIndex, Math.ceil(index) + radius);
    if (!blurring && flipped !== null) {
      lo = Math.min(lo, flipped);
      hi = Math.max(hi, flipped);
    }
    if (!blurring && flipJob) {
      lo = Math.min(lo, flipJob.item);
      hi = Math.max(hi, flipJob.item);
    }
    const spare = [];
    for (const slot of slots) {
      if (slot.item >= lo && slot.item <= hi) continue;
      if (flipped === slot.item || (flipJob && flipJob.item === slot.item)) continue;
      delete buttons[slot.item];
      mounted.delete(slot.item);
      slot.item = -1;
      // Parked sleeves stay in the pool, but a leftover transform would keep
      // painting the record this node last showed.
      slot.cover.classList.add("is-culled");
      spare.push(slot);
    }
    for (let item = lo; item <= hi; item += 1) {
      const entry = virtualEntries[item];
      if (!entry) continue;
      if (buttons[item]) {
        const slot = slots.find((candidate) => candidate.item === item);
        if (slot && slot.fast && !blurring) {
          fillCover(slot.cover, entry, item);
          slot.fast = false;
        }
        continue;
      }
      let slot = spare.pop();
      let freshSsr = false;
      if (!slot) {
        const ssr = ssrCovers.get(item);
        let cover;
        if (ssr) {
          ssrCovers.delete(item);
          cover = ssr;
          freshSsr = true;
        } else {
          cover = coverProto.cloneNode(true);
          coversOl.appendChild(cover);
          stampTouch(cover);
        }
        slot = { cover, item: -1, fast: false };
        slots.push(slot);
      }
      slot.item = item;
      slot.fast = blurring && !freshSsr;
      const button = slot.cover.querySelector(".flow-select");
      buttons[item] = button;
      mounted.add(item);
      slot.cover.classList.remove("is-culled");
      if (!slot.cover.isConnected) coversOl.appendChild(slot.cover);
      if (freshSsr) {
        stampTouch(slot.cover);
        if (!wantsArt(item)) {
          slot.cover.querySelectorAll(".flow-sleeve img, .flow-reflect img").forEach((img) => img.removeAttribute("src"));
        }
        if (!wantsBackArt(item)) {
          const backArt = slot.cover.querySelector(".flow-back-art");
          if (backArt) backArt.removeAttribute("src");
        }
      } else if (blurring) lightBind(slot.cover, entry, item);
      else fillCover(slot.cover, entry, item);
    }
    if (ssrCovers.size) dropUnusedSsr();
  }

  function bindVirtualList() {
    const list = document.querySelector("#crate ol.crate");
    const template = document.getElementById("usb-row");
    if (!list || !template || !template.content) return;
    const proto = template.content.querySelector("li");
    if (!proto) return;
    // Rows stay in the document once drawn, in order, so the zebra bands and
    // the native scroller stay exactly as they are for a short crate. Only
    // the next batch is built when the reader gets near the end.
    // A full batch is enough runway for a flick. It is drawn a few rows at a
    // time so inserting it does not hitch the frame the reader is scrolling.
    const CHUNK = 8;
    let rendered = list.children.length;

    function albumLabel(entry) {
      if (entry.album) return { text: entry.album, empty: false };
      if (entry.type === "album") return { text: entry.title, empty: false };
      return { text: "not listed", empty: true };
    }

    function fillRow(li, entry, item) {
      const article = li.querySelector("article");
      article.id = entry.id;
      article.dataset.type = entry.type;
      const thumb = li.querySelector(".thumb");
      const img = thumb.querySelector("img");
      const art = httpsOnly(entry.art);
      const mark = thumb.querySelector(".monogram");
      if (art) {
        thumb.removeAttribute("aria-hidden");
        const alt = `Cover art for ${entry.album || entry.title} by ${entry.artist}`;
        img.alt = alt;
        img.hidden = false;
        img.loading = item < 10 ? "eager" : "lazy";
        if (img.getAttribute("src") !== art) img.src = art;
        if (mark) mark.hidden = true;
      } else {
        thumb.setAttribute("aria-hidden", "true");
        img.hidden = true;
        img.removeAttribute("src");
        let glyph = mark;
        if (!glyph) {
          glyph = document.createElement("span");
          glyph.className = "monogram";
          thumb.appendChild(glyph);
        }
        glyph.hidden = false;
        glyph.textContent = monogram(entry.artist);
      }
      li.querySelector(".kind span").textContent = entry.type;
      li.querySelector(".no").textContent = entry.number;
      li.querySelector("h2").textContent = entry.title;
      li.querySelector(".artist").textContent = entry.artist;
      const album = li.querySelector(".album");
      const named = albumLabel(entry);
      album.textContent = named.text;
      album.classList.toggle("is-empty", named.empty);
      const poster = li.querySelector(".posted .poster");
      poster.textContent = entry.postedBy;
      const slug = posterSlug(entry.postedBy);
      poster.setAttribute("href", slug ? `/p/${slug}/` : "/");
      const time = li.querySelector("time");
      time.setAttribute("datetime", entry.postedAt);
      time.textContent = formatPostedAt(entry.postedAt);
      setService(li.querySelector('[data-svc="spotify"]'), httpsOnly(entry.spotify));
      setService(li.querySelector('[data-svc="apple"]'), httpsOnly(entry.apple));
    }

    function appendUntil(count) {
      const target = Math.min(virtualEntries.length, count);
      if (target <= rendered) return;
      const frag = document.createDocumentFragment();
      for (let item = rendered; item < target; item += 1) {
        const li = proto.cloneNode(true);
        fillRow(li, virtualEntries[item], item);
        frag.appendChild(li);
      }
      list.appendChild(frag);
      rendered = target;
    }

    function nearEnd() {
      const last = list.lastElementChild;
      if (!last) return true;
      const rect = last.getBoundingClientRect();
      const viewH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      return rect.bottom < viewH + viewH * 1.4;
    }

    function pump() {
      if (rendered >= virtualEntries.length) return;
      if (!nearEnd()) return;
      appendUntil(rendered + CHUNK);
      if (rendered < virtualEntries.length && nearEnd()) schedule();
    }

    // Enough rows that the first flick is the native scroller, not a builder.
    appendUntil(Math.min(virtualEntries.length, Math.max(rendered, 48)));

    let queued = 0;
    const schedule = () => {
      if (rendered >= virtualEntries.length || queued) return;
      queued = window.requestAnimationFrame(() => {
        queued = 0;
        pump();
      });
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    function itemFromHash() {
      const id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
      if (!id) return -1;
      return virtualEntries.findIndex((entry) => entry.id === id);
    }

    function scrollToItem(item) {
      if (item < 0) return;
      appendUntil(item + 1);
      const row = list.children[item];
      if (row) row.scrollIntoView({ block: "start" });
    }

    if (itemFromHash() >= 0) scrollToItem(itemFromHash());
    window.addEventListener("hashchange", () => scrollToItem(itemFromHash()));
  }

  syncMounts();
  measure();
  paint();
  if (virtual) bindVirtualList();
  window.requestAnimationFrame(() => root.classList.add("is-ready"));
  }
})();
