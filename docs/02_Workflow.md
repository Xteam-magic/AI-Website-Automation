عالی، از این قسمت به بعد وارد قلب Workflow می‌شویم. از اینجا به بعد تقریباً تمام منطق اجرایی پروژه مشخص می‌شود.

---

# مستند پروژه AI Website Automation V1

# بخش دوم

## مرحله Generate، Mobile، Export، Figma، Elementor، Email، Logging

---

# شروع طراحی صفحه

پس از اینکه تمام Context پروژه وارد شد (Design System، Website، تصاویر، لوگو و Prompt)، سیستم باید روی دکمه **Send / Generate** کلیک کند.

پس از کلیک:

```
Status

↓

Generating Design
```

بلافاصله در Google Sheet نیز مقدار Status به:

```
Generating
```

تغییر کند.

همزمان یک ایمیل برای:

* User Email
* [emad_1382@yahoo.com](mailto:emad_1382@yahoo.com)

ارسال شود.

موضوع:

```
شروع طراحی صفحه

Project :
...

Page :
...

Estimated Time :
...
```

---

# انتظار برای پایان Generate

پس از ارسال Prompt، هیچ کلیک دیگری انجام نشود.

فقط منتظر بماند.

معیار پایان Generate یکی از موارد زیر است:

* دکمه Generate دوباره فعال شود.
* Preview صفحه ایجاد شود.
* گزینه‌های Copy / Export نمایش داده شوند.
* Spinner حذف شود.

هر کدام زودتر اتفاق افتاد یعنی طراحی تمام شده است.

Timeout:

```
High

10 دقیقه

Medium

7 دقیقه

Low

4 دقیقه
```

اگر Timeout شد:

```
Retry Generate

فقط یکبار
```

اگر باز هم شکست خورد:

```
Status

↓

Generate Error
```

Screenshot گرفته شود.

ایمیل ارسال شود.

Workflow متوقف گردد.

---

# Mobile Version

اگر ستون جدید

```
Mobile Version

=

Yes
```

باشد.

پس از پایان طراحی Desktop:

روی خود صفحه طراحی کلیک شود.

↓

Generate

↓

Generate Mobile Version

↓

منتظر پایان طراحی بماند.

دوباره همان قوانین Timeout اجرا شوند.

اگر Mobile شکست خورد:

Desktop حذف نشود.

Status پروژه:

```
Desktop Finished
Mobile Failed
```

ثبت گردد.

---

# Export HTML

پس از پایان Desktop (و Mobile در صورت نیاز)

روی صفحه طراحی کلیک شود.

↓

Copy / Export

↓

Copy as HTML

کلیک شود.

سیستم باید منتظر بماند تا Clipboard پر شود.

در صورت خالی بودن Clipboard

حداکثر

۳

بار تلاش مجدد انجام شود.

پس از دریافت HTML

ستون

```
HTML,CSS File
```

در همان ردیف Google Sheet

آپدیت شود.

---

# انتقال به Figma

اگر

```
Figma Needed = Yes
```

باشد.

پس از Copy HTML

دوباره

```
Copy / Export
```

↓

Copy to Figma

کلیک شود.

اکنون هیچ کاری انجام نشود.

فقط منتظر پیام سبز رنگ زیر بماند.

```
Design copied!

Paste in Figma
```

پس از مشاهده این پیام

آدرس زیر باز شود.

```
https://www.figma.com/design/NLkFc0NtOqUnR9Fh6madRL/ENGAR-KE
```

---

# Paste داخل Figma

سیستم وارد صفحه Design شود.

به اولین فضای خالی Canvas برود.

Paste انجام شود.

پس از Paste

Frame جدید ایجاد خواهد شد.

نام Frame به صورت زیر تغییر کند.

```
Project Name

-

Page Name
```

مثال

```
ENGAR

Home

```

یا

```
ENGAR

Pricing
```

اگر پروژه چند صفحه داشت

همه Frame ها پشت سر هم با فاصله مناسب قرار بگیرند.

---

# Elementor

اگر

```
Client Dev Method

=

Elementor
```

باشد.

پس از ذخیره HTML

مرورگر وارد شود.

```
https://web2elementor.com/html-to-elementor/
```

---

# تبدیل HTML

کد HTML داخل

Paste your HTML

قرار گیرد.

↓

Convert

↓

منتظر پایان تبدیل بماند.

حدود

۱ دقیقه

↓

Export to Elementor

↓

دانلود فایل JSON

---

# ذخیره JSON

پس از دانلود

فایل JSON

در مسیر

```
downloads/

project-name/

page-name/
```

ذخیره شود.

همچنین محتوای فایل یا لینک فایل (بسته به روش پیاده‌سازی)

داخل ستون

```
JSON File
```

ثبت گردد.

---

# ارسال ایمیل نهایی

پس از پایان هر صفحه

به ایمیل کاربر

فایل‌های زیر ارسال شوند.

در صورت وجود:

✅ HTML

✅ JSON

موضوع ایمیل

```
طراحی صفحه تکمیل شد
```

متن

```
سلام

صفحه

Home

پروژه

ENGAR

با موفقیت طراحی شد.

فایل های مربوطه ضمیمه شده اند.

در صورت چند صفحه بودن پروژه، صفحات بعدی نیز به ترتیب تولید خواهند شد.

با تشکر
```

همین ایمیل

برای

```
emad_1382@yahoo.com
```

نیز ارسال شود.

---

# پایان یک صفحه

اگر هنوز صفحات دیگری باقی مانده باشند.

Loop

از ابتدا اجرا شود.

صفحه بعد

↓

Generate

↓

Export

↓

Figma

↓

Elementor

↓

Email

↓

Next Page

---

# پایان پروژه

اگر آخرین صفحه نیز تمام شد.

Google Sheet

```
Status

↓

Completed
```

همچنین ستون

```
Design URL
```

در صورت وجود لینک نهایی پروژه UXPilot یا Figma، با همان لینک به‌روزرسانی شود تا دسترسی به خروجی سریع باشد.

---

# Edit After Design

در شروع هر اجرای Scheduler، قبل از بررسی پروژه‌های جدید، سیستم باید پروژه‌هایی را بررسی کند که:

```
Status = Completed
```

و

```
Edits After Design

خالی نیست.
```

اگر چنین پروژه‌ای وجود داشت:

ابتدا همین پروژه در اولویت اجرا شود.

---

# ورود به پروژه قبلی

سیستم وارد

```
https://uxpilot.ai/a/ui-list
```

شود.

بر اساس

Project Name

پروژه را پیدا کند.

باز کند.

---

# اجرای Edit

از متن ستون

```
Edits After Design
```

مشخص شود.

کدام صفحه نیاز به ویرایش دارد.

مثلاً

```
Home

Improve Hero

Change CTA

Better spacing

```

سیستم صفحه Home را باز کند.

تمام متن Edit

همراه با

Full Project Doc

به Prompt اضافه شود.

و دوباره Generate اجرا گردد.

---

# پس از Edit

تمام مراحل قبلی دوباره اجرا شوند.

یعنی

Generate

↓

Mobile

↓

HTML

↓

Figma

↓

Elementor

↓

Email

↓

Sheet Update

---

# پاک کردن Edit

پس از پایان موفق Edit

ستون

```
Edits After Design
```

کاملاً خالی شود.

Status

دوباره

```
Completed
```

شود.

---

# سیستم Email

در سه نقطه همیشه ایمیل ارسال شود.

### شروع پروژه

```
شروع پروژه

زمان تقریبی

تعداد صفحات

مرحله فعلی
```

---

### شروع هر صفحه

```
شروع طراحی صفحه

Home

2 از 5
```

---

### پایان هر صفحه

```
صفحه طراحی شد.

مرحله بعد:

Elementor

یا

Page 3
```

---

### پایان پروژه

```
تمام پروژه تکمیل شد.

تمام فایل ها آماده هستند.
```

---

### خطا

در صورت هرگونه خطا

موضوع

```
Project Failed
```

متن

```
Project

...

Step

...

Error

...

Last URL

...

Time

...

```

ضمیمه:

* آخرین Screenshot
* متن خطا
* نام مرحله

---

# Logging

در GitHub Actions، لاگ‌ها باید کوتاه، خوانا و مرحله‌به‌مرحله باشند؛ برای مثال:

```text
[Scheduler] Started
[Sheet] Loading projects...
[Sheet] Project found: ENGAR
[Sheet] Status -> Running

[UXPilot] Login...
[UXPilot] Login successful

[Project] Creating new file...
[Project] Context uploaded

[Generate] Home page started
[Generate] Waiting...
[Generate] Finished (6m 42s)

[Figma] Copied
[Figma] Pasted

[Elementor] Converting...
[Elementor] JSON downloaded

[Email] Sent to user
[Sheet] Updated

[Project] Home completed
```

در صورت خطا:

```text
[ERROR]
Stage : Generate
Reason : Timeout after 10 minutes
Screenshot : artifacts/generate-timeout.png
Action : Workflow stopped
```

---

# قوانین عمومی پروژه

* فقط **یک پروژه** در هر لحظه اجرا شود.
* بعد از پایان هر پروژه، **۱۰ دقیقه** صبر شود و سپس پروژه بعدی بررسی شود.
* تمام اطلاعات فقط از Google Sheet خوانده شود و هر تغییر وضعیت بلافاصله در همان Sheet ثبت گردد.
* اگر مرورگر یا Session از بین رفت، یک بار Login مجدد انجام شود و Workflow از همان مرحله ادامه پیدا کند.
* هر مرحله فقط پس از موفقیت مرحله قبل اجرا شود.
* از کلیک‌های کور (Blind Click) خودداری شود؛ همه اقدامات بر اساس انتظار برای عناصر یا پیام‌های موفقیت انجام شوند.
* در صورت خطا، همیشه آخرین Screenshot، URL، نام مرحله و پیام خطا ثبت و ایمیل شود.

---

این پایان **بخش دوم** است.

در **بخش سوم** وارد بخش کاملاً عملی می‌شویم؛ شامل:

1. ساختار نهایی Repository
2. ساختار پوشه‌ها
3. ترتیب فایل‌های پروژه
4. متغیرهای GitHub Secrets
5. فایل `workflow.yml`
6. ترتیب دقیق ماژول‌ها
7. Prompt نهایی یکپارچه‌ای که مستقیماً به Claude Code یا Codex داده می‌شود تا کل پروژه را تولید کند.
