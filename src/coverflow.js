(function () {
  const root = document.querySelector("[data-coverflow]");
  if (!root) return;

  const stage = root.querySelector(".flow-stage");
  const buttons = [...root.querySelectorAll(".flow-select")];
  const panels = [...root.querySelectorAll(".flow-panel")];
  const live = root.querySelector("#flow-live");
  if (!stage || buttons.length === 0) return;

  const ROTATION = 58;
  const STEP = 0.78;
  const STACK = 0.34;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let index = 0;
  let shown = 0;
  let coverWidth = 0;
  let drag = null;
  let ignoreClick = false;
  let pending = false;
  let wheelTimer = 0;
  let wheelBucket = 0;

  function clamp(value) {
    return Math.min(buttons.length - 1, Math.max(0, value));
  }

  function measure() {
    coverWidth = buttons[0].closest(".flow-cover").offsetWidth || coverWidth;
  }

  function place(delta) {
    const distance = Math.abs(delta);
    const sign = delta < 0 ? -1 : delta > 0 ? 1 : 0;
    const x =
      distance <= 1
        ? delta * coverWidth * STEP
        : sign * (coverWidth * STEP + (distance - 1) * coverWidth * STACK);
    const turn = Math.min(distance, 1);
    const rot = -sign * ROTATION * turn;
    const z = distance <= 1 ? 70 - distance * 98 : -28 - Math.min(distance - 1, 8) * 16;
    const opacity = distance > 8 ? 0 : distance > 6 ? 1 - (distance - 6) / 2 : 1;
    return { x, rot, z, opacity };
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
      cover.style.zIndex = String(100 - Math.round(Math.abs(item - index) * 10));
      cover.style.opacity = spot.opacity < 1 ? spot.opacity.toFixed(3) : "";
      cover.style.pointerEvents = spot.opacity === 0 ? "none" : "";
    });
    syncCaption(clamp(Math.round(index)));
  }

  function requestPaint() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      paint();
    });
  }

  function settle(next) {
    index = clamp(next);
    root.classList.remove("is-dragging");
    paint();
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
    const next = clamp(Math.round(index) + direction);
    if (next === Math.round(index)) return;
    settle(next);
    const active = document.activeElement;
    if (active && stage.contains(active)) buttons[index].focus();
  }

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      startIndex: index,
      moved: false,
      lastX: event.clientX,
      lastT: performance.now(),
      velocity: 0,
    };
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer can vanish before capture on a quick tap. */
    }
  });

  stage.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 8) return;
    drag.moved = true;
    root.classList.add("is-dragging");
    const now = performance.now();
    const dt = now - drag.lastT;
    if (dt > 0) drag.velocity = (drag.lastX - event.clientX) / dt;
    drag.lastX = event.clientX;
    drag.lastT = now;
    const span = Math.max(coverWidth * STEP, 1);
    index = clamp(drag.startIndex - dx / span);
    requestPaint();
  });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    const velocity = drag.velocity;
    const startIndex = drag.startIndex;
    drag = null;
    if (!moved) {
      root.classList.remove("is-dragging");
      const picked = coverIndexAt(event.clientX, event.clientY);
      if (picked !== null) {
        ignoreClick = true;
        settle(picked);
      }
      return;
    }
    ignoreClick = true;
    if (reducedMotion.matches) {
      settle(Math.round(index));
      return;
    }
    const span = Math.max(coverWidth * STEP, 1);
    const boost = Math.max(-0.65, Math.min(0.65, (velocity * 180) / span));
    const traveled = index - startIndex;
    const limitedBoost = Math.sign(traveled) === 0 || Math.sign(boost) === Math.sign(traveled) ? boost : 0;
    settle(Math.round(index + limitedBoost));
  }

  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  stage.addEventListener("click", (event) => {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    const button = event.target.closest(".flow-select");
    if (!button || !stage.contains(button)) return;
    const next = Number(button.dataset.index);
    if (!Number.isInteger(next)) return;
    settle(next);
  });

  stage.addEventListener(
    "wheel",
    (event) => {
      let dx = event.deltaX;
      const dy = event.deltaY;
      if (event.shiftKey && Math.abs(dx) < Math.abs(dy)) dx = dy;
      else if (Math.abs(dx) <= Math.abs(dy)) return;
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

      root.classList.add("is-dragging");
      index = clamp(index + dx / Math.max(coverWidth * 0.9, 1));
      requestPaint();
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelTimer = 0;
        settle(Math.round(index));
      }, 90);
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
