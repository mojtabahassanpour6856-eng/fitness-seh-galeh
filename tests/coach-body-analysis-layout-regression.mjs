import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const embed = read("top-genesis-pdf-app-embed.js");
const publication = read("top-genesis-publication.js");

assert.match(html, /id="navBodyAnalysis"[^>]*window\.openCoachBodyAnalysis\(\)/,
  "The coach navigation must open the unified Body Analysis section directly.");
assert.doesNotMatch(html, /navAnalysisImport|analysisImport/,
  "The standalone Import Analysis navigation/card must be removed.");
const section = html.match(/<section id="bodyAnalysis" class="section">([\s\S]*?)<\/section>/);
assert.ok(section, "A dedicated Body Analysis section must exist.");
assert.match(section[1], /id="bodyAnalysisEntryPanel"/,
  "The analysis entry host must live inside the Body Analysis section.");
assert.match(section[1], /آنالیز بدن شاگرد/,
  "The unified card must have the Body Analysis heading.");
assert.match(html, /window\.openCoachBodyAnalysis=function\(\)[\s\S]*?profile\.role!=="coach"[\s\S]*?item\.classList\.toggle\("active",active\)/,
  "The coach route must activate the section directly and be role-guarded.");
assert.match(embed, /const anchor = document\.getElementById\("bodyAnalysisEntryPanel"\)/);
assert.match(embed, /anchor\.appendChild\(host\)/,
  "The PDF/ZIP analyzer must be nested inside the unified Body Analysis card.");
assert.doesNotMatch(embed, /insertAdjacentElement\("afterend", host\)/,
  "The PDF/ZIP analyzer must not render as a separate adjacent card.");
assert.match(publication, /const target = \$\("bodyAnalysisEntryPanel"\)/,
  "Published analysis reports must be placed inside the unified Body Analysis card.");
assert.match(html, /profile\?\.role==='coach'\?\$\('bodyAnalysisEntryPanel'\):\$\('progress'\)/,
  "Coach analysis trend/history cards must be created in Body Analysis, not Progress.");
assert.match(html, /id="progressEntryPanel"/,
  "The manual Progress entry card must remain intact.");
assert.match(html, /id="progress" class="section"/,
  "The manual Progress section must remain intact.");

console.log("[coach-body-analysis] unified card, coach route, PDF/ZIP mount, published reports, and manual Progress isolation passed.");
