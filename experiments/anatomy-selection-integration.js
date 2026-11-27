(function(){
'use strict';
const scriptUrl=document.currentScript.src;
const mapUrl=new URL('ANATOMY-EXERCISE-MAPPING.json',scriptUrl);
const catalogUrl=new URL('ANATOMY-MUSCLE-CATALOG.json',scriptUrl);
const status=document.createElement('div');
status.className='notice';
status.id='pairStatus';
status.textContent='در حال بارگذاری اطلاعات اتصال عضلات…';
const aside=document.querySelector('.layout aside');
const selectedNode=document.getElementById('selected');
selectedNode.insertAdjacentElement('afterend',status);
const exerciseCard=document.createElement('section');
exerciseCard.className='card';
exerciseCard.style.marginTop='14px';
exerciseCard.innerHTML='<h2>حرکات مرتبط از بانک مربی</h2><p class="info" id="exerciseHelp">برای نمایش حرکات، نسخه اصلی اپ باید فهرست حرکات مربیِ واردشده را به این نمونه تحویل دهد. این نمونه مستقل به پایگاه داده یا نشست ورود دسترسی مستقیم ندارد.</p><div class="toolbar" style="margin:8px 0"><label><input id="broadMatches" type="checkbox" checked> نمایش تطبیق‌های ناحیه‌ای و عملکردی</label></div><div id="exerciseResults" class="list"><div class="empty">بانک حرکات هنوز به این نمونه متصل نشده است.</div></div>';
aside.appendChild(exerciseCard);
let mapping=null,catalog=null,exerciseAdapter=null,exerciseRows=null;
let pairState='loading';
const pairWarnings=new Map();
const originalRender=renderSelected;
function currentData(){return DATA[state.sex+'-'+state.view]}
function currentPaths(){return currentData().muscles}
function sideOf(id){if(typeof id!=='string')return null;if(id.endsWith('_LEFT'))return 'LEFT';if(id.endsWith('_RIGHT'))return 'RIGHT';return null}
function pairFor(path){
 const groupPaths=currentPaths().map((p,i)=>({p,i})).filter(x=>x.p.group===path.group);
 const left=groupPaths.filter(x=>sideOf(x.p.id)==='LEFT');
 const right=groupPaths.filter(x=>sideOf(x.p.id)==='RIGHT');
 const idsValid=left.length===1&&right.length===1;
 const meta=catalog&&catalog.groups.find(g=>g.source_group_key===path.group);
 const allowed=meta&&meta.pairing_status==='reviewed';
 if(!idsValid||!allowed)return {ok:false,reason:!allowed?'این گروه هنوز از ممیزی هندسه عبور نکرده است.':'هندسه هر دو سمت یکتا و کامل نیست.',items:[]};
 return {ok:true,items:[left[0],right[0]]};
}
function selectedPairs(){
 const paths=currentPaths(), groups=new Map();
 Object.entries(selectedMap()).forEach(([key,role])=>{
  const i=paths.findIndex((p,index)=>keyFor(p,index)===key);
  if(i<0)return;
  const p=paths[i],g=p.group;
  if(!groups.has(g))groups.set(g,{group:g,role,indices:[],ids:[]});
  const x=groups.get(g);x.indices.push(i);x.ids.push(p.id||'');
  if(x.role!==role)x.role='mixed';
 });
 return [...groups.values()];
}
function groupLabel(group){return LABELS[group]||group}
function renderSelected(){
 const groups=selectedPairs();
 count.textContent=groups.length.toLocaleString('fa-IR')+' گروه عضلانی انتخاب‌شده';
 if(!groups.length){selected.innerHTML='<div class="empty">هنوز عضله‌ای انتخاب نشده است.</div>';renderExercises();return}
 selected.innerHTML=groups.map(x=>{
  const d=currentPaths(),pair=pairFor(d[x.indices[0]]);
  const paired=pair.ok&&pair.items.every(y=>Object.entries(selectedMap()).some(([k])=>k===keyFor(y.p,y.i)));
  const roleColor=x.role==='secondary'?'#3389b7':'#d94b45';
  const tag=paired?'دوطرفه':(x.indices.length>1?'چند قطعه':'یک سمت / قطعه');
  return '<div class="item"><span>'+groupLabel(x.group)+' <small class="badge">'+tag+'</small></span><span><i class="dot" style="background:'+roleColor+'"></i><button type="button" data-remove-group="'+x.group+'">×</button></span></div>';
 }).join('');
 selected.querySelectorAll('[data-remove-group]').forEach(b=>b.addEventListener('click',()=>{
  const g=b.dataset.removeGroup;
  currentPaths().forEach((p,i)=>{if(p.group===g)delete selectedMap()[keyFor(p,i)]});
  draw();
 }));
 renderExercises();
}
function handlePath(el){
 const paths=currentPaths(),i=Number([...svg.children].filter(n=>n.classList.contains('muscle')).indexOf(el));
 const path=paths[i];
 if(!path)return;
 const pair=pairFor(path);
 const targets=pair.ok?pair.items:[{p:path,i}];
 const current=selectedMap();
 const allSame=targets.every(x=>current[keyFor(x.p,x.i)]===state.role);
 targets.forEach(x=>{const k=keyFor(x.p,x.i);if(allSame)delete current[k];else current[k]=state.role});
 if(!pair.ok)pairWarnings.set(path.group,pair.reason);else pairWarnings.delete(path.group);
 draw();
}
svg.addEventListener('click',e=>{
 const el=e.target.closest('.muscle');if(!el)return;
 e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();handlePath(el);
},true);
svg.addEventListener('keydown',e=>{
 const el=e.target.closest('.muscle');if(!el||!(e.key==='Enter'||e.key===' '))return;
 e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();handlePath(el);
},true);
function renderExercises(){
 const box=document.getElementById('exerciseResults'),help=document.getElementById('exerciseHelp');
 if(!exerciseAdapter||!Array.isArray(exerciseRows)){
  box.innerHTML='<div class="empty">اتصال امن بانک مربی هنوز از سمت نشست اصلی اپ انجام نشده است.</div>';return;
 }
 const selectedGroups=selectedPairs().map(x=>x.group.toLowerCase());
 const strict=exerciseAdapter.filterExercises(exerciseRows,selectedGroups,{strictOnly:true});
 const broad=document.getElementById('broadMatches').checked?exerciseAdapter.filterExercises(exerciseRows,selectedGroups):[];
 const byId=new Map();
 [...strict,...broad].forEach(x=>{const old=byId.get(String(x.exercise.id));if(!old||x.match_type==='exact_group')byId.set(String(x.exercise.id),x)});
 const rows=[...byId.values()];
 help.textContent='نتایج از فهرست حرکاتی می‌آیند که اپِ میزبان به‌صورت مجاز تحویل داده است؛ هیچ رکوردی در بانک تغییر نمی‌کند.';
 if(!rows.length){box.innerHTML='<div class="empty">برای عضلات انتخاب‌شده، حرکت منطبق پیدا نشد.</div>';return}
 box.innerHTML=rows.map(x=>'<div class="item"><span>'+String(x.exercise.name||'حرکت بدون نام').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+' <small class="badge">'+(x.match_type==='exact_group'?'تطبیق دقیق':'تطبیق ناحیه‌ای / عملکردی')+'</small></span><span class="info">#'+x.exercise.id+'</span></div>').join('');
}
document.getElementById('broadMatches').addEventListener('change',renderExercises);
window.SehAnatomyExerciseIntegration=Object.freeze({
 setExercises(rows){
  if(!Array.isArray(rows))throw new TypeError('Expected authenticated trainer exercise rows');
  exerciseRows=rows.slice();
  renderExercises();
 },
 clearExercises(){exerciseRows=null;renderExercises()},
 getSelectedGroupIds(){return selectedPairs().map(x=>x.group.toLowerCase())},
 getPairStatus(){return pairState}
});
window.renderSelected=renderSelected;
renderSelected();
Promise.all([fetch(mapUrl).then(r=>{if(!r.ok)throw new Error('mapping '+r.status);return r.json()}),fetch(catalogUrl).then(r=>{if(!r.ok)throw new Error('catalog '+r.status);return r.json()})])
.then(([m,c])=>{
 mapping=m;catalog=c;
 if(!window.SehAnatomyExerciseAdapter)throw new Error('exercise adapter not loaded');
 exerciseAdapter=window.SehAnatomyExerciseAdapter.create(mapping);
 pairState='ready';
 status.textContent='انتخاب دوطرفه فقط وقتی فعال می‌شود که شناسه چپ و راست هر دو یکتا و حاضر باشند؛ گروه‌های مبهم یا ناقص به‌صورت خودکار جفت نمی‌شوند.';
 renderSelected();
})
.catch(err=>{
 pairState='error';
 status.textContent='اطلاعات نگاشت بارگذاری نشد؛ انتخاب‌ها به‌صورت ایمنِ تک‌قطعه باقی می‌مانند. ('+err.message+')';
});
})();