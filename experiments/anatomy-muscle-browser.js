(function(){
'use strict';
const scriptUrl=document.currentScript.src;
const catalogUrl=new URL('ANATOMY-MUSCLE-CATALOG.json',scriptUrl);
const aside=document.querySelector('.layout aside');
const selectedHeading=aside.querySelector('h2');
const browser=document.createElement('section');
browser.className='card';
browser.id='muscleBrowser';
browser.style.marginBottom='14px';
browser.innerHTML='<h2>فهرست عضلات</h2><p class="info">هر ردیف دقیقاً به یک مسیر هندسی موجود در نمای انتخاب‌شده وصل است. انتخاب از فهرست و تصویر با هم همگام می‌شود.</p><input id="muscleSearch" type="search" placeholder="جست‌وجوی فارسی یا لاتین عضله…" aria-label="جست‌وجوی عضلات" style="width:100%;padding:10px 12px;border:1px solid #ddc995;border-radius:10px;font:inherit;background:#fff"><div id="muscleBrowserList" class="list" aria-live="polite"><div class="empty">در حال بارگذاری فهرست عضلات…</div></div><p class="info" id="muscleBrowserCount"></p>';
aside.insertBefore(browser,selectedHeading);
let catalog=null;
const list=browser.querySelector('#muscleBrowserList');
const search=browser.querySelector('#muscleSearch');
const count=browser.querySelector('#muscleBrowserCount');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function currentView(){return state.sex+'-'+state.view}
function entries(){
 if(!catalog)return [];
 const view=currentView(),out=[];
 catalog.groups.forEach(group=>{
  const paths=group.geometry_by_view&&group.geometry_by_view[view]||[];
  paths.forEach((path,index)=>out.push({
   group,path,index,total:paths.length,
   key:path.selection_key,
   label:group.name_fa+(paths.length>1?' · قطعه '+(index+1):''),
   search:[group.name_fa,group.name_latin,group.group_id,group.source_group_key,path.id].join(' ').toLocaleLowerCase()
  }));
 });
 return out;
}
function render(){
 if(!catalog)return;
 const q=search.value.trim().toLocaleLowerCase();
 const all=entries(),rows=all.filter(x=>!q||x.search.includes(q));
 if(!rows.length){list.innerHTML='<div class="empty">عضله‌ای با این جست‌وجو در نمای فعلی پیدا نشد.</div>';count.textContent='';return}
 list.innerHTML=rows.map(x=>{
  const role=selectedMap()[x.key]||'';
  return '<button type="button" class="item muscle-browser-item" data-muscle-key="'+esc(x.key)+'" aria-pressed="'+(!!role)+'" style="width:100%;text-align:right;color:inherit;cursor:pointer;background:'+(role?'#f4e9cc':'#fff')+';border-color:'+(role?'#98752d':'#e6dcc3')+'"><span><strong>'+esc(x.label)+'</strong><br><small class="info">'+esc(x.group.name_latin)+(x.path.id?' · '+esc(x.path.id):'')+'</small></span><span class="badge">'+(role==='primary'?'اصلی':role==='secondary'?'کمکی':'انتخاب')+'</span></button>';
 }).join('');
 list.querySelectorAll('[data-muscle-key]').forEach(button=>button.addEventListener('click',()=>{
  const key=button.dataset.muscleKey;
  if(selectedMap()[key])delete selectedMap()[key];
  else selectedMap()[key]=state.role;
  draw();
 }));
 count.textContent='نمایش '+rows.length.toLocaleString('fa-IR')+' از '+all.length.toLocaleString('fa-IR')+' مسیر عضلانی در این نما · '+catalog.groups.length.toLocaleString('fa-IR')+' گروه در کاتالوگ';
}
search.addEventListener('input',render);
const originalDraw=draw;
window.draw=function(){originalDraw();render()};
const originalRender=window.renderSelected||renderSelected;
window.renderSelected=function(){originalRender();render()};
fetch(catalogUrl).then(response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.json()})
.then(data=>{
 if(!Array.isArray(data.groups))throw new Error('ساختار کاتالوگ معتبر نیست');
 catalog=data;
 render();
})
.catch(error=>{
 list.innerHTML='<div class="empty">فهرست عضلات بارگذاری نشد؛ نقشه تعاملی موجود بدون تغییر باقی مانده است. '+esc(error.message)+'</div>';
});
})();