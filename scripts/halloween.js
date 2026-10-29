// Seasonal dressing for the crate. Set ENABLED to false to take it down
// immediately. While it is true, the page shows the overlay only from
// October 15 through November 1 (local time), including on a phone that
// still has an older copy of the HTML.

export const HALLOWEEN_ENABLED = true;
export const HALLOWEEN_FROM = { month: 10, day: 15 };
export const HALLOWEEN_TO = { month: 11, day: 1 };

function monthDay(month, day) {
  return month * 100 + day;
}

export function inHalloweenWindow(now) {
  const key = monthDay(now.getMonth() + 1, now.getDate());
  const start = monthDay(HALLOWEEN_FROM.month, HALLOWEEN_FROM.day);
  const end = monthDay(HALLOWEEN_TO.month, HALLOWEEN_TO.day);
  if (start <= end) return key >= start && key <= end;
  return key >= start || key <= end;
}

export function halloweenActive(now = new Date()) {
  return HALLOWEEN_ENABLED && inHalloweenWindow(now);
}

export function assertHalloween() {
  const year = 2026;
  const on = (month, day) => inHalloweenWindow(new Date(year, month - 1, day, 12));
  if (!on(10, 15) || !on(10, 31) || !on(11, 1)) {
    throw new Error("halloween should run from Oct 15 through Nov 1");
  }
  if (on(10, 14) || on(11, 2) || on(1, 1) || on(7, 4)) {
    throw new Error("halloween should be off outside that window");
  }
}

const PUMPKIN = `<svg class="spook-pumpkin" viewBox="0 0 32 32" width="34" height="34" aria-hidden="true" focusable="false"><path fill="#ff7a18" d="M16.2 7.2c.3-2.4 2-3.8 3.2-4 .1 1.8-.8 3.2-1.8 3.8 3.8.6 6.6 3.6 6.6 7.6 0 5-3.4 9.4-8.2 9.4s-8.2-4.4-8.2-9.4c0-4 2.8-7 6.6-7.6-.9-.6-1.8-2-1.7-3.8 1.2.2 2.9 1.6 3.5 4z"/><path fill="#1a0c08" d="M12.4 14.2c.7.4.7 1.4 0 1.8-.6.4-1.4-.1-1.4-.9s.8-1.3 1.4-.9zm7.2 0c.6-.4 1.4.1 1.4.9s-.8 1.3-1.4.9c-.7-.4-.7-1.4 0-1.8zM16 17.1c.6 0 1 .6.7 1.1-.5 1.1-1.9 1.1-2.4 0-.3-.5.1-1.1.7-1.1h1z"/><path fill="#4e9444" d="M15.4 6.4c.4-2.2 1.8-3.6 1.8-3.6s1.2 1.4.2 3.4c-.6.2-1.6.4-2-.2z"/></svg>`;

const BAT = `<svg class="spook-bat" viewBox="0 0 64 32" width="42" height="21" aria-hidden="true" focusable="false"><path fill="#f0e8f8" d="M32 16c-1.6-4.2-6.4-6.2-10.2-4.6-1.4-4.6-7.6-6.4-13-3.2 3.4 1.8 5 5 4.2 7.4-3.4.8-5.2 3.4-4.4 5.8 4.2-2.4 7.6-1.6 10.2.8 1.6-3.2 4-4.8 6.6-4.8s5 1.6 6.6 4.8c2.6-2.4 6-3.2 10.2-.8.8-2.4-1-5-4.4-5.8-.8-2.4.8-5.6 4.2-7.4-5.4-3.2-11.6-1.4-13 3.2C38.4 9.8 33.6 11.8 32 16z"/></svg>`;

// Corner cobweb, drawn from the top-left. The other corners mirror it.
const WEB = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g fill="none" stroke="#f3eef8" stroke-width="1.25"><path d="M0 0h100M0 0v100M0 0 100 22M0 0 100 48M0 0 100 74M0 0 78 100M0 0 48 100M0 0 22 100"/><path d="M16 0c5 6 6 12-1 18M32 0c8 10 8 20-2 30M50 0c12 14 12 30-2 46M68 0c16 18 16 40-2 60"/><path d="M0 16c6 5 12 6 18-1M0 32c10 8 20 8 30-2M0 50c14 12 30 12 46-2M0 68c18 16 40 16 60-2"/></g></svg>`;

const SPIDER = `<span class="spook-spider-wiggle"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="none" stroke="#f4eef8" stroke-width="1.15" stroke-linecap="round"><path d="M16 14 7 6M16 14 5 11M16 15 6 18M16 16 8 25M16 14 25 6M16 14 27 11M16 15 26 18M16 16 24 25"/></g><ellipse cx="16" cy="17" rx="3.1" ry="4.2" fill="#f7f2fb" stroke="#2a2030" stroke-width="0.45"/><circle cx="16" cy="12.2" r="2.15" fill="#f7f2fb" stroke="#2a2030" stroke-width="0.45"/></svg></span>`;

export function halloweenDecor() {
  if (!HALLOWEEN_ENABLED) return { stage: "", marks: "", attrs: "" };
  const from = `${HALLOWEEN_FROM.month}-${HALLOWEEN_FROM.day}`;
  const to = `${HALLOWEEN_TO.month}-${HALLOWEEN_TO.day}`;
  const attrs = ` data-halloween-from="${from}" data-halloween-to="${to}"`;
  const stage = `    <div class="spook-stage" aria-hidden="true"><span class="spook-web spook-web-nw">${WEB}</span><span class="spook-web spook-web-ne">${WEB}</span><span class="spook-web spook-web-sw">${WEB}</span><span class="spook-web spook-web-se">${WEB}</span><span class="spook-fog"></span><span class="spook-flyer spook-flyer-a">${BAT}</span><span class="spook-flyer spook-flyer-b">${BAT}</span><span class="spook-flyer spook-flyer-c">${BAT}</span><span class="spook-mote"></span><span class="spook-mote spook-mote-b"></span><span class="spook-spider spook-spider-a">${SPIDER}</span><span class="spook-spider spook-spider-b">${SPIDER}</span><span class="spook-spider spook-spider-c">${SPIDER}</span><span class="spook-spider spook-spider-d">${SPIDER}</span></div>\n`;
  const marks = `<span class="spook-marks">${PUMPKIN}${BAT}</span>`;
  return { stage, marks, attrs };
}
