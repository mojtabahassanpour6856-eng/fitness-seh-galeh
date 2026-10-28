#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'index.html');
const marker = '// FITNESS_SEH_GALEH_PREBUILT_MEAL_RECIPES_V1';
const html = fs.readFileSync(file, 'utf8');

if (html.includes(marker)) {
  console.log('Meal recipe bank already seeded; no changes made.');
  process.exit(0);
}

const start = html.search(/const\s+MEAL_RECIPES\s*=\s*\[/);
if (start < 0) throw new Error('Could not locate the existing MEAL_RECIPES array; refusing to edit index.html.');

const end = html.indexOf('];', start);
if (end < 0) throw new Error('Could not locate the end of MEAL_RECIPES; refusing to edit index.html.');

const recipes = [
  // Breakfast — coach-only selection labels; output continues to render ingredient rows.
  {name:'دستور ۱ (نان + پنیر + گردو + خیار)',category:'breakfast',ingredients:[['نان',80,'گرم'],['پنیر',30,'گرم'],['گردو',15,'گرم'],['خیار',100,'گرم']]},
  {name:'دستور ۲ (نان + پنیر + سبزی + گوجه + خیار)',category:'breakfast',ingredients:[['نان',80,'گرم'],['پنیر',30,'گرم'],['سبزی خوردن',30,'گرم'],['گوجه‌فرنگی',100,'گرم'],['خیار',100,'گرم']]},
  {name:'دستور ۳ (تخم‌مرغ آب‌پز + نان + خیار + گوجه)',category:'breakfast',ingredients:[['تخم‌مرغ آب‌پز',2,'عدد'],['نان',80,'گرم'],['خیار',100,'گرم'],['گوجه‌فرنگی',100,'گرم']]},
  {name:'دستور ۴ (املت گوجه‌فرنگی)',category:'breakfast',ingredients:[['تخم‌مرغ',2,'عدد'],['گوجه‌فرنگی',150,'گرم'],['نان',80,'گرم'],['روغن زیتون',5,'گرم']]},
  {name:'دستور ۵ (جو دوسر + شیر + موز)',category:'breakfast',ingredients:[['جو دوسر',40,'گرم'],['شیر',250,'میلی‌لیتر'],['موز',100,'گرم'],['دارچین',1,'گرم']]},

  // Lunch
  {name:'دستور ۱ (برنج + مرغ + سالاد)',category:'lunch',ingredients:[['برنج پخته',200,'گرم'],['سینه مرغ',150,'گرم'],['سالاد فصل',150,'گرم']]},
  {name:'دستور ۲ (عدس‌پلو + ماست + سالاد + روغن زیتون)',category:'lunch',ingredients:[['برنج پخته',200,'گرم'],['عدس پخته',100,'گرم'],['ماست',150,'گرم'],['سالاد فصل',150,'گرم'],['روغن زیتون',5,'گرم']]},
  {name:'دستور ۳ (شویدپلو + ماهی + خرما + سالاد)',category:'lunch',ingredients:[['برنج پخته',200,'گرم'],['شوید',25,'گرم'],['ماهی',180,'گرم'],['خرما',2,'عدد'],['سالاد فصل',150,'گرم']]},
  {name:'دستور ۴ (سیب‌زمینی + گوشت + سبزیجات)',category:'lunch',ingredients:[['سیب‌زمینی آب‌پز',250,'گرم'],['گوشت گوساله کم‌چرب',150,'گرم'],['سبزیجات پخته',150,'گرم'],['سالاد فصل',100,'گرم']]},
  {name:'دستور ۵ (لوبیاپلو)',category:'lunch',ingredients:[['برنج پخته',200,'گرم'],['لوبیا سبز',100,'گرم'],['گوشت چرخ‌کرده کم‌چرب',120,'گرم'],['گوجه‌فرنگی',100,'گرم'],['سالاد فصل',100,'گرم']]},

  // Dinner
  {name:'دستور ۱ (سالاد الویه خانگی)',category:'dinner',ingredients:[['تخم‌مرغ آب‌پز',1,'عدد'],['سیب‌زمینی آب‌پز',150,'گرم'],['سینه مرغ',100,'گرم'],['سبزیجات',100,'گرم']] ,note:'خیارشور اختیاری است و می‌توان آن را هنگام تنظیم وعده اضافه کرد.'},
  {name:'دستور ۲ (مرغ + سبزیجات)',category:'dinner',ingredients:[['سینه مرغ',150,'گرم'],['کدو سبز',100,'گرم'],['هویج',80,'گرم'],['فلفل دلمه‌ای',80,'گرم'],['نان',50,'گرم']]},
  {name:'دستور ۳ (املت قارچ)',category:'dinner',ingredients:[['تخم‌مرغ',2,'عدد'],['قارچ',100,'گرم'],['گوجه‌فرنگی',150,'گرم'],['نان',60,'گرم']]},

  // Snacks
  {name:'میان‌وعده ۱ (ماست + میوه)',category:'snack',ingredients:[['ماست',150,'گرم'],['سیب',150,'گرم'],['دارچین',1,'گرم']]},
  {name:'میان‌وعده ۲ (شیر + مغزها + میوه)',category:'snack',ingredients:[['شیر',200,'میلی‌لیتر'],['بادام',15,'گرم'],['موز',100,'گرم']]},
  {name:'شیک کاهش وزن ۱',category:'snack',ingredients:[['شیر کم‌چرب',250,'میلی‌لیتر'],['ماست یونانی کم‌چرب',150,'گرم'],['توت‌فرنگی',100,'گرم'],['جو دوسر',20,'گرم'],['دارچین',1,'گرم']]},

  // Pre- and post-workout
  {name:'قبل تمرین ۱ (نان + موز)',category:'preworkout',ingredients:[['نان',60,'گرم'],['موز',100,'گرم']]},
  {name:'بعد تمرین ۱ (مرغ + سیب‌زمینی)',category:'postworkout',ingredients:[['سینه مرغ',150,'گرم'],['سیب‌زمینی آب‌پز',200,'گرم'],['سبزیجات',100,'گرم']]},
  {name:'معجون حجم ۱',category:'postworkout',ingredients:[['شیر',300,'میلی‌لیتر'],['کره بادام‌زمینی',20,'گرم'],['جو دوسر',50,'گرم'],['موز',100,'گرم'],['برگه زردآلو',20,'گرم'],['کنجد',5,'گرم'],['خرما',2,'عدد'],['سریلاک',30,'گرم']]},
  {name:'معجون حجم ۲',category:'postworkout',ingredients:[['شیر',300,'میلی‌لیتر'],['جو دوسر',60,'گرم'],['موز',100,'گرم'],['ماست یونانی',150,'گرم'],['کره بادام‌زمینی',15,'گرم'],['عسل',10,'گرم'],['گردو',10,'گرم']]},

  // Before bed
  {name:'شیک کاهش وزن ۲',category:'bedtime',ingredients:[['شیر کم‌چرب',200,'میلی‌لیتر'],['ماست یونانی کم‌چرب',200,'گرم'],['موز',50,'گرم'],['پودر کاکائوی بدون شکر',5,'گرم'],['جو دوسر',15,'گرم'],['یخ',50,'گرم']]}
];

const serialized = recipes.map(r => '  '+JSON.stringify(r)).join(',\n');
const insertion = '\n  '+marker+'\n'+serialized+',\n';
const updated = html.slice(0, end) + insertion + html.slice(end);
fs.writeFileSync(file, updated, 'utf8');
console.log('Added '+recipes.length+' coach-side meal recipes to the existing MEAL_RECIPES bank.');
