// Synthetic catalog for local performance checks. Never writes data/catalog.json.
// Usage: node scripts/synthetic-catalog.js [count] [out path]
import fs from "node:fs";
import path from "node:path";

const NAMES = [
  "Evan",
  "Dallas",
  "Drew",
  "Liam",
  "Basil",
  "Luke",
  "Shawn",
  "Chris",
  "Mira",
  "Jules",
  "Noah",
  "Ada",
  "Ruth",
  "Owen",
  "Nina",
  "Hugo",
];

const TITLES = [
  "Night Window",
  "Glass Elevator",
  "Soft Static",
  "Harbour Lights",
  "Second Moon",
  "Paper Wings",
  "Low Tide Radio",
  "Copper Line",
  "After Image",
  "Small Mercy",
  "Northbound",
  "Velvet Alarm",
  "Open Channel",
  "Late Register",
  "Kindling",
  "ស្រឡាញ់តែបងមួយ",
];

const ARTISTS = [
  "the paper moons",
  "Nav Katze",
  "P.M. Dawn",
  "KAYTRANADA, Syd",
  "Outkast",
  "Jawnino",
  "Sade",
  "Broadcast",
  "Fishmans",
  "A Tribe Called Quest",
  "Cocteau Twins",
  "ស៊ិន សុវណ្ណារី",
];

const ALBUMS = [
  "night shift sketches",
  "Fragment Lilac+1",
  "Of the Heart, of the Soul and of the Cross",
  "99.9%",
  "ATLiens",
  "Moon Safari",
  "Lost in the Trees",
  null,
];

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

function isoAt(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  // Offset is part of the stamp the page prints. Keep a fixed zone.
  return `${y}-${m}-${day}T${h}:${min}:${s}-04:00`;
}

export function syntheticCatalog(count = 1500) {
  const start = Date.parse("2022-12-01T15:00:00-04:00");
  const end = Date.parse("2026-10-20T13:57:49-04:00");
  const step = count <= 1 ? 0 : (end - start) / (count - 1);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const n = i + 1;
    const id = `syn-${pad(n, 4)}`;
    const type = n % 23 === 0 ? "playlist" : n % 17 === 0 ? "album" : "track";
    const title = `${TITLES[i % TITLES.length]} ${n}`;
    const artist = ARTISTS[i % ARTISTS.length];
    const album = type === "playlist" ? null : ALBUMS[i % ALBUMS.length];
    const postedBy = NAMES[i % NAMES.length];
    const postedAt = isoAt(Math.round(start + step * i));
    const spotifyId = id.replaceAll("-", "");
    const appleId = String(1400000000 + n);
    const spotify = `https://open.spotify.com/track/${spotifyId}`;
    const apple = `https://music.apple.com/ca/album/synthetic/${appleId}?i=${appleId}`;
    // Cycle match shapes the schema accepts. Artwork is a unique https URL so a
    // browser test can count fetches; every 11th sleeve is a monogram.
    let match = "matched";
    let spotifyUrl = spotify;
    let appleUrl = apple;
    let sourceService = n % 2 === 0 ? "spotify" : "apple_music";
    if (n % 9 === 0) {
      match = "unmatched";
      if (sourceService === "spotify") appleUrl = null;
      else spotifyUrl = null;
    } else if (n % 13 === 0) {
      match = "source_only";
      if (sourceService === "spotify") appleUrl = null;
      else spotifyUrl = null;
    }
    const sourceUrl = sourceService === "spotify" ? spotify : apple;
    if (sourceService === "spotify") spotifyUrl = spotify;
    else appleUrl = apple;
    const artwork =
      n % 11 === 0 ? null : `https://artwork.invalid/cover/${id}.jpg`;
    entries.push({
      id,
      type,
      title,
      artist,
      album,
      posted_by: postedBy,
      posted_at: postedAt,
      source_service: sourceService,
      source_url: sourceUrl,
      spotify_url: spotifyUrl,
      apple_music_url: appleUrl,
      match_status: match,
      artwork_url: artwork,
      notes: null,
    });
  }
  return { version: 1, entries };
}

function main() {
  const count = Number(process.argv[2] || 1500);
  const out = process.argv[3];
  if (!Number.isInteger(count) || count < 1 || count > 5000) {
    throw new Error("count must be an integer from 1 to 5000");
  }
  const resolved = out ? path.resolve(out) : "";
  const forbidden = path.resolve("data/catalog.json");
  if (resolved === forbidden) {
    throw new Error("refusing to write data/catalog.json");
  }
  const json = JSON.stringify(syntheticCatalog(count), null, 2);
  if (!out) {
    process.stdout.write(json);
    return;
  }
  fs.writeFileSync(out, json);
  console.log(`wrote ${count} synthetic entries to ${out}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const invoked = process.argv[1].endsWith("synthetic-catalog.js");
  if (invoked) main();
}
