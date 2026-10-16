import { assertValidCatalog } from "./catalog.js";

const catalog = assertValidCatalog();
console.log(`data/catalog.json ok (${catalog.entries.length} entries)`);
