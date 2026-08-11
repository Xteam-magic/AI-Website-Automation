عالی، از اینجا به بعد داکیومنت رو دقیقا به شکلی می‌نویسم که آخرش بشه مستقیم به Claude Code یا Codex داد تا پروژه رو بسازه. هیچ توضیح اضافه‌ای نمی‌نویسم و تمرکز فقط روی پیاده‌سازی خواهد بود.

---

# مستند پروژه AI Website Automation V1

> نسخه 1.0
>
> هدف: پیاده‌سازی یک سیستم کاملاً خودکار برای مدیریت پروژه‌های طراحی UI از طریق Google Sheet، UXPilot، Figma و Elementor با استفاده از Github Actions و Playwright.

---

# 1- هدف پروژه

این سیستم باید هر یک ساعت یکبار به صورت خودکار اجرا شود.

تمام اطلاعات پروژه‌ها فقط از Google Sheet خوانده می‌شود.

هیچ دیتابیس دیگری وجود ندارد.

Google Sheet تنها Source Of Truth پروژه است.

---

# سرویس‌های مورد استفاده

Google Sheet

↓

Github Action (Scheduler)

↓

Playwright

↓

UXPilot

↓

Figma

↓

Web2Elementor

↓

Gmail

---

# لینک‌های اصلی

Google Sheet

```
https://docs.google.com/spreadsheets/d/1bJFab0nXnV2mTzR2nAVl5V6Aqb7ajz1diAV6fwpID0k/edit
```

UXPilot Login

```
https://uxpilot.ai/login
```

UXPilot Dashboard

```
https://uxpilot.ai/a/ui-list
```

Figma

```
https://www.figma.com/design/NLkFc0NtOqUnR9Fh6madRL/ENGAR-KE
```

HTML → Elementor

```
https://web2elementor.com/html-to-elementor/
```

---

# اجرای Workflow

Github Action

↓

هر 1 ساعت

↓

Google Sheet

↓

بررسی Status

↓

اگر پروژه Start نبود

↓

Exit

↓

اگر Start وجود داشت

↓

شروع پروژه

---

# قانون انتخاب پروژه

اگر چند پروژه همزمان Start بودند

فقط اولین پروژه اجرا شود.

بقیه نادیده گرفته شوند.

بعد از پایان کامل پروژه

10 دقیقه صبر شود.

سپس پروژه بعدی اجرا شود.

---

# تغییر اولیه Status

به محض انتخاب پروژه

Status

از

```
Start
```

تبدیل شود به

```
Running
```

تا پروژه دوباره توسط Cron اجرا نشود.

---

# ستون‌های مهم شیت

از فایل اکسل، ستون‌های زیر در Workflow استفاده خواهند شد:

Project Name

Status

Required Project Level

Design System

Full Project Doc

Pages

Count Page

Source Links

Source Images

Logo URL

Figma Needed

Client Dev Method

User Email

HTML,CSS File

JSON File

Edits After Design

Mobile Version (ستون جدید)

---

# سطح پروژه

اگر Required Project Level برابر باشد با

```
High
```

مدل UXPilot

```
Glide Pro
```

اگر Medium بود

```
Glide
```

اگر Low بود

```
Fast
```

---

# ورود به UXPilot

اگر

```
Figma Needed = Yes
```

مرورگر باز شود.

ورود به

```
https://uxpilot.ai/login
```

انجام شود.

نام کاربری و رمز عبور از Github Secrets خوانده شود.

پس از Login موفق

وارد

```
https://uxpilot.ai/a/ui-list
```

شود.

در صورت مشاهده Login Error

حداکثر سه بار Retry انجام شود.

در صورت شکست

Status پروژه

```
Error Login
```

شود.

ایمیل ارسال گردد.

Workflow متوقف شود.

---

# ساخت پروژه جدید

روی

Create New

کلیک شود.

↓

Create New File

↓

Project Name

↓

عنوان پروژه از Sheet

↓

File Context

↓

Design System

↓

Create

↓

منتظر باز شدن فایل بماند.

Timeout

```
120s
```

---

# تنظیم مدل

بر اساس سطح پروژه

مدل مناسب انتخاب شود.

در صورت انتخاب موفق

5 ثانیه صبر شود.

---

# اضافه کردن Website

اگر ستون

Source Links

خالی نبود

روی

Add Website Link

کلیک شود.

آدرس وارد شود.

روی Add کلیک شود.

منتظر پایان Import بماند.

---

# اضافه کردن تصاویر

اگر

Logo URL

وجود داشت

Upload شود.

اگر

Source Images

وجود داشت

تمام تصاویر Upload شوند.

در صورت شکست Upload

سه بار Retry انجام شود.

---

# ساخت Prompt نهایی

Prompt اصلی همیشه شامل دو بخش است.

قسمت اول

```
Full Project Doc
```

قسمت دوم

Prompt همان صفحه

مثلاً

```
Home Page

Dashboard

Pricing

About

Blog
```

هر صفحه باید دقیقاً مشخص کند

در حال طراحی کدام صفحه است.

مثال

```
You are currently designing page 2 of 5.

Current Page:

Pricing

Follow all previous project rules.

Keep consistency with previous pages.
```

---

# پروژه چند صفحه‌ای

اگر

Count Page

برابر

5

باشد.

Loop

پنج بار اجرا شود.

در هر بار

Prompt مخصوص همان صفحه ارسال شود.

تا پایان همه صفحات.

---

# روند هر صفحه

Upload Context

↓

Upload Images

↓

Paste Prompt

↓

Generate

↓

Wait

↓

Finish

---

# زمان انتظار

برای پروژه Low

حداکثر

4 دقیقه

Medium

7 دقیقه

High

10 دقیقه

اگر زودتر Generate تمام شد

بلافاصله مرحله بعد اجرا شود.

---

# پیشنهاد برای افزایش پایداری (بدون پیچیده کردن سیستم)

برای اینکه Workflow در عمل پایدارتر باشد، این چند قانون را از ابتدا در طراحی لحاظ کن:

* **بعد از هر کلیک مهم** (Create، Upload، Generate، Copy/Export)، به جای صبر ثابت، منتظر ظاهر شدن عنصر یا پیام موفقیت بمان و فقط در صورت نیاز Timeout اعمال کن.
* **قبل از هر مرحله** بررسی کن که صفحه هنوز Login است یا Session منقضی نشده؛ اگر Session از بین رفته بود، یک‌بار Login مجدد انجام بده.
* **تمام Timeoutها و URLها** به صورت ثابت داخل فایل `config` نگهداری شوند تا بعداً بدون تغییر کد قابل ویرایش باشند.
* **در هر مرحله** یک Screenshot گرفته شود، اما فقط آخرین Screenshot در صورت خطا به عنوان Artifact و پیوست ایمیل ذخیره شود تا فضای GitHub اشغال نشود.
* **هر تغییر Status در Google Sheet** فقط بعد از موفقیت همان مرحله انجام شود تا وضعیت پروژه همیشه با واقعیت هماهنگ باشد.

---

این پایان **بخش اول** است.

در **بخش دوم** وارد مراحل بعد از Generate می‌شویم؛ شامل:

* Mobile Version
* Copy HTML
* Copy to Figma
* Export Elementor
* دانلود JSON
* ارسال ایمیل
* آپدیت Google Sheet
* سیستم Edit After Design
* لاگ کامل و مدیریت خطا
* ساختار Repository و ترتیب فایل‌ها برای شروع کدنویسی.
