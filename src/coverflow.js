(function () {
  const root = document.querySelector("[data-coverflow]");
  if (!root) return;

  const stage = root.querySelector(".flow-stage");
  const buttons = [...root.querySelectorAll(".flow-select")];
  const panels = [...root.querySelectorAll(".flow-panel")];
  const live = root.querySelector("#flow-live");
  if (!stage || buttons.length === 0) return;

  // Layout. The centered sleeve is flat. The first side cover sits `stride` cover-widths
  // away (a clear gap), then each further cover is only `pack` cover-widths over,
  // rotated by `tilt` and set back so the sides read as a tight stack of records.
  // Wide values match the pre-script CSS. Narrow screens use a slightly steeper
  // angle and a shorter stride so several sleeves still fit beside the center.
  let tilt = 68;
  let stride = 1.06;
  let pack = 0.18;

  // Direction lock. Until the finger has moved LOCK_PX, the gesture is undecided.
  // A tie goes to vertical so anything that is not clearly horizontal scrolls the page.
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
  const SAMPLE_MS = 70;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const maxIndex = buttons.length - 1;

  let index = 0;
  let shown = 0;
  let coverWidth = 0;
  let drag = null;
  let ignoreClick = false;
  let phase = "idle";
  let velocity = 0;
  let target = 0;
  let raf = 0;
  let lastFrame = 0;
  let wheelTimer = 0;
  let wheelBucket = 0;
  let wheelSamples = [];

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
    tilt = narrow ? 70 : 68;
    stride = narrow ? 0.9 : 1.06;
    pack = narrow ? 0.16 : 0.18;
  }

  function place(delta) {
    const distance = Math.abs(delta);
    const sign = delta < 0 ? -1 : delta > 0 ? 1 : 0;
    const x =
      distance <= 1
        ? delta * coverWidth * stride
        : sign * coverWidth * (stride + (distance - 1) * pack);
    const rot = -sign * tilt * Math.min(distance, 1);
    const zBack = stage.clientWidth < 620 ? 118 : 76;
    const z = distance <= 1 ? 36 - distance * (zBack + 36) : -zBack - Math.min(distance - 1, 14) * 4;
    const opacity = distance > 18 ? 0 : distance > 15 ? 1 - (distance - 15) / 3 : 1;
    return { x, rot, z, opacity };
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
    buttons.forEach((button, item) => {
      const cover = button.closest(".flow-cover");
      const spot = place(item - index);
      cover.style.transform = `translate3d(${Math.round(spot.x)}px, 0, ${Math.round(spot.z)}px) rotateY(${spot.rot.toFixed(2)}deg)`;
      cover.style.zIndex = String(1000 - Math.round(Math.abs(item - index) * 10));
      cover.style.opacity = spot.opacity < 1 ? spot.opacity.toFixed(3) : "";
      cover.style.pointerEvents = spot.opacity === 0 ? "none" : "";
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
  }

  function snap(next) {
    window.clearTimeout(wheelTimer);
    wheelTimer = 0;
    stopLoop();
    index = clamp(next);
    finishIdle();
    root.classList.remove("is-gliding", "is-dragging");
    paint();
  }

  function goTo(next) {
    if (reducedMotion.matches) {
      snap(next);
      return;
    }
    velocity = 0;
    startSpring(next);
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
    paint();
    if (phase === "coast" || phase === "spring") {
      raf = requestAnimationFrame(frame);
      return;
    }
    raf = 0;
    root.classList.remove("is-gliding", "is-dragging");
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

  function speedFrom(samples, upTime) {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    if (upTime - last.t > 50) return 0;
    const recent = samples.filter((sample) => last.t - sample.t <= SAMPLE_MS);
    const first = recent[0];
    const dt = last.t - first.t;
    if (dt < 12) return 0;
    const albums = (first.x - last.x) / span();
    return (albums / dt) * 1000;
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
    const base = phase === "spring" ? target : clamp(Math.round(index));
    const dest = clamp(base + direction);
    if (dest === base && phase !== "coast") return;
    goTo(dest);
    const active = document.activeElement;
    if (active && stage.contains(active)) buttons[dest].focus();
  }

  function lockHorizontal(event) {
    drag.axis = "x";
    drag.moved = true;
    drag.startIndex = index;
    drag.x = event.clientX;
    drag.samples = [{ x: event.clientX, t: performance.now() }];
    window.clearTimeout(wheelTimer);
    wheelTimer = 0;
    stopLoop();
    phase = "drag";
    velocity = 0;
    root.classList.add("is-dragging");
    root.classList.remove("is-gliding");
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer can vanish before capture on a quick tap. */
    }
  }

  stage.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || drag) return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startIndex: index,
        moved: false,
        axis: null,
        samples: [{ x: event.clientX, t: performance.now() }],
      };
    },
    { passive: true },
  );

  stage.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.id || drag.axis === "y") return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < LOCK_PX) return;
        // Only a clearly horizontal move claims the gesture. Otherwise the page scrolls.
        if (Math.abs(dx) > Math.abs(dy)) lockHorizontal(event);
        else {
          drag.axis = "y";
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      drag.samples.push({ x: event.clientX, t: now });
      if (drag.samples.length > 6) drag.samples.shift();
      index = resist(drag.startIndex - (event.clientX - drag.x) / span());
      paint();
    },
    { passive: false },
  );

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const info = drag;
    drag = null;
    if (info.axis === "y") {
      ignoreClick = true;
      return;
    }
    if (!info.moved) {
      const picked = coverIndexAt(event.clientX, event.clientY);
      if (picked !== null) {
        ignoreClick = true;
        goTo(picked);
      }
      return;
    }
    ignoreClick = true;
    root.classList.remove("is-dragging");
    if (reducedMotion.matches) {
      snap(Math.round(index));
      return;
    }
    release(speedFrom(info.samples, performance.now()));
  }

  stage.addEventListener("pointerup", endDrag, { passive: true });
  stage.addEventListener(
    "pointercancel",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const info = drag;
      drag = null;
      if (info.axis !== "x") return;
      ignoreClick = true;
      root.classList.remove("is-dragging");
      if (reducedMotion.matches) snap(Math.round(index));
      else release(speedFrom(info.samples, performance.now()));
    },
    { passive: true },
  );

  stage.addEventListener("click", (event) => {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    const button = event.target.closest(".flow-select");
    if (!button || !stage.contains(button)) return;
    const next = Number(button.dataset.index);
    if (!Number.isInteger(next)) return;
    goTo(next);
  });

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
      if (event.deltaMode === 1) dx *= 16;
      else if (event.deltaMode === 2) dx *= stage.clientWidth;

      if (reducedMotion.matches) {
        wheelBucket += dx;
        if (Math.abs(wheelBucket) < 48) return;
        const direction = wheelBucket > 0 ? 1 : -1;
        wheelBucket = 0;
        step(direction);
        return;
      }

      const now = performance.now();
      stopLoop();
      phase = "wheel";
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

  measure();
  paint();
  window.requestAnimationFrame(() => root.classList.add("is-ready"));
})();
