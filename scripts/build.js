import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertValidCatalog, repoRoot } from "./catalog.js";

// Above this, the homepage (and a poster page) stops inlining every sleeve.
// The shell keeps the first screen; entries.json feeds a window of covers and
// list rows. 44 entries stay fully inlined, so the current crate is unchanged.
const VIRTUAL_AT = 64;
const VIRTUAL_COVERS = 4;
const VIRTUAL_ROWS = 8;
// Posted-by is a name. A phone number in that field must not ship.
const PHONE_IN_NAME = /(?:\+\d[\d\s().-]{8,}\d)|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/;

const SITE_ORIGIN = "https://unfamiliarsoundbyte.com";
const CANONICAL_URL = `${SITE_ORIGIN}/`;
const PAGE_TITLE = "Unfamiliar Sound Byte";
const PAGE_DESCRIPTION = "Unfamiliar Sound Byte, the revolutionary group chat for music";
const SHARE_IMAGE_URL = `${SITE_ORIGIN}/og-image.png`;
const SHARE_IMAGE_ALT = "Unfamiliar Sound Byte wordmark on black";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ARTICLES = new Set(["the", "a", "an"]);
// Monochrome marks use currentColor so they stay white on the dark buttons
// and invert cleanly when .icon-btn hover flips to a white fill.
const SPOTIFY_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.78-.179-.9-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;
const APPLE_MUSIC_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.35 4.42c-.24-.12-.52-.12-.76-.02l-6.85 2.72A1.05 1.05 0 0 0 8.1 8.1v7.7a2.45 2.45 0 1 0 1.55 2.28V9.2l5.95-2.36v6.55a2.45 2.45 0 1 0 1.55 2.28V5.35c0-.38-.22-.72-.55-.93z"/></svg>`;
// Feather shuffle mark. currentColor stays white-on-black with the rest of the page.
const SHUFFLE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>`;

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function httpsUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} is not a usable URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be https: ${url}`);
  }
  return escapeHtml(url);
}

function postedInstant(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Unreadable posted_at: ${iso}`);
  return ms;
}

export function formatPostedAt(iso) {
  const match = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return escapeHtml(iso);
  const [, year, month, day, hourStr, minute] = match;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  let hour = Number(hourStr);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${weekday}, ${MONTHS[Number(month) - 1]} ${Number(day)}, ${year} · ${hour}:${minute} ${suffix}`;
}

// Sleeve back: calendar date only, taken from the timestamp as written.
function formatFlipDate(iso) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return escapeHtml(iso);
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

function monogram(artist) {
  const words = String(artist)
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  const usable = words[0] && ARTICLES.has(words[0].toLowerCase()) ? words.slice(1) : words;
  const pick = usable.length > 0 ? usable : words;
  if (pick.length === 0) return "•";
  const first = pick[0][0];
  const second = pick.length > 1 ? pick[pick.length - 1][0] : pick[0][1] || "";
  return (first + second).toUpperCase();
}

function acquisitionNumbers(entries) {
  const chronological = [...entries].sort(
    (a, b) => postedInstant(a.posted_at) - postedInstant(b.posted_at) || a.id.localeCompare(b.id),
  );
  const numbers = new Map();
  chronological.forEach((entry, index) => {
    numbers.set(entry.id, String(index + 1).padStart(3, "0"));
  });
  return numbers;
}

function albumName(entry) {
  return entry.album || (entry.type === "album" ? entry.title : null);
}

function byline(entry) {
  const album = albumName(entry);
  const albumHtml = album
    ? `<span class="album">${escapeHtml(album)}</span>`
    : `<span class="album is-empty">not listed</span>`;
  return `<p class="byline"><span class="artist">${escapeHtml(entry.artist)}</span><span class="sep" aria-hidden="true">·</span>${albumHtml}</p>`;
}

function storeLink(kind, url) {
  if (!url) return "";
  const name = kind === "spotify" ? "Spotify" : "Apple Music";
  const icon = kind === "spotify" ? SPOTIFY_ICON : APPLE_MUSIC_ICON;
  const label = kind === "spotify" ? "Open on Spotify" : "Open on Apple Music";
  return `<li><a class="icon-btn" href="${httpsUrl(url, name)}" aria-label="${escapeHtml(label)}">${icon}</a></li>`;
}

export function posterSlug(name) {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!slug) throw new Error(`posted_by has no usable slug: ${JSON.stringify(name)}`);
  return slug;
}

function posterHref(name) {
  return `/p/${posterSlug(name)}/`;
}

function posterLink(name) {
  return `<a class="poster" href="${escapeHtml(posterHref(name))}">${escapeHtml(name)}</a>`;
}

function artworkAlt(entry) {
  const subject = entry.album || entry.title;
  return `Cover art for ${subject} by ${entry.artist}`;
}

// First screenful of list thumbs: eager so iOS Safari / headless Chrome don't
// leave in-viewport covers as empty black squares until a scroll gesture.
const EAGER_LIST_ARTWORK = 10;

function assertNameIsPublic(entry) {
  if (PHONE_IN_NAME.test(entry.posted_by)) {
    throw new Error(`refusing to publish a phone number in posted_by for ${entry.id}`);
  }
}

// Public view of one page. Arrays keep the file small. Order is the contract
// coverflow.js decodes. Private catalog fields stay out: notes, match_status,
// source_url, source_service, and anything like posters.json.
function entriesPayload(entries, numbers) {
  for (const entry of entries) assertNameIsPublic(entry);
  return {
    v: 1,
    entries: entries.map((entry) => [
      entry.id,
      entry.type,
      entry.title,
      entry.artist,
      entry.album,
      entry.posted_by,
      entry.posted_at,
      entry.spotify_url,
      entry.apple_music_url,
      entry.artwork_url,
      numbers.get(entry.id),
    ]),
  };
}

function assertPublicJson(text) {
  if (text.includes("posters.json")) throw new Error("refusing to publish posters.json");
  if (/"notes"\s*:/.test(text) || /"match_status"\s*:/.test(text) || /"source_url"\s*:/.test(text)) {
    throw new Error("public entries JSON included a private catalog field");
  }
  if (PHONE_IN_NAME.test(text)) throw new Error("refusing to publish a phone number");
}

function renderEntry(entry, number, { listIndex = 0 } = {}) {
  const loading = listIndex < EAGER_LIST_ARTWORK ? "eager" : "lazy";
  const artwork = entry.artwork_url
    ? `<img src="${httpsUrl(entry.artwork_url, "artwork")}" alt="${escapeHtml(artworkAlt(entry))}" width="600" height="600" loading="${loading}" decoding="async">`
    : `<span class="monogram">${escapeHtml(monogram(entry.artist))}</span>`;
  const links = [
    storeLink("spotify", entry.spotify_url),
    storeLink("apple", entry.apple_music_url),
  ].filter(Boolean);
  const services = links.length ? `<ul class="services">\n            ${links.join("\n            ")}\n          </ul>` : "";

  return `      <li>
        <article class="card" id="${escapeHtml(entry.id)}" data-type="${escapeHtml(entry.type)}">
          <div class="row">
            <div class="thumb"${entry.artwork_url ? "" : ` aria-hidden="true"`}>${artwork}</div>
            <div class="copy">
              <p class="kind"><span>${escapeHtml(entry.type)}</span><span class="no">${number}</span></p>
              <h2>${escapeHtml(entry.title)}</h2>
              ${byline(entry)}
              <p class="posted">posted by ${posterLink(entry.posted_by)} · <time datetime="${escapeHtml(entry.posted_at)}">${formatPostedAt(entry.posted_at)}</time></p>
            </div>
            ${services}
          </div>
        </article>
      </li>`;
}

function crateSummary(count) {
  if (count === 0) return "nothing in the crate yet";
  if (count === 1) return `<span class="num">1</span> in the crate · newest first`;
  return `<span class="num">${count}</span> in the crate · newest first`;
}

function randomTrackButton(count) {
  if (count < 2) return "";
  return `<button type="button" class="flow-random" aria-label="random track">${SHUFFLE_ICON}</button>`;
}

function posterSummary(count) {
  if (count === 0) return "no songs yet";
  if (count === 1) return `<span class="num">1</span> song · newest first`;
  return `<span class="num">${count}</span> songs · newest first`;
}

function assetVersion(filename) {
  const bytes = fs.readFileSync(path.join(repoRoot, "src", filename));
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

function versionedAsset(filename) {
  return `/${filename}?v=${assetVersion(filename)}`;
}

function sortNewestFirst(entries) {
  return [...entries].sort(
    (a, b) => postedInstant(b.posted_at) - postedInstant(a.posted_at) || a.id.localeCompare(b.id),
  );
}

export function groupEntriesByPoster(entries) {
  const bySlug = new Map();
  for (const entry of entries) {
    const slug = posterSlug(entry.posted_by);
    const existing = bySlug.get(slug);
    if (existing && existing.name !== entry.posted_by) {
      throw new Error(
        `posted_by slug collision for /p/${slug}/: "${existing.name}" and "${entry.posted_by}"`,
      );
    }
    if (!existing) {
      bySlug.set(slug, { name: entry.posted_by, slug, entries: [entry] });
      continue;
    }
    existing.entries.push(entry);
  }
  for (const group of bySlug.values()) {
    group.entries = sortNewestFirst(group.entries);
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function flipStoreLink(kind, url) {
  if (!url) return "";
  const name = kind === "spotify" ? "Spotify" : "Apple Music";
  const icon = kind === "spotify" ? SPOTIFY_ICON : APPLE_MUSIC_ICON;
  const label = kind === "spotify" ? "Open on Spotify" : "Open on Apple Music";
  return `<li><a class="icon-btn" href="${httpsUrl(url, name)}" rel="noreferrer" aria-label="${escapeHtml(label)}">${icon}</a></li>`;
}

function renderFlipBack(entry) {
  const art = entry.artwork_url
    ? `<img class="flow-back-art" src="${httpsUrl(entry.artwork_url, "artwork")}" alt="" width="600" height="600" draggable="false" decoding="async" loading="lazy">`
    : "";
  const album = entry.album ? `<p class="flow-back-album">${escapeHtml(entry.album)}</p>` : "";
  const links = [flipStoreLink("spotify", entry.spotify_url), flipStoreLink("apple", entry.apple_music_url)].filter(
    Boolean,
  );
  const services = links.length ? `<ul class="flow-back-services">${links.join("")}</ul>` : "";
  return `<div class="flow-back-card">${art}<div class="flow-back-copy"><p class="flow-back-title">${escapeHtml(entry.title)}</p><p class="flow-back-artist">${escapeHtml(entry.artist)}</p>${album}<p class="flow-back-who">posted by ${posterLink(entry.posted_by)}</p><p class="flow-back-when"><time datetime="${escapeHtml(entry.posted_at)}">${formatFlipDate(entry.posted_at)}</time></p>${services}</div></div>`;
}

function coverImage(entry, index, reflect) {
  const lazy = index > 1 ? " loading=\"lazy\"" : "";
  const priority = !reflect && index === 0 ? " fetchpriority=\"high\"" : "";
  return `<img src="${httpsUrl(entry.artwork_url, "artwork")}" alt="" width="600" height="600" draggable="false" decoding="async"${priority}${lazy}>`;
}

function renderCoverFlow(entries, { coverLimit, singlePanel = false, entriesHref = "" } = {}) {
  if (entries.length === 0) return "";
  const shown = Number.isFinite(coverLimit) ? entries.slice(0, coverLimit) : entries;
  const covers = shown
    .map((entry, index) => {
      const current = index === 0 ? " aria-current=\"true\"" : "";
      const summary = `${entry.title}, ${entry.artist}, posted by ${entry.posted_by}, ${formatPostedAt(entry.posted_at)}`;
      const sleeve = entry.artwork_url
        ? `<span class="flow-sleeve">${coverImage(entry, index, false)}</span>`
        : `<span class="flow-sleeve is-blank"><span class="flow-mark">${escapeHtml(monogram(entry.artist))}</span></span>`;
      const reflect = entry.artwork_url
        ? `<span class="flow-reflect" aria-hidden="true">${coverImage(entry, index, true)}</span>`
        : `<span class="flow-reflect is-blank" aria-hidden="true"></span>`;
      const backId = `flow-back-${index}`;
      return `          <li class="flow-cover">
            <div class="flow-flip">
              <button type="button" class="flow-select" data-index="${index}" data-summary="${escapeHtml(summary)}" aria-expanded="false" aria-controls="${backId}" aria-label="${escapeHtml(`${entry.title} by ${entry.artist}`)}"${current}>
                ${sleeve}
              </button>
              <div class="flow-back" id="${backId}" aria-hidden="true" inert hidden>
                ${renderFlipBack(entry)}
              </div>
            </div>
            ${reflect}
          </li>`;
    })
    .join("\n");
  const panelSource = singlePanel ? shown.slice(0, 1) : shown;
  const panels = panelSource
    .map((entry, index) => {
      const hidden = index === 0 ? "" : " hidden";
      return `          <div class="flow-panel"${hidden}>
            <p class="flow-title">${escapeHtml(entry.title)}</p>
            <p class="flow-artist">${escapeHtml(entry.artist)}</p>
          </div>`;
    })
    .join("\n");
  const live = escapeHtml(
    `${shown[0].title}, ${shown[0].artist}, posted by ${shown[0].posted_by}, ${formatPostedAt(shown[0].posted_at)}`,
  );
  const virtualAttr = entriesHref
    ? ` data-virtual data-entries="${escapeHtml(entriesHref)}"`
    : "";

  return `      <section class="flow" data-coverflow${virtualAttr} aria-roledescription="carousel" aria-label="album covers">
        <h2 class="sr-only">album covers</h2>
        <div class="flow-stage">
          <ol class="flow-covers">
${covers}
          </ol>
        </div>
        <div class="flow-readout">
          <p class="sr-only" id="flow-live" aria-live="polite" aria-atomic="true">${live}</p>
${panels}
        </div>
      </section>
`;
}

function renderDocument({
  title,
  description,
  canonicalUrl,
  mastHeading,
  countHtml,
  randomButton = "",
  flow,
  list,
  catalogVersion,
  entriesHref = "",
  templates = "",
}) {
  const styleHref = versionedAsset("styles.css");
  const logoSrc = versionedAsset("logo.gif");
  const scriptSrc = versionedAsset("coverflow.js");
  const flowHtml = flow || "";
  const preload = entriesHref
    ? `\n    <link rel="preload" href="${escapeHtml(entriesHref)}" as="fetch" crossorigin>`
    : "";
  const csp = entriesHref
    ? "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; manifest-src 'self'; base-uri 'none'; form-action 'none'"
    : "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; manifest-src 'self'; base-uri 'none'; form-action 'none'";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${PAGE_TITLE}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
    <meta property="og:image" content="${SHARE_IMAGE_URL}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${escapeHtml(SHARE_IMAGE_ALT)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${SHARE_IMAGE_URL}">
    <meta name="theme-color" content="#000000">
    <meta http-equiv="Content-Security-Policy" content="${csp}">${preload}
    <link rel="stylesheet" href="${styleHref}">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="manifest" href="/site.webmanifest">
  </head>
  <body>
    <a class="skip" href="#crate">skip to the crate</a>
    <div class="wrap">
      <header class="mast">
        <a class="logo" href="/">
          <img src="${logoSrc}" alt="Unfamiliar Sound Byte" width="360" height="360">
        </a>
        ${mastHeading}
        <div class="count-row">
          <p class="count">${countHtml}</p>
          ${randomButton}
        </div>
      </header>
${flowHtml}      <main id="crate">
        ${list}
      </main>
      <footer class="colophon">
        <p>unfamiliar sound byte · catalog version ${escapeHtml(catalogVersion)}</p>
        <p>rebuilt from data/catalog.json.</p>
      </footer>
    </div>
${templates}    <script src="${scriptSrc}" defer></script>
  </body>
</html>
`;
}

function renderCrateList(entries, numbers, { limit } = {}) {
  if (entries.length === 0) {
    return `<p class="empty-crate">the crate is empty. add an entry to <code>data/catalog.json</code>, then run <code>npm run build</code>.</p>`;
  }
  const shown = Number.isFinite(limit) ? entries.slice(0, limit) : entries;
  return `<ol class="crate">\n${shown
    .map((entry, listIndex) => renderEntry(entry, numbers.get(entry.id), { listIndex }))
    .join("\n")}\n    </ol>`;
}

function virtualTemplates() {
  const spotify = `<li data-svc="spotify"><a class="icon-btn" rel="noreferrer" aria-label="Open on Spotify">${SPOTIFY_ICON}</a></li>`;
  const apple = `<li data-svc="apple"><a class="icon-btn" rel="noreferrer" aria-label="Open on Apple Music">${APPLE_MUSIC_ICON}</a></li>`;
  return `    <template id="usb-cover">
      <li class="flow-cover">
        <div class="flow-flip">
          <button type="button" class="flow-select" data-index="0" aria-expanded="false" aria-controls="flow-back-pool" aria-label="">
            <span class="flow-sleeve"></span>
          </button>
          <div class="flow-back" id="flow-back-pool" aria-hidden="true" inert hidden>
            <div class="flow-back-card"><img class="flow-back-art" alt="" width="600" height="600" draggable="false" decoding="async"><div class="flow-back-copy"><p class="flow-back-title"></p><p class="flow-back-artist"></p><p class="flow-back-album" hidden></p><p class="flow-back-who">posted by <a class="poster"></a></p><p class="flow-back-when"><time></time></p><ul class="flow-back-services">${spotify}${apple}</ul></div></div>
          </div>
        </div>
        <span class="flow-reflect" aria-hidden="true"></span>
      </li>
    </template>
    <template id="usb-row">
      <li>
        <article class="card">
          <div class="row">
            <div class="thumb"><img alt="" width="600" height="600" decoding="async"></div>
            <div class="copy">
              <p class="kind"><span></span><span class="no"></span></p>
              <h2></h2>
              <p class="byline"><span class="artist"></span><span class="sep" aria-hidden="true">·</span><span class="album"></span></p>
              <p class="posted">posted by <a class="poster"></a> · <time></time></p>
            </div>
            <ul class="services">
            <li data-svc="spotify"><a class="icon-btn" aria-label="Open on Spotify">${SPOTIFY_ICON}</a></li>
            <li data-svc="apple"><a class="icon-btn" aria-label="Open on Apple Music">${APPLE_MUSIC_ICON}</a></li>
          </ul>
          </div>
        </article>
      </li>
    </template>
`;
}

function pageParts(catalog, entries, numbers, { entriesHref = "" } = {}) {
  const virtual = entries.length > VIRTUAL_AT;
  const href = virtual ? entriesHref : "";
  return {
    virtual,
    flow: renderCoverFlow(entries, virtual ? { coverLimit: VIRTUAL_COVERS, singlePanel: true, entriesHref: href } : {}),
    list: renderCrateList(entries, numbers, virtual ? { limit: VIRTUAL_ROWS } : {}),
    entriesHref: href,
    templates: virtual ? virtualTemplates() : "",
  };
}

export function renderPage(catalog, entriesHref = "") {
  const entries = sortNewestFirst(catalog.entries);
  const numbers = acquisitionNumbers(entries);
  const parts = pageParts(catalog, entries, numbers, { entriesHref });
  return renderDocument({
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    canonicalUrl: CANONICAL_URL,
    mastHeading: `<h1 class="sr-only">Unfamiliar Sound Byte</h1>`,
    countHtml: crateSummary(entries.length),
    randomButton: randomTrackButton(entries.length),
    flow: parts.flow,
    list: parts.list,
    catalogVersion: catalog.version,
    entriesHref: parts.entriesHref,
    templates: parts.templates,
  });
}

export function renderPosterPage(catalog, poster, entriesHref = "") {
  const allEntries = sortNewestFirst(catalog.entries);
  const numbers = acquisitionNumbers(allEntries);
  const entries = poster.entries;
  const title = `${poster.name} · ${PAGE_TITLE}`;
  const description = `${poster.name}'s posts in Unfamiliar Sound Byte`;
  const canonicalUrl = `${SITE_ORIGIN}${posterHref(poster.name)}`;
  const parts = pageParts(catalog, entries, numbers, { entriesHref });
  return renderDocument({
    title,
    description,
    canonicalUrl,
    mastHeading: `<h1 class="poster-name">${escapeHtml(poster.name)}</h1>`,
    countHtml: posterSummary(entries.length),
    randomButton: randomTrackButton(entries.length),
    flow: parts.flow,
    list: parts.list,
    catalogVersion: catalog.version,
    entriesHref: parts.entriesHref,
    templates: parts.templates,
  });
}

export function renderSitemap(posters = []) {
  const urls = [
    CANONICAL_URL,
    ...posters.map((poster) => `${SITE_ORIGIN}${posterHref(poster.name)}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (loc) => `  <url>
    <loc>${loc}</loc>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
}

function copyStatic(dist) {
  // Explicit names. A directory walk that skips names starting with "." would
  // drop .htaccess, so the dotfile is listed here on purpose.
  for (const name of [
    ".htaccess",
    "styles.css",
    "coverflow.js",
    "logo.gif",
    "robots.txt",
    "favicon.ico",
    "favicon-32.png",
    "apple-touch-icon.png",
    "icon-512.png",
    "og-image.png",
    "site.webmanifest",
  ]) {
    const from = path.join(repoRoot, "src", name);
    if (!fs.existsSync(from)) throw new Error(`missing src/${name}`);
    fs.copyFileSync(from, path.join(dist, name));
  }
}

function jsonHash(payload) {
  const text = JSON.stringify(payload);
  assertPublicJson(text);
  const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 8);
  return { text, hash };
}

function main() {
  const catalog = assertValidCatalog();
  for (const entry of catalog.entries) assertNameIsPublic(entry);
  const posters = groupEntriesByPoster(catalog.entries);
  const homeEntries = sortNewestFirst(catalog.entries);
  const numbers = acquisitionNumbers(homeEntries);
  const homeVirtual = homeEntries.length > VIRTUAL_AT;
  const homeJson = homeVirtual ? jsonHash(entriesPayload(homeEntries, numbers)) : null;
  const homeHref = homeJson ? `/entries.json?v=${homeJson.hash}` : "";
  const posterBuilt = posters.map((poster) => {
    const virtual = poster.entries.length > VIRTUAL_AT;
    const json = virtual ? jsonHash(entriesPayload(poster.entries, numbers)) : null;
    const href = json ? `/p/${poster.slug}/entries.json?v=${json.hash}` : "";
    return { poster, json, href };
  });
  const html = renderPage(catalog, homeHref);
  const dist = path.join(repoRoot, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), html);
  if (homeJson) fs.writeFileSync(path.join(dist, "entries.json"), homeJson.text);
  for (const { poster, json, href } of posterBuilt) {
    const dir = path.join(dist, "p", poster.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), renderPosterPage(catalog, poster, href));
    if (json) fs.writeFileSync(path.join(dir, "entries.json"), json.text);
  }
  fs.writeFileSync(path.join(dist, "sitemap.xml"), renderSitemap(posters));
  copyStatic(dist);
  const slugList = posters.map((poster) => poster.slug).join(", ");
  const homeBytes = homeJson ? homeJson.text.length : 0;
  console.log(
    `built dist/index.html, ${posters.length} poster pages (${slugList || "none"}), and dist/sitemap.xml (${catalog.entries.length} entries${homeBytes ? `; entries.json ${homeBytes} bytes` : ""})`,
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
