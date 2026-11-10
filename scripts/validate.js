import { assertValidCatalog } from "./catalog.js";
import { assertValidLikes } from "./likes.js";

const catalog = assertValidCatalog();
const likes = assertValidLikes(catalog);
console.log(`data/catalog.json ok (${catalog.entries.length} entries)`);
console.log(`data/likes.json ok (${likes.size} songs)`);
