# طبقه‌بندی تخصصی عضلات پشت برای آناتومی هوشمند
نسخه: 1.0.0
تاریخ: 2026-11-28
شاخه: experiment/anatomy-smart-rebuild-20261127
وضعیت: سند طراحی داده و نام‌گذاری؛ بدون تغییر هندسه یا رابط

## 1) هدف
این سند ساختار علمی عضلات پشت را برای توسعه تدریجی کاتالوگ فیتنس سه‌قلعه مشخص می‌کند. بین سه مفهوم تفاوت می‌گذاریم:
1. عضله آناتومیک واقعی (anatomy entity)
2. بخش یا ناحیه آموزشی/عملکردی (region)
3. مسیر قابل انتخاب در تصویر (geometry path)

وجود یک anatomy entity در این سند به معنی وجود هندسه آماده یا قابل انتخاب در پیش‌نمایش نیست.

## 2) ساختار پیشنهادی عضلات پشت

### A. عضلات سطحی/خارجی پشت و کنترل کمربند شانه‌ای
| شناسه پیشنهادی آینده | نام فارسی | نام لاتین | وضعیت نسبت به کاتالوگ فعلی |
|---|---|---|---|
| trapezius | ذوزنقه‌ای (کول) | Trapezius | موجود؛ هندسه پشت نیازمند ممیزی |
| trapezius_upper | بخش فوقانی ذوزنقه‌ای | Upper/descending fibers of trapezius | فقط ناحیه آموزشی آینده؛ مسیر مستقل اثبات نشده |
| trapezius_middle | بخش میانی ذوزنقه‌ای | Middle/transverse fibers of trapezius | فقط ناحیه آموزشی آینده؛ مسیر مستقل اثبات نشده |
| trapezius_lower | بخش تحتانی ذوزنقه‌ای | Lower/ascending fibers of trapezius | فقط ناحیه آموزشی آینده؛ مسیر مستقل اثبات نشده |
| latissimus_dorsi | پشتی بزرگ (زیر بغل) | Latissimus dorsi | موجود؛ هندسه هنوز بازبینی نشده |
| rhomboid_minor | لوزی کوچک | Rhomboid minor | فعلاً در گروه rhomboids ادغام شده؛ مسیر مستقل اثبات نشده |
| rhomboid_major | لوزی بزرگ | Rhomboid major | فعلاً در گروه rhomboids ادغام شده؛ مسیر مستقل اثبات نشده |
| levator_scapulae | بالابرنده کتف | Levator scapulae | در پیش‌نمایش فعلی گروه مستقل ندارد |
| teres_major | گرد بزرگ | Teres major | در پیش‌نمایش فعلی گروه مستقل ندارد |

### B. عضلات عمقی/ذاتی پشت
| شناسه پیشنهادی آینده | نام فارسی | نام لاتین | وضعیت |
|---|---|---|---|
| erector_spinae | راست‌کننده ستون مهره‌ها | Erector spinae | گروه عضلانی؛ با مسیر فعلی پایین کمر یکی فرض نشود |
| iliocostalis | خاصره‌ای‌دنده‌ای | Iliocostalis | عضو گروه راست‌کننده‌ها؛ هندسه مستقل لازم است |
| longissimus | طویل‌ترین | Longissimus | عضو گروه راست‌کننده‌ها؛ هندسه مستقل لازم است |
| spinalis | خاری | Spinalis | عضو گروه راست‌کننده‌ها؛ هندسه مستقل لازم است |
| multifidus | چندپاره | Multifidus | عمقی؛ در پیش‌نمایش فعلی موجود نیست |
| rotatores | چرخاننده‌ها | Rotatores | عمقی؛ در پیش‌نمایش فعلی موجود نیست |
| quadratus_lumborum | مربع کمری | Quadratus lumborum | عضله دیواره خلفی شکم؛ با erector spinae یکی نیست |

### C. عضلات کمربند شانه‌ای که در نمای پشت مهم‌اند
این گروه‌ها باید در taxonomy جامع دیده شوند، اما نباید به‌اشتباه جزو «عضلات پشت» واحد دسته‌بندی شوند:
- دلتوئید خلفی (Posterior deltoid): عضله شانه؛ در کاتالوگ فعلی موجود است.
- زیرخاری (Infraspinatus)، فوق‌خاری (Supraspinatus)، گرد کوچک (Teres minor)، زیرکتفی (Subscapularis): عضلات روتاتورکاف؛ در نمای پشت/جلو بسته به موقعیت دیده می‌شوند و در حال حاضر مسیرهای مستقلشان در پیش‌نمایش تأیید نشده.
- گرد بزرگ (Teres major): عضله کتف‌ـ‌بازو؛ از نظر مجاورت در نمای پشت دیده می‌شود، اما روتاتورکاف نیست.

## 3) قواعد نام‌گذاری و تفکیک
1. Trapezius یک عضله است که برای آموزش عملکردی می‌توان آن را به الیاف فوقانی، میانی و تحتانی تقسیم کرد. این سه عنوان نباید به‌عنوان سه عضله مستقل معرفی شوند.
2. Rhomboid major و Rhomboid minor دو عضله جدا هستند. گروه فعلی `rhomboids` فقط یک ناحیه گروهی است؛ تا وقتی مش مستقل و معتبر نداریم، انتخاب جداگانه بزرگ/کوچک ممنوع است.
3. Erector spinae یک گروه طولی شامل iliocostalis، longissimus و spinalis است. برچسب فعلی `back_lower` به‌تنهایی برای انتساب به کل گروه کافی نیست.
4. Latissimus dorsi یک عضله سطحی بزرگ است؛ «زیر بغل» فقط مترادف رایج آن است و نباید به‌عنوان anatomy entity دوم ساخته شود.
5. Levator scapulae، rhomboids و latissimus dorsi در لایه‌ها و روابط عمقی متفاوت قرار دارند. ترتیب نمایش باید بر اساس هندسه/occlusion واقعی باشد، نه صرفاً ترتیب فهرست.
6. هیچ تقسیم‌بندی بر اساس محل ظاهری مسیر SVG یا حدس از نام ID انجام نشود.

## 4) نگاشت موقت به گروه‌های فعلی کاتالوگ
| گروه فعلی | نگاشت مجاز فعلی | نگاشت غیرمجاز تا زمان هندسه معتبر |
|---|---|---|
| trapezius | Trapezius (یک عضله در هر سمت؛ چند path احتمالی باید ممیزی شوند) | upper/middle/lower به‌صورت سه انتخاب مستقل |
| rhomboids | Rhomboid muscle group | major و minor به‌صورت مستقل |
| lats | Latissimus dorsi | teres major یا سایر عضلات پشت |
| back_lower | ناحیه پایین کمر با انتساب آناتومیک در انتظار | کل erector spinae یا iliocostalis/longissimus/spinalis |
| shoulders_rear | Posterior deltoid | infraspinatus یا teres minor |
| هیچ گروه فعلی | — | levator scapulae، multifidus، quadratus lumborum و روتاتورکاف به‌عنوان مسیرهای انتخابی |

## 5) اولویت ممیزی بصری پیش‌نمایش
### P0 — Trapezius در نمای پشت
- در هر مدل (آقا/خانم) چهار path ثبت شده: دو path با شناسه LEFT و دو path با شناسه RIGHT.
- ابتدا باید pathها روی تصویر اصلی با شماره index و رنگ موقت متفاوت نشان داده شوند.
- سپس مشخص شود هر path کدام ناحیه را می‌پوشاند و آیا دو path هر سمت واقعاً اجزای پیوسته یک عضله‌اند یا خیر.
- تا پایان این ممیزی، انتخاب جفتی و تقسیم سه‌گانه کول مسدود بماند.

### P1 — Rhomboids
- یک path چپ و یک path راست در نمای پشت ثبت شده.
- بررسی شود که شکل، ناحیه لوزی بزرگ و کوچک را یکجا پوشانده یا فقط یک ناحیه عمومی را نشان می‌دهد.
- حتی اگر شکل کلی با ناحیه لوزی‌ها هم‌خوان بود، تفکیک major/minor بدون هندسه مستقل ممنوع است.

### P2 — Latissimus dorsi
- یک path چپ و یک path راست در نمای پشت ثبت شده.
- مرز زیر بغل/پشت پهلو با teres major و عضلات مجاور بررسی شود.
- فقط پس از تطبیق با اطلس معتبر می‌توان وضعیت مسیر را از unreviewed به reviewed تغییر داد.

### P3 — Back lower
- یک path چپ و یک path راست ثبت شده.
- محل آن نسبت به ستون مهره‌ها، ستیغ خاصره، فاسیای توراکولومبار و عضلات سطحی بررسی شود.
- تا آن زمان نام نمایشی امن‌تر «ناحیه پایین کمر» است، نه انتساب قطعی به Lumbar erector spinae.

## 6) مدل داده پیشنهادی برای مراحل بعد
هر anatomy entity باید این فیلدها را داشته باشد:
- `anatomy_id`: شناسه پایدار و یکتا
- `name_fa`, `name_latin`
- `aliases_fa[]`, `aliases_latin[]`
- `parent_group_id`: گروه مادر در صورت وجود
- `region_type`: muscle | muscle_group | functional_region | muscle_part
- `layer`: superficial | intermediate | deep | unknown
- `side`: left | right | midline | paired
- `geometry_status`: absent | candidate | mapped_unreviewed | reviewed
- `geometry_refs[]`: فقط شناسه‌های واقعی و ممیزی‌شده مسیر/مش
- `source_refs[]`: منبع علمی و نسخه داده هندسی
- `exercise_mapping_status`: not_connected | candidate | reviewed

## 7) دروازه‌های پذیرش
هیچ عضله/بخشی در رابط قابل انتخاب مستقل نمی‌شود مگر اینکه:
1. هندسه مستقل واقعی یا مرز انتخابی معتبر موجود باشد.
2. سمت چپ/راست و نمای بدن بررسی شده باشد.
3. هم‌پوشانی با عضلات مجاور و ترتیب عمقی مشخص باشد.
4. نام فارسی و لاتین با anatomy entity منطبق باشد.
5. یک بازبینی بصری واقعی در موبایل و دسکتاپ ثبت شده باشد.
6. منبع و مجوز فایل هندسی ثبت شده باشد.

## 8) منابع علمی برای تعریف taxonomy
- StatPearls, Anatomy, Back, Trapezius: https://www.ncbi.nlm.nih.gov/books/NBK518994/
- StatPearls, Anatomy, Back, Extrinsic Muscles: https://www.ncbi.nlm.nih.gov/books/NBK537216/
- StatPearls, Anatomy, Back, Rhomboid Muscles: https://www.ncbi.nlm.nih.gov/books/NBK534856/
- StatPearls, Anatomy, Shoulder and Upper Limb, Muscles: https://www.ncbi.nlm.nih.gov/books/NBK482410/

این منابع برای طبقه‌بندی و نام‌گذاری استفاده شده‌اند، نه به‌عنوان مجوز کپی تصاویر یا متن آن‌ها در محصول. برای محصول تجاری، فقط داده/هندسه‌ای استفاده شود که مجوز آن جداگانه بررسی شده باشد.
