// Client-side catalog search. Public fields only: id, title, artist, album,
// genre, and the poster's first name. No notes, match status, source links,
// phone numbers, or emails. The build copies this file; Node imports the pure
// helpers to check ranking before it writes dist/.

const CAP_SONGS = 30;
const CAP_ARTISTS = 12;
const CAP_TRACKS = 24;

const FOLD = [
  [/ß/g, "ss"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ø/g, "o"],
  [/ł/g, "l"],
  [/đ/g, "d"],
  [/ð/g, "d"],
  [/þ/g, "th"],
  [/[µμ]/g, "u"],
  [/ı/g, "i"],
  // A$AP, Curren$y, Too $hort. "$" stands in for an s in these names.
  [/\$/g, "s"],
];

const SINGULAR = { people: "person", artists: "artist", songs: "song" };
const SECTION_TIE = { people: 0, artists: 1, songs: 2 };

export function posterSlug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function firstName(name) {
  const trimmed = String(name == null ? "" : name).trim();
  const token = trimmed.split(/\s+/)[0];
  return token || trimmed;
}

// Case- and accent-insensitive. Punctuation becomes a space in `spaced`
// (so "jay-z" and "jay z" meet) and disappears in `compact` (so "jayz" meets
// "JAŸ-Z"). Letters outside Latin stay, so a Khmer or Cyrillic title still matches.
export function fold(value) {
  let text = String(value == null ? "" : value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  for (const [pattern, replacement] of FOLD) text = text.replace(pattern, replacement);
  const spaced = text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/ +/g, " ");
  const compact = text.replace(/[^\p{L}\p{N}]+/gu, "");
  return { spaced, compact };
}

function scoreField(query, field) {
  if (!query.spaced || !field || !field.spaced) return 0;
  const hay = field.spaced;
  const needle = query.spaced;
  if (hay === needle) return 1000;
  if (hay.startsWith(needle)) return 860;
  let best = 0;
  let from = 0;
  while (from < hay.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    const word = at === 0 || hay[at - 1] === " ";
    const rank = (word ? 740 : 460) - Math.min(at, 60);
    if (rank > best) best = rank;
    from = at + needle.length;
    if (!needle.length) break;
  }
  if (best) return best;
  if (query.compact.length >= 2 && field.compact.includes(query.compact)) return 320;
  return 0;
}

export function prepareIndex(rows) {
  const entries = [];
  const artistGroups = new Map();
  const people = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const id = row[0];
    const title = row[1];
    const artist = row[2];
    const album = row[3] || "";
    const postedBy = row[4];
    const artistF = fold(artist);
    const slug = posterSlug(postedBy);
    const entry = {
      id,
      title,
      artist,
      album,
      index,
      genre: typeof row[5] === "string" && row[5] ? row[5] : "",
      posterSlug: slug,
      titleF: fold(title),
      albumF: fold(album),
      artistF,
    };
    entries.push(entry);
    const key = artistF.compact || artistF.spaced;
    if (key) {
      let group = artistGroups.get(key);
      if (!group) {
        group = { name: artist, field: artistF, tracks: [], total: 0 };
        artistGroups.set(key, group);
      }
      group.total += 1;
      if (group.tracks.length < CAP_TRACKS) group.tracks.push(entry);
    }
    const name = firstName(postedBy);
    if (!slug || people.has(slug)) continue;
    people.set(slug, { name, slug, href: `/p/${slug}/`, field: fold(name) });
  }
  return {
    entries,
    artists: [...artistGroups.values()],
    people: [...people.values()],
  };
}

export function queryIndex(index, raw, genre) {
  const query = fold(raw);
  if (!query.spaced) return [];
  const want = typeof genre === "string" ? genre : "";
  const inGenre = (entry) => !want || entry.genre === want;
  let posters = null;
  if (want) {
    posters = new Set();
    for (const entry of index.entries) {
      if (entry.genre === want && entry.posterSlug) posters.add(entry.posterSlug);
    }
  }

  const people = [];
  for (const person of index.people) {
    if (posters && !posters.has(person.slug)) continue;
    const score = scoreField(query, person.field);
    if (!score) continue;
    people.push({ name: person.name, href: person.href, score });
  }
  people.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const artists = [];
  for (const group of index.artists) {
    const score = scoreField(query, group.field);
    if (!score) continue;
    let tracks = group.tracks;
    let total = group.total;
    if (want) {
      const key = group.field.compact || group.field.spaced;
      const matched = [];
      for (const entry of index.entries) {
        if (entry.genre !== want) continue;
        const entryKey = entry.artistF.compact || entry.artistF.spaced;
        if (entryKey !== key) continue;
        matched.push(entry);
      }
      if (!matched.length) continue;
      total = matched.length;
      tracks = matched.slice(0, CAP_TRACKS);
    }
    if (!tracks.length) continue;
    artists.push({
      name: group.name,
      score,
      total,
      tracks: tracks.map((entry) => ({
        id: entry.id,
        title: entry.title,
        album: entry.album,
      })),
    });
  }
  artists.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const artistItems = artists.slice(0, CAP_ARTISTS);

  const songs = [];
  for (const entry of index.entries) {
    if (!inGenre(entry)) continue;
    const titleScore = scoreField(query, entry.titleF);
    const albumScore = entry.album ? scoreField(query, entry.albumF) : 0;
    const score = Math.max(titleScore, albumScore);
    if (!score) continue;
    songs.push({
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      album: entry.album,
      score,
      index: entry.index,
    });
  }
  songs.sort((a, b) => b.score - a.score || a.index - b.index);
  const songItems = songs.slice(0, CAP_SONGS);

  const sections = [];
  if (people.length) sections.push({ key: "people", label: "people", score: people[0].score, people });
  if (artistItems.length) {
    sections.push({ key: "artists", label: "artists", score: artistItems[0].score, artists: artistItems });
  }
  if (songItems.length) sections.push({ key: "songs", label: "songs", score: songItems[0].score, songs: songItems });
  sections.sort((a, b) => b.score - a.score || SECTION_TIE[a.key] - SECTION_TIE[b.key]);
  return sections;
}

function summary(sections) {
  if (!sections.length) return "nothing found";
  return sections
    .map((section) => {
      const count = section.people
        ? section.people.length
        : section.artists
          ? section.artists.length
          : section.songs.length;
      const word = count === 1 ? SINGULAR[section.key] : section.label;
      return `${count} ${word}`;
    })
    .join(", ");
}

function boot() {
  const finder = document.querySelector(".finder");
  if (!finder) return;
  const input = finder.querySelector(".finder-input");
  const panel = finder.querySelector(".finder-panel");
  const groups = finder.querySelector(".finder-groups");
  const empty = finder.querySelector(".finder-empty");
  const status = finder.querySelector(".finder-status");
  const clearBtn = finder.querySelector(".finder-clear");
  const url = finder.getAttribute("data-search");
  if (!input || !panel || !groups || !empty || !status || !url) return;

  let index = null;
  let failed = false;
  let activeGenre = "";
  try {
    activeGenre = new URLSearchParams(window.location.search).get("genre") || "";
  } catch {
    activeGenre = "";
  }
  document.addEventListener("usb-genre", (event) => {
    activeGenre = (event.detail && event.detail.genre) || "";
    if (input.value.trim()) onType();
  });

  function closePanel() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function openEntry(id) {
    closePanel();
    input.blur();
    const event = new CustomEvent("usb-open-entry", { cancelable: true, detail: { id } });
    document.dispatchEvent(event);
    const stage = document.querySelector(".flow-stage");
    const showStage = () => {
      if (stage && stage.scrollIntoView) stage.scrollIntoView({ block: "start" });
    };
    if (event.defaultPrevented) {
      showStage();
      window.setTimeout(showStage, 350);
      return;
    }
    const path = window.location.pathname;
    const home = path === "/" || path === "/index.html";
    const genreQuery = activeGenre ? `?genre=${encodeURIComponent(activeGenre)}` : "";
    if (home) {
      const url = new URL(window.location.href);
      if (activeGenre) url.searchParams.set("genre", activeGenre);
      url.hash = id;
      if (`${url.pathname}${url.search}` === `${window.location.pathname}${window.location.search}`) {
        window.location.hash = id;
        return;
      }
      window.location.assign(`${url.pathname}${url.search}${url.hash}`);
      return;
    }
    window.location.assign(`/${genreQuery}#${encodeURIComponent(id)}`);
  }

  function songButton(song, { showArtist }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "finder-hit";
    const title = document.createElement("span");
    title.className = "finder-title";
    title.textContent = song.title;
    button.appendChild(title);
    let subText = "";
    if (showArtist) {
      subText = song.album && song.album !== song.title ? `${song.artist} · ${song.album}` : song.artist;
    } else if (song.album && song.album !== song.title) {
      subText = song.album;
    }
    if (subText) {
      const sub = document.createElement("span");
      sub.className = "finder-sub";
      sub.textContent = subText;
      button.appendChild(sub);
    }
    button.addEventListener("click", () => openEntry(song.id));
    return button;
  }

  function render(sections) {
    groups.replaceChildren();
    status.textContent = summary(sections);
    if (!sections.length) {
      empty.hidden = false;
      panel.hidden = false;
      input.setAttribute("aria-expanded", "true");
      return;
    }
    empty.hidden = true;
    for (const section of sections) {
      const block = document.createElement("section");
      const heading = document.createElement("h2");
      heading.className = "finder-label";
      heading.textContent = section.label;
      block.appendChild(heading);
      const list = document.createElement("ul");
      list.className = "finder-list";
      if (section.people) {
        for (const person of section.people) {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.className = "finder-hit";
          link.href = person.href;
          const name = document.createElement("span");
          name.className = "finder-title";
          name.textContent = person.name;
          link.appendChild(name);
          item.appendChild(link);
          list.appendChild(item);
        }
      } else if (section.artists) {
        for (const artist of section.artists) {
          const item = document.createElement("li");
          item.className = "finder-artist";
          const name = document.createElement("p");
          name.className = "finder-artist-name";
          name.textContent = artist.name;
          item.appendChild(name);
          const tracks = document.createElement("ul");
          tracks.className = "finder-tracks";
          for (const track of artist.tracks) {
            const trackItem = document.createElement("li");
            trackItem.appendChild(songButton(track, { showArtist: false }));
            tracks.appendChild(trackItem);
          }
          item.appendChild(tracks);
          if (artist.total > artist.tracks.length) {
            const more = document.createElement("p");
            more.className = "finder-more";
            more.textContent = `${artist.tracks.length} of ${artist.total}`;
            item.appendChild(more);
          }
          list.appendChild(item);
        }
      } else if (section.songs) {
        for (const song of section.songs) {
          const item = document.createElement("li");
          item.appendChild(songButton(song, { showArtist: true }));
          list.appendChild(item);
        }
      }
      block.appendChild(list);
      groups.appendChild(block);
    }
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function showNote(text) {
    groups.replaceChildren();
    empty.hidden = false;
    empty.textContent = text;
    status.textContent = text;
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function onType() {
    clearBtn.hidden = input.value.length === 0;
    const query = input.value.trim();
    if (!query) {
      empty.textContent = "nothing found";
      closePanel();
      status.textContent = "";
      return;
    }
    if (!index) {
      showNote(failed ? "search is unavailable" : "search is loading");
      return;
    }
    empty.textContent = "nothing found";
    render(queryIndex(index, query, activeGenre));
  }

  input.addEventListener("input", onType);
  input.addEventListener("focus", () => {
    if (input.value.trim()) onType();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!input.value && panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      input.value = "";
      clearBtn.hidden = true;
      closePanel();
      status.textContent = "";
      return;
    }
    if (panel.hidden) return;
    if (event.key === "ArrowDown") {
      const first = panel.querySelector(".finder-hit");
      if (!first) return;
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.key === "Enter") {
      const first = panel.querySelector(".finder-hit");
      if (!first) return;
      event.preventDefault();
      first.click();
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const hits = [...panel.querySelectorAll(".finder-hit")];
    const at = hits.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    if (event.key === "ArrowDown" && hits[at + 1]) hits[at + 1].focus();
    else if (event.key === "ArrowUp") (hits[at - 1] || input).focus();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.hidden = true;
    closePanel();
    status.textContent = "";
    input.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (panel.hidden) return;
    if (finder.contains(event.target)) return;
    closePanel();
  });

  fetch(url, { credentials: "omit", mode: "cors" })
    .then((res) => {
      if (!res.ok) throw new Error("search");
      return res.json();
    })
    .then((data) => {
      if (!data || !Array.isArray(data.entries)) throw new Error("search");
      index = prepareIndex(data.entries);
      if (input.value.trim()) onType();
    })
    .catch(() => {
      failed = true;
      if (input.value.trim()) onType();
    });
}

if (typeof document !== "undefined") boot();
