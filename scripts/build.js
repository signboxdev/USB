import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertValidCatalog, repoRoot } from "./catalog.js";

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

function flowService(label, url) {
  if (!url) return "";
  return `<li><a class="service" href="${httpsUrl(url, label)}"><span class="name">${label}</span></a></li>`;
}

function coverImage(entry, index, reflect) {
  const lazy = index > 1 ? " loading=\"lazy\"" : "";
  const priority = !reflect && index === 0 ? " fetchpriority=\"high\"" : "";
  return `<img src="${httpsUrl(entry.artwork_url, "artwork")}" alt="" width="600" height="600" draggable="false" decoding="async"${priority}${lazy}>`;
}

function renderCoverFlow(entries) {
  if (entries.length === 0) return "";
  const covers = entries
    .map((entry, index) => {
      const current = index === 0 ? " aria-current=\"true\"" : "";
      const summary = `${entry.title}, ${entry.artist}, posted by ${entry.posted_by}, ${formatPostedAt(entry.posted_at)}`;
      const sleeve = entry.artwork_url
        ? `<span class="flow-sleeve">${coverImage(entry, index, false)}</span>`
        : `<span class="flow-sleeve is-blank"><span class="flow-mark">${escapeHtml(monogram(entry.artist))}</span></span>`;
      const reflect = entry.artwork_url
        ? `<span class="flow-reflect" aria-hidden="true">${coverImage(entry, index, true)}</span>`
        : `<span class="flow-reflect is-blank" aria-hidden="true"></span>`;
      return `          <li class="flow-cover">
            <button type="button" class="flow-select" data-index="${index}" data-summary="${escapeHtml(summary)}" aria-label="${escapeHtml(`${entry.title} by ${entry.artist}`)}"${current}>
              ${sleeve}
              ${reflect}
            </button>
          </li>`;
    })
    .join("\n");
  const panels = entries
    .map((entry, index) => {
      const hidden = index === 0 ? "" : " hidden";
      return `          <div class="flow-panel"${hidden}>
            <p class="flow-title">${escapeHtml(entry.title)}</p>
            <p class="flow-artist">${escapeHtml(entry.artist)}</p>
            <p class="flow-who">posted by ${posterLink(entry.posted_by)} · <time datetime="${escapeHtml(entry.posted_at)}">${formatPostedAt(entry.posted_at)}</time></p>
            <ul class="flow-services">
              ${flowService("spotify", entry.spotify_url)}
              ${flowService("apple music", entry.apple_music_url)}
            </ul>
          </div>`;
    })
    .join("\n");
  const live = escapeHtml(
    `${entries[0].title}, ${entries[0].artist}, posted by ${entries[0].posted_by}, ${formatPostedAt(entries[0].posted_at)}`,
  );

  return `      <section class="flow" data-coverflow aria-roledescription="carousel" aria-label="album covers">
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
  flow,
  list,
  catalogVersion,
}) {
  const styleHref = versionedAsset("styles.css");
  const logoSrc = versionedAsset("logo.gif");
  const scriptSrc = versionedAsset("coverflow.js");
  const flowHtml = flow || "";

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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; manifest-src 'self'; base-uri 'none'; form-action 'none'">
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
        <p class="count">${countHtml}</p>
      </header>
${flowHtml}      <main id="crate">
        ${list}
      </main>
      <footer class="colophon">
        <p>unfamiliar sound byte · catalog version ${escapeHtml(catalogVersion)}</p>
        <p>rebuilt from data/catalog.json.</p>
      </footer>
    </div>
    <script src="${scriptSrc}" defer></script>
  </body>
</html>
`;
}

function renderCrateList(entries, numbers) {
  if (entries.length === 0) {
    return `<p class="empty-crate">the crate is empty. add an entry to <code>data/catalog.json</code>, then run <code>npm run build</code>.</p>`;
  }
  return `<ol class="crate">\n${entries
    .map((entry, listIndex) => renderEntry(entry, numbers.get(entry.id), { listIndex }))
    .join("\n")}\n    </ol>`;
}

export function renderPage(catalog) {
  const entries = sortNewestFirst(catalog.entries);
  const numbers = acquisitionNumbers(entries);
  return renderDocument({
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    canonicalUrl: CANONICAL_URL,
    mastHeading: `<h1 class="sr-only">Unfamiliar Sound Byte</h1>`,
    countHtml: crateSummary(entries.length),
    flow: renderCoverFlow(entries),
    list: renderCrateList(entries, numbers),
    catalogVersion: catalog.version,
  });
}

export function renderPosterPage(catalog, poster) {
  const allEntries = sortNewestFirst(catalog.entries);
  const numbers = acquisitionNumbers(allEntries);
  const entries = poster.entries;
  const title = `${poster.name} · ${PAGE_TITLE}`;
  const description = `${poster.name}'s posts in Unfamiliar Sound Byte`;
  const canonicalUrl = `${SITE_ORIGIN}${posterHref(poster.name)}`;
  return renderDocument({
    title,
    description,
    canonicalUrl,
    mastHeading: `<h1 class="poster-name">${escapeHtml(poster.name)}</h1>`,
    countHtml: posterSummary(entries.length),
    flow: renderCoverFlow(entries),
    list: renderCrateList(entries, numbers),
    catalogVersion: catalog.version,
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

function main() {
  const catalog = assertValidCatalog();
  const posters = groupEntriesByPoster(catalog.entries);
  const html = renderPage(catalog);
  const dist = path.join(repoRoot, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), html);
  for (const poster of posters) {
    const dir = path.join(dist, "p", poster.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), renderPosterPage(catalog, poster));
  }
  fs.writeFileSync(path.join(dist, "sitemap.xml"), renderSitemap(posters));
  copyStatic(dist);
  const slugList = posters.map((poster) => poster.slug).join(", ");
  console.log(
    `built dist/index.html, ${posters.length} poster pages (${slugList || "none"}), and dist/sitemap.xml (${catalog.entries.length} entries)`,
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
