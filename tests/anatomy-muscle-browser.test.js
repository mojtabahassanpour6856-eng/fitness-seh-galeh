"use strict";
const fs=require("node:fs");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const browser=fs.readFileSync("experiments/anatomy-muscle-browser.js","utf8");
const html=fs.readFileSync("experiments/anatomy-smart-prototype.html","utf8");
const catalog=JSON.parse(fs.readFileSync("experiments/ANATOMY-MUSCLE-CATALOG.json","utf8"));
const source=fs.readFileSync("experiments/anatomy-smart-prototype.html","utf8");
const dataMatch=source.match(/const DATA=(\\{[\\s\\S]*?\\});\\s*window\\.__ANATOMY_SOURCE_PATH_COUNT__/);
assert.ok(dataMatch,"prototype must expose the exact source DATA inventory");
const sourceData=JSON.parse(dataMatch[1]);
function sourceKey(path){
 const input=String(path.group||"MUSCLE")+"|"+String(path.d||"");
 let hashA=2166136261,hashB=0x9e3779b9;
 for(let i=0;i<input.length;i++){
  const code=input.charCodeAt(i);
  hashA=Math.imul(hashA^code,16777619);
  hashB=Math.imul(hashB^code,0x5bd1e995);
  hashB^=hashB>>>13;
 }
 return String(path.group||"MUSCLE")+"__"+(hashA>>>0).toString(36)+"-"+(hashB>>>0).toString(36);
}
const integration=html.indexOf('<script src="./anatomy-selection-integration.js"></script>');
const browserRef=html.indexOf('<script src="./anatomy-muscle-browser.js"></script>');
assert.ok(integration>=0&&browserRef>integration,"muscle browser must load after shared anatomy selection integration");
new vm.Script(browser);
assert.match(browser,/ANATOMY-MUSCLE-CATALOG[.]json/,"browser must load the authoritative muscle catalog");
assert.match(browser,/geometry_by_view/,"browser must show only geometry assigned to the active body view");
assert.match(browser,/selection_key/,"catalog path identity must be used to bind each row to its SVG path");
assert.match(browser,/selectedMap/,"list selection state must use the shared selection store");
assert.match(browser,/draw[(][)]/,"list click must redraw the selected SVG geometry");
assert.match(browser,/name_fa/,"search must include Persian anatomical names");
assert.match(browser,/name_latin/,"search must include Latin anatomical names");
assert.match(browser,/aria-pressed/,"list must expose accessible selected state");
const integration=fs.readFileSync("experiments/anatomy-selection-integration.js","utf8");
assert.match(browser,/sameId>1/,"ambiguous duplicate-ID geometry must be disabled in the list");
assert.match(browser,/!path[.]id/,"geometry without a source ID must be disabled in the list");
assert.match(integration,/sameId!==1/,"SVG selection must reject missing or duplicate source IDs");
assert.match(integration,/data-geometryBlocked/,"blocked geometry must provide an explicit user-facing status");
assert.match(integration,/firstSafeMuscle/,"browser smoke must choose uniquely identified paths in all views");
assert.match(browser,/anatomyMuscleBrowserSmoke/,"browser smoke must publish an explicit pass marker");
assert.match(browser,/Persian search must find catalog entries/,"browser smoke must exercise Persian search");
assert.match(browser,/Latin search must find catalog entries/,"browser smoke must exercise Latin search");
assert.match(browser,/list click must paint exactly the linked SVG path/,"browser smoke must verify image/list synchronization");
assert.doesNotMatch(browser,/supabase|service_role|anon_key/i,"standalone browser must not access backend data");
const views=["male-front","male-back","female-front","female-back"];
let total=0;
for(const view of views){
 const count=catalog.groups.reduce((sum,g)=>sum+((g.geometry_by_view&&g.geometry_by_view[view])||[]).length,0);
 assert.ok(count>0,view+" must have catalog-backed anatomy paths");
 total+=count;
}
assert.equal(total,116,"catalog must account for all 116 source SVG paths");
let verified=0,ambiguous=0;
for(const view of views){
 const sourcePaths=sourceData[view].muscles;
 for(const group of catalog.groups){
  const indexed=group.geometry_by_view&&group.geometry_by_view[view]||[];
  for(const entry of indexed){
   const path=sourcePaths[entry.index];
   assert.ok(path,"catalog index must resolve to a source SVG path: "+view+" #"+entry.index);
   assert.equal(path.group,group.source_group_key,"catalog group must match source SVG group");
   assert.equal(path.id||null,entry.id||null,"catalog source ID must match source SVG path");
   assert.equal(sourceKey(path),entry.selection_key,"catalog selection key must match exact source geometry fingerprint");
   verified++;
  }
 }
}
assert.equal(verified,116,"every catalog entry must map one-to-one to an exact source path");
for(const view of views){
 for(const group of catalog.groups){
  const paths=(group.geometry_by_view&&group.geometry_by_view[view])||[];
  const counts=new Map();
  paths.forEach(p=>{if(p.id)counts.set(p.id,(counts.get(p.id)||0)+1)});
  paths.forEach(p=>{if(!p.id||counts.get(p.id)>1)ambiguous++});
 }
}
console.log("PASS: all "+verified+" catalog paths match exact source geometry fingerprints across four views; "+ambiguous+" ambiguous paths identified for review; bilingual search, shared selection wiring, accessibility, and read-only isolation checks passed.");
