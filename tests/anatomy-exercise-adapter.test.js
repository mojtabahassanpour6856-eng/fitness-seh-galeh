const fs=require('node:fs');
const assert=require('node:assert/strict');
const mapping=JSON.parse(fs.readFileSync('experiments/ANATOMY-EXERCISE-MAPPING.json','utf8'));
const source=fs.readFileSync('experiments/anatomy-exercise-adapter.js','utf8');
const vm=require('node:vm');
const context={globalThis:{}};
vm.runInNewContext(source,context);
const adapter=context.globalThis.SehAnatomyExerciseAdapter.create(mapping);
const rows=[
 {id:11,name:'پرس سینه',target_muscle:'سینه',category:'سینه'},
 {id:12,name:'قایقی',target_muscle:'پشت',category:'پشت'},
 {id:13,name:'چرخش خارجی شانه',target_muscle:'چرخاننده‌های خارجی شانه',category:'اصلاحی'},
 {id:14,name:'اسکوات',target_muscle:'عضله چهارسر ران',category:'اصلاحی'},
 {id:15,name:'گردن',target_muscle:'تحرک گردن',category:'اصلاحی'},
 {id:16,name:'بدون هدف',target_muscle:null,category:'سینه'}
];
const chest=adapter.filterExercises(rows,['chest']);
assert.deepEqual(Array.from(chest, x=>x.exercise.id),[11]);
assert.equal(chest[0].match_type,'broad_region');
const back=adapter.filterExercises(rows,['lats']);
assert.deepEqual(Array.from(back, x=>x.exercise.id),[12]);
assert.equal(back[0].match_type,'multi_group_region');
const quads=adapter.filterExercises(rows,['quads']);
assert.deepEqual(Array.from(quads, x=>x.exercise.id),[14]);
assert.deepEqual(Array.from(adapter.filterExercises(rows,['quads'],{strictOnly:true}), x=>x.exercise.id),[14]);
assert.deepEqual(Array.from(adapter.filterExercises(rows,['shoulders_rear'],{strictOnly:true})),[]);
assert.deepEqual(Array.from(adapter.filterExercises(rows,[])),[]);
assert.equal(rows[0].name,'پرس سینه','source exercise rows must not be mutated');
assert.equal(chest[0].role,null,'primary/secondary role must never be guessed');

assert.equal(adapter.filterExercises([{id:17,name:'تمرین',target_muscle:'  سینه  '}],['chest'])[0].exercise.id,17,'Persian label normalization must trim whitespace');
assert.throws(()=>context.globalThis.SehAnatomyExerciseAdapter.create({labels:[
 {source_label:'سینه',anatomy_group_ids:['chest'],mapping:'exact_group'},
 {source_label:'سینه',anatomy_group_ids:['chest'],mapping:'exact_group'}
]}),/Duplicate source label/,'ambiguous duplicate mapping labels must fail closed');
assert.deepEqual(Array.from(adapter.filterExercises([null,{id:null,target_muscle:'سینه'},{id:18,target_muscle:'نامشخص'}],['chest'])),[],'invalid rows and unmapped labels must be excluded');

console.log('PASS: exact label matching, broad-region classification, unmapped exclusion, strict mode, empty selection, and immutable source rows.');
