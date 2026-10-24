# Unfamiliar Sound Byte

A public catalog of every song, album, and playlist posted in the Unfamiliar Sound Byte group chat. The site is a static page for [unfamiliarsoundbyte.com](https://unfamiliarsoundbyte.com). There is no sort control and no playlist builder. Newest posts come first, as a cover flow of the artwork and then again as cards. One search box filters that crate as you type, and a row of genre chips can limit the crate to one broad genre.

`data/catalog.json` is the only source of truth. `npm run build` throws away `dist/` and writes the site again from that file.

## Add an entry

Open `data/catalog.json` and add an object to `entries`. Order in the file does not matter. Nullable fields stay in the object and are set to `null`; do not leave them out.

```json
{
  "id": "glass-elevator",
  "type": "track",
  "title": "glass elevator (demo)",
  "artist": "the paper moons",
  "album": "night shift sketches",
  "posted_by": "mira",
  "posted_at": "2026-03-14T21:18:00-04:00",
  "source_service": "spotify",
  "source_url": "https://open.spotify.com/track/exGlassElevatorDemo",
  "spotify_url": "https://open.spotify.com/track/exGlassElevatorDemo",
  "apple_music_url": "https://music.apple.com/us/song/glass-elevator-demo/0000000001",
  "match_status": "matched",
  "artwork_url": null,
  "notes": null
}
```

`genre` is optional. Leave it out of a new row. `npm run genres` fills it from Apple Music's primary genre for every entry that does not have the field yet, including a Spotify-only song when the title, artist, and album match one iTunes result. A row that was looked up and did not match is `genre: null` and stays that way on the next run. To fill one new id after you add it:

```bash
npm run genres -- --id glass-elevator
```

Then check it and rebuild:

```bash
npm install
npm run validate
npm run build
```

`id` is a lowercase slug (`glass-elevator`) and must be unique. `posted_at` is ISO 8601 with seconds and an offset, for example `2026-03-14T21:18:00-04:00` or a trailing `Z`. No fractional seconds. The page shows that clock time, not the server's timezone, and it does not print a zone label. A post at `2026-10-16T21:09:00-04:00` reads `Fri, Oct 16, 2026 · 9:09 PM`. The shop chrome is lowercase; titles, artists, names, and the date stay as typed, and no stylesheet lowercases the date.

### Removing the sample rows

The three shipped entries are fake. Each has `"notes": "example"`, and the page stamps them **example**. Delete those three objects when the real crate starts. Any other `notes` string is printed under the card.

## Schema

`data/catalog.schema.json` is JSON Schema draft 2020-12. The catalog is:

```json
{ "version": 1, "entries": [] }
```

`version` must be `1`.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable unique slug: lowercase letters, digits, hyphens. |
| `type` | `track` \| `album` \| `playlist` | What was posted. |
| `title` | string | Name of the track, album, or playlist. |
| `artist` | string | Performer. For a playlist, the curator or the name the chat used. |
| `album` | string or null | Album title. Use null when there isn't one. An album entry may leave this null; the card then uses the title as the album name. A track or playlist with null shows "not listed". |
| `posted_by` | string | Who sent it in the chat. |
| `posted_at` | string | ISO 8601 datetime with a numeric offset or `Z`. |
| `source_service` | `spotify` \| `apple_music` \| `youtube` | Which service the chat link used. |
| `source_url` | https URL | The link that was posted. Spotify links are `https://open.spotify.com/...` or a `https://spotify.link/...` short link. Apple Music links are `https://music.apple.com/...`. YouTube links are `https://www.youtube.com/...`. |
| `spotify_url` | URL or null | Same recording on Spotify (`open.spotify.com` or `spotify.link`), or null if that side is missing. |
| `apple_music_url` | URL or null | Same recording on Apple Music, or null if that side is missing. |
| `match_status` | `matched` \| `unmatched` \| `source_only` | See below. |
| `artwork_url` | https URL or null | Optional art. Null draws a monogram sleeve and makes no extra request. |
| `genre` | string or null, optional | Apple Music's primary genre, such as `Hip-Hop/Rap`, kept as Apple spelled it. Omit it until `npm run genres` has looked the row up. Null means it was looked up and there was no confident match. The page folds this into a broad bucket (Hip-Hop, Rock, and so on) in `scripts/genres.js`. A song with no genre still appears in the crate and is left out of a genre filter. |
| `notes` | string or null | A short note. The exact value `example` marks seed data. |

`match_status` has to agree with the two store links:

- `matched` — both `spotify_url` and `apple_music_url` are set. The card links to both.
- `unmatched` — someone tried to find the other service and exactly one URL is null. The page shows only the link that exists.
- `source_only` — only the service that was posted is filled in; the other was not looked up. The page shows only that link.

`match_status` stays in the catalog. The public page does not print matched, unmatched, or source only.

The URL for `source_service` is always required. A Spotify post whose Spotify link has died with no confirmed replacement may have `spotify_url: null` and `match_status: "unmatched"`; `source_url` still keeps the link as posted and is never rendered. A YouTube post keeps the watch link in `source_url` and shows only the Spotify and Apple Music buttons that are set. The page never renders a YouTube button.

`npm run validate` checks `data/catalog.json` against the schema and rejects duplicate ids. `npm run build` runs that check before it writes `dist/`. A failed check leaves the previous `dist/` in place.

## Preview

```bash
npm run preview
```

Serves `dist/` at [http://127.0.0.1:47321](http://127.0.0.1:47321). Set `PORT` to use another port. There is no analytics. Links send no referrer. On a desktop browser, a primary click on a Spotify or Apple Music button tries the installed app (`spotify:{type}:{id}`, or `music://` for an Apple Music link on a Mac) and opens the web URL if the page is still in the foreground after a second. iPhone, iPad, and Android keep the web link so universal links still open the apps. The `href` stays the web URL, so middle-click and copy link are unchanged.

The cover flow is `src/coverflow.js`, a plain script with no dependencies. It reads the covers the build wrote from `data/catalog.json`, newest in the center. Past 64 entries the HTML keeps the first screen and a fingerprinted `entries.json` (the same file beside a poster page that is also past 64). The script then mounts only the sleeves near the centre, appends list rows in batches as you scroll, and requests artwork for the sleeves and rows it has drawn. Shuffle still glides to any record. A smaller crate stays fully in the HTML. Drag or swipe, scroll horizontally, press the arrow keys, or click a side cover to bring that sleeve to the center. Under the centered cover, the song name is followed by the artist. The artist is smaller, muted, kept in the case stored in the catalog, and limited to one line that ends in an ellipsis when it does not fit. Tap that cover to flip it; the back shows the title, the artist, the album when there is one, who posted it, the date, and the Spotify and Apple Music buttons that exist. Coasting, the settle spring, the shuffle spin, and the flip still run when `prefers-reduced-motion` is set. An entry with no `artwork_url` gets a dark sleeve instead of an image request.

The search box sits under the count. It has no tabs and no category menu. Results group under people, artists, and songs, and an empty group is left out. People are posters matched on first name, linking to the existing `/p/<firstname>/` page. Artists match the artist field and list that artist's tracks underneath. Songs match the title or the album. Matching is case-insensitive and accent-insensitive, and a partial word is enough (`cure` finds The Cure, `gyongyhaju` finds Gyöngyhajú). The index is `search.json`, built from the public catalog fields only. It does not include notes, match status, source links, phone numbers, or emails. Choosing a song brings that sleeve to the centre of the cover flow and flips it, so the Spotify and Apple Music buttons on the back are on screen. On a poster page, a song that person did not post opens on the homepage instead.

Under the search box, one scrolling row of chips lists a few loose genres, ordered by how many songs are on the page, with a count on each chip and an `all` chip for the whole crate. Apple's finer labels are folded in `genreBucket` (`scripts/genres.js`): rap becomes Hip-Hop, metal joins Rock, dance and house join Electronic, indie joins Alternative, and soul and funk join R&B. A label that is not listed joins Other. A bucket needs at least 15 songs on the page before it gets a chip. Choosing one limits the cover flow and the list to that bucket, and the count line shows how many are in view. Songs with no genre stay in `all` and do not appear under a genre. Tap the selected chip or `all` to clear it. The choice is kept in `?genre=` so a reload and the back button return to the same crate. Search follows the same limit. The cover flow still mounts sleeves near the centre and still waits to request artwork until a sleeve or a list row is drawn.

`npm run build` appends `?v=` and a short SHA-256 of the file to `styles.css`, `coverflow.js`, `search.js`, `search.json`, and `logo.gif` in the generated HTML. Hostinger caches those assets for a week; the query string changes when the file does, so a phone picks up the new copy.

The built page is meant to be indexed. Its title is Unfamiliar Sound Byte, the description is “Unfamiliar Sound Byte, the revolutionary group chat for music”, and the canonical URL is `https://unfamiliarsoundbyte.com/`. The same title, description, and URL are repeated as Open Graph and Twitter card tags. The share image is `https://unfamiliarsoundbyte.com/og-image.png` (`og:image` and `twitter:image`, 1200×630), and the Twitter card is `summary_large_image`. `npm run build` writes `dist/sitemap.xml` with that canonical URL. `robots.txt` allows all crawlers and points at `https://unfamiliarsoundbyte.com/sitemap.xml`.

## Deploy

A push to `main` publishes the files inside `dist/` to the `deploy` branch. Hostinger copies that branch into the site. The hPanel settings are in [DEPLOY.md](DEPLOY.md).
