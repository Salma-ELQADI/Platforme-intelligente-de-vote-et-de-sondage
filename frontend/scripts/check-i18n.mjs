// Checks the translation dictionaries:
//  1. every key used in the code (t("a.b"), rich("a.b"), t(`a.${x}`)) exists in fr.json;
//  2. en.json and ar.json define exactly the same keys as fr.json (plural
//     variants excepted: each language has its own plural categories);
//  3. placeholders ({name}) are the same in every language.
// Usage: node scripts/check-i18n.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const load = (l) => JSON.parse(fs.readFileSync(path.join(root, "src/locales", `${l}.json`), "utf8"));
const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === "string" ? [[prefix + k, v]] : flatten(v, `${prefix}${k}.`)));

const PLURAL = /_(zero|one|two|few|many|other)$/;
const dicts = Object.fromEntries(["fr", "en", "ar"].map((l) => [l, new Map(flatten(load(l)))]));
const base = (k) => k.replace(PLURAL, "");
const baseKeys = (m) => new Set([...m.keys()].map(base));
const problems = [];

// 1. keys used in code
const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && files.push(path.join(d, e.name))));
walk(path.join(root, "src"));
const frBase = baseKeys(dicts.fr);
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\b(?:t|rich|tRef\.current|translate\(\s*locale\s*,)\(?\s*["`]([a-zA-Z]+\.[a-zA-Z0-9_.${}]+)["`]/g)) {
    const key = m[1];
    if (key.includes("${")) {
      const prefix = key.slice(0, key.indexOf("${"));
      if (![...frBase].some((k) => k.startsWith(prefix))) problems.push(`${path.relative(root, f)}: no key starts with "${prefix}"`);
    } else if (!frBase.has(key)) problems.push(`${path.relative(root, f)}: missing key "${key}"`);
  }
}

// 2. same keys everywhere
for (const l of ["en", "ar"]) {
  const lb = baseKeys(dicts[l]);
  for (const k of frBase) if (!lb.has(k)) problems.push(`${l}.json: missing "${k}"`);
  for (const k of lb) if (!frBase.has(k)) problems.push(`${l}.json: extra "${k}"`);
  // plural keys must have an _other form
  for (const k of dicts[l].keys()) if (PLURAL.test(k) && !dicts[l].has(`${base(k)}_other`)) problems.push(`${l}.json: "${base(k)}" lacks _other`);
}

// 3. placeholders
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => v !== "count").sort().join(",");
const byBase = (m) => {
  const out = new Map();
  for (const [k, v] of m) out.set(base(k), [...(out.get(base(k)) ?? []), vars(v)]);
  return out;
};
const frVars = byBase(dicts.fr);
for (const l of ["en", "ar"]) {
  for (const [k, list] of byBase(dicts[l])) {
    const expected = new Set(frVars.get(k) ?? []);
    for (const v of list) if (!expected.has(v)) problems.push(`${l}.json: "${k}" placeholders {${v}} differ from fr {${[...expected].join(" | ")}}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`i18n OK: ${frBase.size} keys in fr, en, ar; all keys used in code exist.`);
