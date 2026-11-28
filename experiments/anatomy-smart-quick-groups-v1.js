(()=>{
'use strict';
const catalogUrl='./ANATOMY-MUSCLE-CATALOG.json';
const groups=[
{cat:'سینه',items:[['chest_upper','بالاسینه','chest','emphasis'],['chest_mid','سینه میانی','chest','emphasis'],['chest_lower','زیرسینه','chest','emphasis']]},
{cat:'سرشانه',items:[['front_delt','سرشانه جلو','shoulders_front','broad'],['side_delt','سرشانه میانی','shoulders_side','broad'],['rear_delt','سرشانه خلفی','shoulders_rear','broad']]},
{cat:'بازو و ساعد',items:[['biceps_long','جلو بازو (تأکید نسبی بر سر بلند)','biceps','emphasis'],['biceps_short','جلو بازو (تأکید نسبی بر سر کوتاه)','biceps','emphasis'],['brachialis','براکیالیس',null,'missing'],['triceps_long','پشت بازو (سر بلند)','triceps','emphasis'],['triceps_lateral','پشت بازو (سر خارجی)','triceps','emphasis'],['forearm_flex','ساعد (خم‌کننده)','forearms','emphasis'],['forearm_ext','ساعد (بازکننده)','forearms','emphasis']]},
{cat:'شکم و پهلو',items:[['rectus_flex','راست شکمی (تأکید بر خم‌کردن تنه)','core','emphasis'],['rectus_pelvis','راست شکمی (تأکید بر چرخش خلفی لگن)','core','emphasis'],['obliques','پهلو','obliques','broad']]},
{cat:'ران و ساق',items:[['quads','چهارسر ران','quads','broad'],['adductors','داخل ران','adductors','broad'],['abductors','خارج ران','abductors','broad'],['hamstrings','همسترینگ','hamstrings','broad'],['calves','ساق پا','calves','broad']]},
{cat:'پشت و کول',items:[['traps','کول','trapezius','broad'],['lats','زیربغل','lats','broad'],['mid_back','میانه پشت',['rhomboids','trapezius'],'region'],['lower_back','فیله کمر','back_lower','broad']]},
{cat:'باسن',items:[['glute_max','باسن بزرگ','glutes','emphasis'],['glute_med','باسن میانی','glutes','emphasis']]}
];
const all=groups.flatMap(g=>g.items.map(x=>({id:x[0],label:x[1],map:x[2],kind:x[3],cat:g.cat})));
const host=document.querySelector('main.wrap .layout');
if(!host||!window.state||typeof selectedMap!=='function'||typeof draw!=='function')return;
const box=document.createElement('section');box.className='quick-groups';box.innerHTML='<div class="quick-head"><h2>انتخاب سریع عضلات</h2><span class="badge">۲۷ هدف تمرینی</span></div><p class="quick-sub">یک هدف را لمس کن تا ناحیه متناظرِ موجود در مدل رنگی شود. موارد تأکیدی، تفکیک هندسی مستقل محسوب نمی‌شوند.</p><div class="quick-role"><button type="button" data-qrole="primary" class="active">عضله اصلی</button><button type="button" data-qrole="secondary">عضله کمکی</button></div><input class="quick-search" type="search" placeholder="جست‌وجوی نام عضله…" aria-label="جست‌وجوی عضله"><nav class="quick-cats" aria-label="دسته‌بندی عضلات"></nav><div class="quick-grid"></div><div class="quick-status" role="status">برای شروع، یک گروه عضلانی را انتخاب کن.</div>';
host.parentNode.insertBefore(box,host);
const nav=box.querySelector('.quick-cats'),grid=box.querySelector('.quick-grid'),status=box.querySelector('.quick-status'),search=box.querySelector('.quick-search');
let catalog=null,activeCat='همه',activeId=null,activeKeys=[],activeCombo=null,role='primary';
const cats=['همه',...groups.map(g=>g.cat)];
nav.innerHTML=cats.map(c=>'<button class="quick-cat" type="button" data-cat="'+c+'" aria-pressed="'+(c==='همه')+'">'+c+'</button>').join('');
const combo=()=>state.sex+'-'+state.view;
const clearQuick=()=>{const map=activeCombo&&state.selectedByMap[activeCombo];if(map)activeKeys.forEach(k=>delete map[k]);activeKeys=[];activeCombo=null;};
function render(){const q=search.value.trim().toLocaleLowerCase();const rows=all.filter(x=>(activeCat==='همه'||x.cat===activeCat)&&(!q||x.label.toLocaleLowerCase().includes(q)||x.cat.toLocaleLowerCase().includes(q)));grid.innerHTML=rows.map(x=>'<button type="button" class="quick-muscle" data-id="'+x.id+'" data-kind="'+x.kind+'" aria-pressed="'+(x.id===activeId)+'"><span>'+x.label+'</span><span class="qmark">'+(x.kind==='missing'?'بدون مش':x.kind==='emphasis'?'تأکید تمرینی':x.kind==='region'?'ناحیه ترکیبی':'گروه کلی')+'</span></button>').join('');grid.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.id)));}
function select(id){if(!catalog)return;const item=all.find(x=>x.id===id);if(!item)return;if(activeId===id){clearQuick();activeId=null;status.textContent='انتخاب سریع پاک شد؛ انتخاب‌های دستی دیگر حفظ شدند.';render();draw();return;}clearQuick();activeId=id;activeCombo=combo();const map=selectedMap();if(item.map){const ids=Array.isArray(item.map)?item.map:[item.map];const available=ids.flatMap(gid=>{const g=catalog.groups.find(x=>x.group_id===gid);return (g?.geometry_by_view?.[combo()]||[]).map(p=>p.selection_key).filter(Boolean)});activeKeys=[...new Set(available)];activeKeys.forEach(k=>map[k]=role);}
let message='';if(item.kind==='missing')message='برای این هدف، هندسه مستقل در مدل فعلی موجود نیست؛ فقط به‌عنوان هدف تمرینی ثبت نمایشی شده است.';else if(!activeKeys.length)message='این گروه در نمای فعلی هندسه قابل نمایش ندارد؛ نمای دیگر بدن را انتخاب کن.';else if(item.kind==='emphasis')message='این مورد تأکید تمرینی است؛ فعلاً کل گروه مادر رنگی می‌شود، نه سر یا بخش مستقل.';else if(item.kind==='region')message='میانه پشت یک ناحیه ترکیبی است؛ نمایش چند گروه موجود صرفاً راهنمای کلی است، نه مرزبندی یک عضله مستقل.';else message='گروه کلی انتخاب شد. هندسه‌های موجود هنوز بازبینی تخصصی آناتومیک نشده‌اند.';
status.textContent=message;render();draw();}
nav.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{activeCat=b.dataset.cat;nav.querySelectorAll('[data-cat]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render()}));
search.addEventListener('input',render);
box.querySelectorAll('[data-qrole]').forEach(b=>b.addEventListener('click',()=>{role=b.dataset.qrole;box.querySelectorAll('[data-qrole]').forEach(x=>x.classList.toggle('active',x===b));if(activeKeys.length&&activeCombo===combo()){const m=selectedMap();activeKeys.forEach(k=>m[k]=role);draw();}}));\n['sex','view'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{activeId=null;activeKeys=[];activeCombo=null;render();status.textContent='نمای بدن تغییر کرد؛ برای رنگ‌آمیزی در این نما یک هدف را دوباره انتخاب کن.';}));
const originalDraw=draw;window.draw=function(){originalDraw();render()};
fetch(catalogUrl).then(r=>{if(!r.ok)throw new Error('catalog HTTP '+r.status);return r.json()}).then(data=>{catalog=data;render();}).catch(()=>{status.textContent='کاتالوگ عضلات بارگذاری نشد؛ نقشه اصلی بدون تغییر باقی ماند.';});
})();