import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./catalog.js";

// Apple Music primaryGenreName, via the public iTunes API. A genre is written
// only when the recording is identified, never guessed. Entries that already
// have a genre field (including null) are left alone, so the script can be
// run again after new rows are added.

const COUNTRY = "ca";
const LOOKUP_BATCH = 100;
const GAP_MS = 400;
const MAX_GENRE = 80;
const catalogPath = path.join(repoRoot, "data", "catalog.json");

function cleanGenre(value) {
  if (typeof value !== "string") return null;
  const genre = value.trim();
  if (!genre || genre.length > MAX_GENRE) return null;
  return genre;
}

function foldKey(value) {
  let text = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  text = text.replace(/\$/g, "s");
  return text.replace(/[^\p{L}\p{N}]+/gu, "");
}

// Same people, ignoring &, and, commas, and feat. lists. Order does not matter.
function artistKey(value) {
  let text = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\$/g, "s");
  const parts = text.split(
    /\s*(?:,|&|\+|\bfeat\.?\b|\bfeaturing\b|\bft\.?\b|\bwith\b|\band\b)\s*/,
  );
  return parts
    .map((part) => part.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean)
    .sort()
    .join("|");
}

// Apple's primaryGenreName stays on the catalog row. The picker shows one of
// these buckets. A label that is not listed — including one Apple adds later —
// joins Other, so a new song is bucketed on the next build without a new rule.
const BUCKET_OF = {
  "Hip-Hop/Rap": "Hip-Hop",
  "Hip-Hop": "Hip-Hop",
  Rap: "Hip-Hop",
  "East Coast Rap": "Hip-Hop",
  "Hardcore Rap": "Hip-Hop",

  Rock: "Rock",
  "Hard Rock": "Rock",
  "Glam Rock": "Rock",
  "Southern Rock": "Rock",
  Punk: "Rock",
  "Goth Rock": "Rock",
  "New Wave": "Rock",
  "Rock & Roll": "Rock",
  "Blues-Rock": "Rock",
  "Soft Rock": "Rock",
  // Eleven songs, not enough for its own chip.
  Metal: "Rock",

  Alternative: "Alternative",
  "Indie Rock": "Alternative",
  "Indie Pop": "Alternative",

  Electronic: "Electronic",
  Dance: "Electronic",
  House: "Electronic",
  Electronica: "Electronic",
  "IDM/Experimental": "Electronic",
  Breakbeat: "Electronic",
  "Jungle/Drum'n'bass": "Electronic",
  Downtempo: "Electronic",
  Disco: "Electronic",
  Industrial: "Electronic",

  "R&B/Soul": "R&B",
  Soul: "R&B",
  "Neo-Soul": "R&B",
  Funk: "R&B",

  Latin: "Latin",
  "Salsa and Tropical": "Latin",
  "Regional Mexican": "Latin",
  "Pop in Spanish": "Latin",
  "Baladas and Boleros": "Latin",
  "Latin Urban": "Latin",
  "Baile Funk": "Latin",
  Brazilian: "Latin",
  Sertanejo: "Latin",

  Pop: "Pop",
  "Vocal Pop": "Pop",

  Country: "Country/Folk",
  Folk: "Country/Folk",
  "Traditional Country": "Country/Folk",
  "Traditional Folk": "Country/Folk",
  "Folk-Rock": "Country/Folk",

  Soundtrack: "Soundtrack",
  Musicals: "Soundtrack",

  // Too small to stand alone. A chip appears only once a bucket reaches MIN_GENRE_BUCKET.
  Reggae: "Other",
  "Roots Reggae": "Other",
  "Modern Dancehall": "Other",
  Jazz: "Other",
  Blues: "Other",
  "Latin Jazz": "Other",
  "Vocal Jazz": "Other",
  "Singer/Songwriter": "Other",
  Worldwide: "Other",
  "Easy Listening": "Other",
  Classical: "Other",
  Instrumental: "Other",
  "New Age": "Other",
  Vocal: "Other",
  Comedy: "Other",
  Holiday: "Other",
  "Christmas: Pop": "Other",
  "Musique francophone": "Other",
  "Punjabi Pop": "Other",
  Bollywood: "Other",
};

export const MIN_GENRE_BUCKET = 15;

export function genreBucket(genre) {
  if (typeof genre !== "string") return null;
  const name = genre.trim();
  if (!name) return null;
  return BUCKET_OF[name] || "Other";
}

export function appleCatalogId(url) {
  if (typeof url !== "string" || !url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "music.apple.com") return null;
  const track = parsed.searchParams.get("i");
  if (track && /^\d+$/.test(track)) return track;
  const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
  if (/^\d+$/.test(last)) return last;
  return null;
}

// Strict title, artist, and album. A missing album cannot be confirmed, so
// it does not match. Disagreeing genres across equal hits do not match.
export function genreFromSearch(entry, results) {
  const found = [];
  for (const result of results || []) {
    if (!sameRecording(entry, result)) continue;
    const genre = cleanGenre(result.primaryGenreName);
    if (genre) found.push(genre);
  }
  if (found.length === 0) return null;
  const first = found[0];
  if (found.every((genre) => genre === first)) return first;
  return null;
}

function sameRecording(entry, result) {
  if (!cleanGenre(result.primaryGenreName)) return false;
  if (entry.type === "album") {
    if (result.wrapperType !== "collection") return false;
    return (
      foldKey(entry.title) === foldKey(result.collectionName) &&
      artistKey(entry.artist) === artistKey(result.artistName)
    );
  }
  if (entry.type !== "track") return false;
  if (result.kind !== "song") return false;
  if (!entry.album) return false;
  return (
    foldKey(entry.title) === foldKey(result.trackName) &&
    foldKey(entry.album) === foldKey(result.collectionName) &&
    artistKey(entry.artist) === artistKey(result.artistName)
  );
}

export function assertGenreRules() {
  const track = {
    type: "track",
    title: "Out There",
    artist: "Project Pat",
    album: "Ghetty Green",
  };
  const hit = {
    kind: "song",
    trackName: "Out There",
    artistName: "Project Pat",
    collectionName: "Ghetty Green",
    primaryGenreName: "Hip-Hop/Rap",
  };
  if (genreFromSearch(track, [hit]) !== "Hip-Hop/Rap") {
    throw new Error("an exact title, artist, and album should take the iTunes genre");
  }
  if (genreFromSearch(track, [{ ...hit, collectionName: "Mista Don't Play" }]) !== null) {
    throw new Error("a different album must stay blank");
  }
  if (genreFromSearch({ ...track, album: null }, [hit]) !== null) {
    throw new Error("a track with no album must stay blank");
  }
  if (genreFromSearch(track, [hit, { ...hit, primaryGenreName: "Rap" }]) !== null) {
    throw new Error("two genres for one recording must stay blank");
  }
  const asap = genreFromSearch(
    { type: "track", title: "Peso", artist: "A$AP Rocky", album: "LIVE.LOVE.A$AP" },
    [
      {
        kind: "song",
        trackName: "Peso",
        artistName: "A$AP Rocky",
        collectionName: "LIVE.LOVE.A$AP",
        primaryGenreName: "Hip-Hop/Rap",
      },
    ],
  );
  if (asap !== "Hip-Hop/Rap") throw new Error("A$AP should match ASAP");
  const feat = genreFromSearch(
    {
      type: "track",
      title: "Purple Ape (feat. 4orever)",
      artist: "SahBabii, 4orever",
      album: "S.A.N.D.A.S.",
    },
    [
      {
        kind: "song",
        trackName: "Purple Ape (feat. 4orever)",
        artistName: "SahBabii & 4orever",
        collectionName: "S.A.N.D.A.S.",
        primaryGenreName: "Hip-Hop/Rap",
      },
    ],
  );
  if (feat !== "Hip-Hop/Rap") throw new Error("feat. and & artists should match");
  if (appleCatalogId("https://music.apple.com/ca/album/obsessive/6774507902?i=6774507910") !== "6774507910") {
    throw new Error("track id should come from the i query");
  }
  if (appleCatalogId("https://music.apple.com/ca/album/zilla-single/6825097610") !== "6825097610") {
    throw new Error("album id should come from the path");
  }
  const buckets = {
    "Hip-Hop/Rap": "Hip-Hop",
    "Hip-Hop": "Hip-Hop",
    Rap: "Hip-Hop",
    "East Coast Rap": "Hip-Hop",
    "Hardcore Rap": "Hip-Hop",
    Rock: "Rock",
    "Hard Rock": "Rock",
    "Glam Rock": "Rock",
    "Southern Rock": "Rock",
    Punk: "Rock",
    "Goth Rock": "Rock",
    "New Wave": "Rock",
    "Rock & Roll": "Rock",
    Metal: "Rock",
    Alternative: "Alternative",
    "Indie Rock": "Alternative",
    "Indie Pop": "Alternative",
    Electronic: "Electronic",
    Dance: "Electronic",
    House: "Electronic",
    Disco: "Electronic",
    "R&B/Soul": "R&B",
    Soul: "R&B",
    "Neo-Soul": "R&B",
    Funk: "R&B",
    "Salsa and Tropical": "Latin",
    Sertanejo: "Latin",
    Pop: "Pop",
    Country: "Country/Folk",
    "Traditional Folk": "Country/Folk",
    Soundtrack: "Soundtrack",
    Reggae: "Other",
    Jazz: "Other",
    Blues: "Other",
  };
  for (const [raw, bucket] of Object.entries(buckets)) {
    if (genreBucket(raw) !== bucket) throw new Error(`${raw} should bucket to ${bucket}`);
  }
  if (genreBucket(null) !== null || genreBucket("") !== null) {
    throw new Error("a missing genre stays blank");
  }
  if (genreBucket("Afrobeats") !== "Other") {
    throw new Error("a new Apple genre should join Other");
  }
}

// Named buckets have to be large enough to stand on the picker. A small one
// is a mapping mistake; Other may stay under the minimum and then has no chip.
export function assertGenreBuckets(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const bucket = genreBucket(entry.genre);
    if (!bucket) continue;
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  for (const [bucket, count] of counts) {
    if (bucket !== "Other" && count < MIN_GENRE_BUCKET) {
      throw new Error(`${bucket} has ${count} songs; fold it into a larger bucket`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nextRequestAt = 0;

async function fetchJson(url) {
  const wait = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Date.now() + wait + GAP_MS;
  if (wait) await sleep(wait);
  let lastError = "itunes request failed";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "UnfamiliarSoundByte genre backfill",
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      lastError = error.message;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = `itunes ${response.status}`;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!response.ok) throw new Error(`itunes ${response.status} for ${url}`);
    return response.json();
  }
  throw new Error(lastError);
}

function genreFromLookup(result, id) {
  const genre = cleanGenre(result.primaryGenreName);
  if (!genre) return null;
  if (result.wrapperType === "track" && String(result.trackId) === id) return genre;
  if (result.wrapperType === "collection" && String(result.collectionId) === id) return genre;
  return null;
}

async function lookupGenres(ids) {
  const found = new Map();
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += LOOKUP_BATCH) {
    const chunk = unique.slice(index, index + LOOKUP_BATCH);
    const data = await fetchJson(
      `https://itunes.apple.com/lookup?id=${chunk.join(",")}&country=${COUNTRY}`,
    );
    for (const result of data.results || []) {
      for (const id of [result.trackId, result.collectionId]) {
        if (id == null) continue;
        const genre = genreFromLookup(result, String(id));
        if (genre && chunk.includes(String(id))) found.set(String(id), genre);
      }
    }
    console.log(`lookup ${Math.min(index + LOOKUP_BATCH, unique.length)}/${unique.length}`);
  }
  return found;
}

async function searchGenre(entry) {
  const entity = entry.type === "album" ? "album" : "song";
  const term = [entry.title, entry.artist, entry.album].filter(Boolean).join(" ");
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${COUNTRY}&entity=${entity}&limit=10`;
  const data = await fetchJson(url);
  return genreFromSearch(entry, data.results);
}

function wantedIds() {
  const ids = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--id") {
      const value = process.argv[index + 1];
      if (!value) throw new Error("--id needs a catalog id");
      ids.push(...value.split(",").map((id) => id.trim()).filter(Boolean));
      index += 1;
    }
  }
  return ids.length ? new Set(ids) : null;
}

function writeCatalog(catalog) {
  const temp = `${catalogPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`);
  fs.renameSync(temp, catalogPath);
}

async function main() {
  assertGenreRules();
  const only = wantedIds();
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const pending = catalog.entries.filter((entry) => {
    if (Object.hasOwn(entry, "genre")) return false;
    if (only && !only.has(entry.id)) return false;
    return true;
  });
  if (only) {
    for (const id of only) {
      if (!catalog.entries.some((entry) => entry.id === id)) {
        throw new Error(`no catalog entry with id ${id}`);
      }
    }
  }
  console.log(`${pending.length} entries need a genre`);
  const byAppleId = new Map();
  const searches = [];
  let skipped = 0;
  for (const entry of pending) {
    const appleId = appleCatalogId(entry.apple_music_url);
    if (appleId) {
      const list = byAppleId.get(appleId) || [];
      list.push(entry);
      byAppleId.set(appleId, list);
      continue;
    }
    if (entry.type === "track" || entry.type === "album") {
      searches.push(entry);
      continue;
    }
    entry.genre = null;
    skipped += 1;
  }
  const lookedUp = byAppleId.size ? await lookupGenres([...byAppleId.keys()]) : new Map();
  let fromLookup = 0;
  let lookupBlank = 0;
  for (const [id, entries] of byAppleId) {
    const genre = lookedUp.get(id) || null;
    if (genre) fromLookup += entries.length;
    else lookupBlank += entries.length;
    for (const entry of entries) entry.genre = genre;
  }
  let fromSearch = 0;
  let searchBlank = 0;
  for (let index = 0; index < searches.length; index += 1) {
    const entry = searches[index];
    const genre = await searchGenre(entry);
    entry.genre = genre;
    if (genre) fromSearch += 1;
    else searchBlank += 1;
    if ((index + 1) % 25 === 0 || index + 1 === searches.length) {
      console.log(`search ${index + 1}/${searches.length}`);
    }
  }
  if (pending.length) writeCatalog(catalog);
  const counts = new Map();
  let filled = 0;
  let blank = 0;
  let missing = 0;
  for (const entry of catalog.entries) {
    if (!Object.hasOwn(entry, "genre")) {
      missing += 1;
      continue;
    }
    if (!entry.genre) {
      blank += 1;
      continue;
    }
    filled += 1;
    counts.set(entry.genre, (counts.get(entry.genre) || 0) + 1);
  }
  console.log(
    `filled ${filled}, blank ${blank}, not looked up ${missing} (lookup ${fromLookup}, lookup blank ${lookupBlank}, search ${fromSearch}, search blank ${searchBlank}, no apple id and not searchable ${skipped})`,
  );
  for (const [genre, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`${count}\t${genre}`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
