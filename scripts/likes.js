import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./catalog.js";

const likesPath = path.join(repoRoot, "data", "likes.json");

// Same order as an iMessage tapback picker. The glyph is what the page shows.
export const TAPBACKS = [
  ["love", "♥"],
  ["like", "👍"],
  ["dislike", "👎"],
  ["laugh", "haha"],
  ["emphasize", "!!"],
  ["question", "?"],
];

const NAMED = new Set(TAPBACKS.map(([type]) => type));
// Stickers are real tapbacks in the file. The page does not draw them.
const SKIPPED = new Set(["sticker"]);
const FIRST_NAME = /^[A-Za-z][A-Za-z'-]{0,23}$/;
const PHONE_IN_NAME = /(?:\+\d[\d\s().-]{8,}\d)|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/;
const EMAIL_IN_NAME = /@/;
// A raw emoji tapback, including a variation selector, but not a sentence.
const EMOJI_TYPE = /^(?:\p{Extended_Pictographic}\uFE0F?)+$/u;
// Three names still fit on one quiet line. Past that, keep two and a count.
const VISIBLE_NAMES = 3;

function allowedType(type) {
  return typeof type === "string" && (NAMED.has(type) || SKIPPED.has(type) || EMOJI_TYPE.test(type));
}

function catalogIdMap(catalog) {
  const byLower = new Map();
  if (!catalog || !Array.isArray(catalog.entries)) return byLower;
  for (const entry of catalog.entries) {
    if (entry && typeof entry.id === "string") byLower.set(entry.id.toLowerCase(), entry.id);
  }
  return byLower;
}

export function readLikes() {
  let likes;
  try {
    likes = JSON.parse(fs.readFileSync(likesPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read data/likes.json: ${error.message}`);
  }
  return likes;
}

export function validateLikes(likes, catalog) {
  const errors = [];
  if (!likes || typeof likes !== "object" || Array.isArray(likes)) {
    return ["likes must be an object keyed by catalog id"];
  }
  const ids = catalogIdMap(catalog);
  const seenIds = new Set();
  for (const [key, list] of Object.entries(likes)) {
    const canon = typeof key === "string" ? ids.get(key.toLowerCase()) : undefined;
    if (!canon) {
      errors.push(`${key} is not a catalog id`);
      continue;
    }
    if (seenIds.has(canon)) {
      errors.push(`${key} repeats catalog id ${canon}`);
      continue;
    }
    seenIds.add(canon);
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${key} must be a non-empty list of tapbacks`);
      continue;
    }
    const seen = new Set();
    list.forEach((tap, index) => {
      const where = `${key}[${index}]`;
      if (!tap || typeof tap !== "object" || Array.isArray(tap)) {
        errors.push(`${where} must be an object with name and type`);
        return;
      }
      const extra = Object.keys(tap).filter((field) => field !== "name" && field !== "type");
      if (extra.length) errors.push(`${where} has unexpected ${extra.join(", ")}`);
      const name = tap.name;
      if (typeof name !== "string") {
        errors.push(`${where}.name must be a plain first name`);
      } else if (EMAIL_IN_NAME.test(name)) {
        errors.push(`${where}.name looks like an email`);
      } else if (PHONE_IN_NAME.test(name) || /\d/.test(name)) {
        errors.push(`${where}.name looks like a phone number`);
      } else if (!FIRST_NAME.test(name)) {
        errors.push(`${where}.name must be a plain first name`);
      }
      if (!allowedType(tap.type)) {
        errors.push(`${where}.type must be a tapback, sticker, or emoji`);
      }
      if (typeof name === "string" && allowedType(tap.type)) {
        const signature = `${name}\0${tap.type}`;
        if (seen.has(signature)) errors.push(`${where} repeats ${name} ${tap.type}`);
        seen.add(signature);
      }
    });
  }
  return errors;
}

export function likesById(likes, catalog) {
  const ids = catalogIdMap(catalog);
  const map = new Map();
  for (const [key, list] of Object.entries(likes)) {
    const canon = ids.get(String(key).toLowerCase());
    if (canon) map.set(canon, list);
  }
  return map;
}

// Up to three names stay written out. Past that, the line keeps two and a count,
// and `title` still names everyone so a hover can show the rest.
export function likesLine(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const grouped = new Map();
  const emojiOrder = [];
  for (const tap of list) {
    if (!tap || typeof tap.name !== "string" || !allowedType(tap.type) || SKIPPED.has(tap.type)) continue;
    if (!grouped.has(tap.type)) {
      grouped.set(tap.type, []);
      if (!NAMED.has(tap.type)) emojiOrder.push(tap.type);
    }
    grouped.get(tap.type).push(tap.name);
  }
  const parts = [];
  const full = [];
  const order = [...TAPBACKS.map(([type]) => type).filter((type) => grouped.has(type)), ...emojiOrder];
  for (const type of order) {
    const names = grouped.get(type);
    const glyph = NAMED.has(type) ? TAPBACKS.find(([name]) => name === type)[1] : type;
    const shown =
      names.length > VISIBLE_NAMES
        ? `${names.slice(0, 2).join(", ")} +${names.length - 2}`
        : names.join(", ");
    parts.push(`${glyph} ${shown}`);
    full.push(`${glyph} ${names.join(", ")}`);
  }
  if (parts.length === 0) return null;
  return { text: parts.join("  "), title: full.join("  ") };
}

export function assertValidLikes(catalog) {
  let likes;
  try {
    likes = readLikes();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const errors = validateLikes(likes, catalog);
  if (errors.length > 0) {
    const noun = errors.length === 1 ? "problem" : "problems";
    console.error(`data/likes.json has ${errors.length} ${noun}:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  return likesById(likes, catalog);
}
