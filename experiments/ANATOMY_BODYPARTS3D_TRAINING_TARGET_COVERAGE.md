# Targeted muscle coverage — BodyParts3D 4.0

**Audit type:** manifest metadata only; not a mesh geometry or anatomical validation.

Source: `ashemag/human-atlas`, `public/models/atlas.json`, blob `0f81b5621479a0c0548f4683c316f33bd4d6545b`. Dataset BodyParts3D 4.0, CC BY 4.0. Reference anatomy: adult male.

| هدف | نتیجه در manifest | توضیح |
|---|---|---|
| سینه بزرگ (`pectoralis major`) | نامزد پیدا شد؛ 6 مش | zone of pectoralis major؛ clavicular part of pectoralis major؛ clavicular part of right pectoralis major |
| سینه کوچک (`pectoralis minor`) | نامزد پیدا شد؛ 2 مش | pectoralis minor؛ right pectoralis minor؛ left pectoralis minor |
| دلتوئید (`deltoid`) | نامزد پیدا شد؛ 6 مش | zone of deltoid؛ clavicular part of deltoid؛ acromial part of deltoid |
| دوسر بازویی (`biceps brachii`) | نامزد پیدا شد؛ 4 مش | short head of biceps brachii؛ long head of biceps brachii؛ short head of right biceps brachii |
| سه‌سر بازویی (`triceps brachii`) | نامزد پیدا شد؛ 6 مش | long head of triceps brachii؛ medial head of triceps brachii؛ lateral head of triceps brachii |
| ذوزنقه‌ای (`trapezius`) | نامزد پیدا شد؛ 6 مش | zone of trapezius؛ ascending part of trapezius؛ transverse part of trapezius |
| لوزی بزرگ (`rhomboid major`) | نامزد پیدا شد؛ 2 مش | rhomboid major؛ right rhomboid major؛ left rhomboid major |
| لوزی کوچک (`rhomboid minor`) | نامزد پیدا شد؛ 2 مش | rhomboid minor؛ right rhomboid minor؛ left rhomboid minor |
| دندانه‌ای قدامی (`serratus anterior`) | نامزد پیدا شد؛ 2 مش | serratus anterior؛ right serratus anterior؛ left serratus anterior |
| مایل خارجی شکم (`external oblique`) | نامزد پیدا شد؛ 2 مش | external oblique؛ right external oblique؛ left external oblique |
| راست شکمی (`rectus abdominis`) | با این نام پیدا نشد | نیازمند بررسی مترادف‌ها و شناسه‌های FMA |
| پشتی بزرگ (`latissimus dorsi`) | با این نام پیدا نشد | نیازمند بررسی مترادف‌ها و شناسه‌های FMA |
| سرینی بزرگ (`gluteus maximus`) | نامزد پیدا شد؛ 2 مش | gluteus maximus؛ right gluteus maximus؛ left gluteus maximus |
| سرینی میانی (`gluteus medius`) | نامزد پیدا شد؛ 2 مش | gluteus medius؛ right gluteus medius؛ left gluteus medius |
| سرینی کوچک (`gluteus minimus`) | نامزد پیدا شد؛ 2 مش | gluteus minimus؛ right gluteus minimus؛ left gluteus minimus |
| راست رانی (`rectus femoris`) | نامزد پیدا شد؛ 2 مش | rectus femoris؛ right rectus femoris؛ left rectus femoris |
| پهن خارجی (`vastus lateralis`) | نامزد پیدا شد؛ 2 مش | vastus lateralis؛ right vastus lateralis؛ left vastus lateralis |
| پهن میانی (`vastus medialis`) | نامزد پیدا شد؛ 2 مش | vastus medialis؛ right vastus medialis؛ left vastus medialis |
| پهن میانی عمقی (`vastus intermedius`) | نامزد پیدا شد؛ 2 مش | vastus intermedius؛ right vastus intermedius؛ left vastus intermedius |
| دوسر رانی (`biceps femoris`) | نامزد پیدا شد؛ 4 مش | head of biceps femoris؛ long head of biceps femoris؛ long head of right biceps femoris |
| نیم‌وتری (`semitendinosus`) | نامزد پیدا شد؛ 2 مش | semitendinosus؛ right semitendinosus؛ left semitendinosus |
| نیم‌غشایی (`semimembranosus`) | نامزد پیدا شد؛ 2 مش | semimembranosus؛ right semimembranosus؛ left semimembranosus |
| دوقلو ساق (`gastrocnemius`) | نامزد پیدا شد؛ 4 مش | head of gastrocnemius؛ medial head of gastrocnemius؛ medial head of right gastrocnemius |
| نعلی (`soleus`) | نامزد پیدا شد؛ 2 مش | soleus؛ right soleus؛ left soleus |
| درشت‌نی قدامی (`tibialis anterior`) | نامزد پیدا شد؛ 2 مش | tibialis anterior؛ right tibialis anterior؛ left tibialis anterior |

## نکات مهم
- در شمارش، عناصر شریانی/وریدی که صرفاً نامی مانند «شاخه دلتوئیدی» دارند از عضلات حذف شده‌اند.
- سینه بزرگ به قطعات ناحیه‌ای clavicular، sternocostal و abdominal تقسیم شده؛ برای هر سمت چند مش باید کنار هم قرار گیرند.
- دلتوئید سه بخش، سه‌سر بازویی سه سر و دوسر بازویی دو سر دارد؛ پس یک هدف تمرینی ممکن است چند مش مستقل داشته باشد.
- `latissimus dorsi` و `rectus abdominis` با جست‌وجوی نام در فهرست مفاهیم پیدا نشدند. این اثبات قطعی نبودن ساختار نیست؛ باید مترادف‌ها و شناسه‌های FMA نیز بررسی شوند.
- بعضی عضلات ممکن است در ستون `system` با برچسبی غیر از `muscular` آمده باشند؛ بنابراین این ستون به‌تنهایی معیار حذف عضله نیست.
- هیچ موردی هنوز `verified_geometry` نیست. موارد پیدا‌شده فقط نامزدهای فراداده‌ای‌اند.
- مدل منبع مردانه است و برای بدن زن استفاده نمی‌شود.

## مرحله بعدی فنی
فهرست عناصر نامزد در فایل JSON همراه آمده است. شناسه chunk برای هر مش ثبت شده تا فقط chunkهای موردنیاز دریافت شوند. تا وقتی بایت‌های chunk دریافت و با offsets موجود در manifest decode و در مرورگر نمایش داده نشوند، صحت هندسه تأییدشده محسوب نمی‌شود.

انتساب منبع در هر بازتوزیع: **BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.**
