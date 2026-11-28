# مشخصات تفکیک سه‌ناحیه‌ای عضله سینه بزرگ — نسخه ۲

وضعیت: **تصمیم نام‌گذاری و نگاشت آناتومیک ثبت شده؛ هندسه هنوز استخراج و بازبینی نشده است.**

## تصمیم محصول
در رابط مربی، عضله سینه‌ای بزرگ (Pectoralis major) به سه ناحیه آموزشی/انتخابی برای هر سمت تقسیم می‌شود:

1. بالاسینه
2. سینه میانی
3. زیرسینه

هر ناحیه در چپ و راست شناسه مستقل دارد؛ در مجموع شش ناحیه.

## نگاشت آناتومیک محتاطانه

| برچسب فارسی در اپ | نام ساختار منبع | شناسه پیشنهادی | توضیح و محدودیت |
|---|---|---|---|
| بالاسینه | Clavicular part/head | `PECTORALIS_MAJOR_CLAVICULAR_LEFT/RIGHT` | بخش ترقوه‌ای؛ نگاشت نسبتاً روشن به ناحیه فوقانی |
| سینه میانی | Sternocostal part/head | `PECTORALIS_MAJOR_STERNOCOSTAL_LEFT/RIGHT` | بخش جناغی‌ـ‌دنده‌ای؛ ساختاری گسترده و شامل الیاف با جهت‌های متفاوت است، نه صرفاً یک نوار باریک میانی |
| زیرسینه | Abdominal part | `PECTORALIS_MAJOR_ABDOMINAL_LEFT/RIGHT` | بخش شکمی/الیاف تحتانی؛ با الیاف تحتانی جناغی‌ـ‌دنده‌ای پیوستگی و هم‌پوشانی عملکردی/تاندونی دارد و نباید مرز سطحی آن را بدون بررسی مش قطعی فرض کرد |

## نکته علمی مهم
منابع آناتومی، عضله سینه بزرگ را معمولاً دارای بخش ترقوه‌ای و جناغی‌ـ‌دنده‌ای توصیف می‌کنند؛ برخی منابع بخش شکمی را نیز به‌عنوان قسمت سوم جداگانه می‌آورند. بخش جناغی‌ـ‌دنده‌ای خود می‌تواند چند قطعه/دسته فیبری داشته باشد. بنابراین برچسب «سینه میانی» در اپ نام آموزشیِ ساده‌شده برای بخش جناغی‌ـ‌دنده‌ای است، نه ادعای وجود یک head مستقل با مرز میانی کاملاً ثابت. «زیرسینه» نیز برچسب آموزشی برای بخش شکمی است، نه نام یک عضله مستقل.

منابع مرجع:
- StatPearls / NCBI Bookshelf, Pectoralis Major: https://www.ncbi.nlm.nih.gov/sites/books/NBK525991/
- Complete Anatomy / Elsevier, Pectoralis Major: https://www.elsevier.com/resources/anatomy/muscular-system/muscles-of-upper-limb/pectoralis-major-muscle/18194
- Larionov et al., A Detailed Review on the Clinical Anatomy of the Pectoralis Major Muscle (2018): https://www.jsmcentral.org/article-info/A-Detailed-Review-on-the-Clinical-Anatomy-of-the-Pectoralis-Major-Muscle

## شواهد منبع سه‌بعدی
یک pipeline مشتق‌شده از Z-Anatomy، اشیای منبع را با نام‌های جداگانه زیر فهرست کرده است:
- Clavicular head of pectoralis major muscle.l/r
- Sternocostal head of pectoralis major muscle.l/r
- (Abdominal part of pectoralis major muscle).l/r

این شواهد، نام‌گذاری و وجود نامزدهای مجزای منبع را تقویت می‌کند؛ اما به‌تنهایی ثابت نمی‌کند که فایل محلی ما همان اشیا را دارد، هرکدام Mesh مستقل و سالم هستند، یا مرز قابل‌لمس آن‌ها در نمای روبه‌رو بدون هم‌پوشانی است. تأیید نهایی فقط پس از اجرای اسکریپت export v2 روی فایل منبع pin‌شده و مشاهده GLBهای واقعی انجام می‌شود.

## قرارداد داده
برای هر ناحیه:
- `id`: شناسه پایدار و یکتا، شامل سمت
- `muscle_id`: `PECTORALIS_MAJOR`
- `region_id`: `CLAVICULAR`، `STERNOCOSTAL` یا `ABDOMINAL`
- `side`: `left` یا `right`
- `layer`: `superficial`
- `source_object_name`: نام دقیق شیء در منبع
- `geometry_ref`: مسیر GLB مستقل پس از export موفق
- `geometry_status`: `not_available`، `candidate`، `reviewed` یا `approved`
- `anatomical_basis`، `source_version`، `license` و `review_notes`

## قواعد فعال‌سازی
1. تا پیش از export موفق، هر شش ناحیه فقط «در انتظار هندسه» هستند.
2. پس از export، هر GLB باید جداگانه از نظر نام، تعداد مثلث، bounding box، جهت‌گیری، موقعیت، اتصال به تنه، پیوستگی و تقارن بررسی شود.
3. در نمای روبه‌رو بررسی شود که نواحی روی هم نمی‌افتند یا شکاف غیرواقعی ندارند.
4. چپ و راست با شناسه صریح منبع نگاشت شوند؛ از آینه‌سازی یا جفت‌سازی حدسی برای تولید هندسه استفاده نشود.
5. «سینه میانی» نباید با تقسیم دلخواه مش sternocostal به نوار باریک‌تر تبدیل شود؛ چنین تفکیکی فقط با شواهد هندسی/آناتومیک اضافه می‌شود.
6. سینه‌ای کوچک (Pectoralis minor) عضله‌ای جدا و عمقی است؛ در این سه ناحیه سطحی ادغام نشود و تا زمان کنترل occlusion فقط در لایه عمقی نمایش داده شود.
7. مدل منبع فعلی مردانه است؛ برای نمای زنانه نباید هندسه مردانه را معتبر فرض یا بی‌بررسی mirror/scale کرد.

## محدوده این نسخه
این فایل فقط مشخصات را ثبت می‌کند. هیچ فایل prototype، گالری، بانک حرکات، Main، Supabase یا داده شاگردان تغییر نمی‌کند. این سند به معنی استخراج یا تأیید هندسه نیست.
