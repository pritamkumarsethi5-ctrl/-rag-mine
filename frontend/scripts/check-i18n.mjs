// Verifies that hi/mr/or contain every key of en and keep {placeholders}. Run: npm run check:i18n
import { readFileSync } from "node:fs";
const load = (f) => {
  const src = readFileSync(new URL(`../src/i18n/${f}.ts`, import.meta.url), "utf8");
  const body = src.slice(src.indexOf("{", src.indexOf("=")));
  const m = new Map();
  for (const x of body.matchAll(/"([^"\\]+)":\s*"((?:[^"\\]|\\.)*)"/g)) m.set(x[1], x[2]);
  return m;
};
const en = load("en");
let bad = 0;
for (const l of ["hi", "mr", "or"]) {
  const d = load(l);
  for (const [k, v] of en) {
    if (!d.has(k)) { console.error(`[${l}] missing key: ${k}`); bad++; continue; }
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    if (ph(v) !== ph(d.get(k))) { console.error(`[${l}] placeholder mismatch: ${k}  en={${ph(v)}} ${l}={${ph(d.get(k))}}`); bad++; }
    if (v !== "" && d.get(k) === "") { console.error(`[${l}] empty: ${k}`); bad++; }
  }
  for (const k of d.keys()) if (!en.has(k)) { console.error(`[${l}] extra key: ${k}`); bad++; }
  console.log(`${l}: ${d.size} keys`);
}
console.log(`en: ${en.size} keys`);
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
console.log("i18n OK");
