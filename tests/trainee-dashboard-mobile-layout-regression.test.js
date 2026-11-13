import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");

assert.match(
  html,
  /\.v4-dashboard\{margin-top:10px;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/,
  "The trainee dashboard must use a bounded three-column desktop grid."
);
assert.match(
  html,
  /@media\(max-width:600px\)\{[\s\S]*?\.v4-dashboard\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  "The trainee dashboard must switch to two equal columns on mobile."
);
assert.match(
  html,
  /\.v4-dashboard \.v4-card\{overflow-wrap:anywhere;word-break:normal\}/,
  "Dashboard cards must wrap long labels instead of overflowing."
);
assert.doesNotMatch(
  html,
  /seh-profile-exit[^\n]*logoutApp\(\)[^\n]*خروج از حساب کاربری/,
  "The trainee profile renderer must not create a logout button."
);
assert.match(
  html,
  /const legacyExit=wrap\.querySelector\('\.seh-profile-exit'\);\s*if\(legacyExit\)legacyExit\.remove\(\);/,
  "The renderer must remove a stale logout control left in an already-rendered profile card."
);
assert.match(
  html,
  /body\.seh-trainee-mode #authUserBar\{display:none!important\}/,
  "The coach auth bar remains hidden in trainee mode."
);

console.log("PASS: trainee dashboard has bounded responsive cards and no trainee logout control.");
