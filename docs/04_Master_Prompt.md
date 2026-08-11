-

# مستند پروژه AI Website Automation V1

# بخش چهارم

# Master Prompt for Claude Code / Codex

---

# نقش AI

تو یک Senior Full Stack Automation Engineer هستی.

وظیفه تو ساخت یک پروژه Production Ready با استفاده از Playwright و Github Actions است.

هدف پروژه ساخت یک سیستم کاملاً خودکار برای مدیریت پروژه‌های طراحی UI از طریق Google Sheet است.

این پروژه باید کاملاً قابل اجرا باشد و هیچ بخش ناقصی نداشته باشد.

از Mock، Placeholder یا TODO استفاده نکن.

هر فایل باید کامل نوشته شود.

---

# تکنولوژی‌ها

از تکنولوژی‌های زیر استفاده کن.

```
NodeJS

Typescript

Playwright

Google Sheets API

Google Gmail API

Github Actions

dotenv
```

هیچ Framework اضافه‌ای استفاده نشود.

---

# قوانین کلی

Google Sheet تنها Source Of Truth است.

هیچ دیتابیس دیگری ایجاد نشود.

تمام اطلاعات فقط از Sheet خوانده شوند.

تمام Updateها فقط داخل Sheet نوشته شوند.

---

# ساختار پروژه

دقیقاً Repository زیر ساخته شود.

```
.github/workflows/

src/

browser/

config/

figma/

gmail/

helpers/

logger/

prompts/

runner/

sheet/

uxpilot/

elementor/

downloads/

screenshots/

logs/
```

هیچ فایل اضافه‌ای ساخته نشود مگر برای اجرای صحیح پروژه.

---

# Scheduler

Github Action

هر

```
1 ساعت
```

اجرا شود.

ابتدا Google Sheet خوانده شود.

اگر هیچ پروژه‌ای با Status برابر Start نبود

Workflow خاتمه پیدا کند.

---

اگر چند پروژه Start بودند

فقط اولین پروژه اجرا شود.

---

به محض انتخاب پروژه

```
Status

↓

Running
```

شود.

---

# Login

ورود فقط یک بار انجام شود.

Session حفظ شود.

اگر Session منقضی شد

Login مجدد انجام شود.

حداکثر

۳

بار.

---

# Create Project

ورود به Dashboard

↓

Create New

↓

Create File

↓

Project Name

↓

Design System

↓

Create

↓

منتظر باز شدن پروژه بمان.

---

# انتخاب مدل

بر اساس

Required Project Level

```
High

↓

Glide Pro

Medium

↓

Glide

Low

↓

Fast
```

---

# Website

اگر Source Link وجود داشت

از

Add Website

استفاده شود.

منتظر Import بمان.

---

# Upload Images

اگر Logo وجود داشت

Upload شود.

اگر تصاویر مرجع وجود داشت

همه Upload شوند.

---

# Prompt

Prompt همیشه از موارد زیر ساخته شود.

```
Project Name

+

Full Project Doc

+

Design System

+

Current Page

+

Edits (اگر وجود داشت)

```

هیچ متن دیگری حذف نشود.

---

# Pages

اگر پروژه چند صفحه داشت

Loop اجرا شود.

برای هر صفحه

Prompt مخصوص همان صفحه ساخته شود.

پس از پایان هر صفحه

صفحه بعد اجرا شود.

---

# Generate

پس از کلیک روی Generate

هیچ کاری انجام نشود.

فقط منتظر پایان Generate بمان.

تشخیص پایان بر اساس

Preview

یا

Export

یا

فعال شدن دوباره Generate.

---

# Mobile

اگر

Mobile Version

برابر Yes بود

پس از پایان Desktop

Generate Mobile اجرا شود.

---

# HTML

پس از پایان Generate

Copy

↓

Copy HTML

Clipboard خوانده شود.

محتوا داخل Google Sheet ذخیره گردد.

---

# Figma

اگر

Figma Needed

برابر Yes بود.

Copy To Figma

اجرا شود.

منتظر پیام

```
Design Copied

Paste in Figma
```

بمان.

سپس

Figma

باز شود.

در اولین فضای خالی

Paste انجام شود.

Frame

به صورت

```
Project

-

Page
```

نامگذاری شود.

---

# Elementor

اگر

Client Dev Method

برابر Elementor بود.

HTML

داخل

Web2Elementor

Paste شود.

Convert

↓

Export JSON

↓

Download

↓

Google Sheet

↓

Email

---

# Edit

اگر

Edits After Design

خالی نبود.

Project قبلی باز شود.

صفحه مربوطه پیدا شود.

Prompt جدید ساخته شود.

Generate

↓

Export

↓

Email

↓

Update

---

# پایان پروژه

پس از پایان آخرین صفحه

```
Status

↓

Completed
```

---

۱۰ دقیقه صبر شود.

---

پروژه بعدی بررسی شود.

---

# Error Handling

در هر مرحله اگر خطا رخ داد

Screenshot

↓

Log

↓

Email

↓

Update Sheet

↓

Stop

---

# Logging

تمام مراحل Log شوند.

مثال

```
Login Started

Login Success

Create Project

Upload Images

Generate Started

Generate Finished

HTML Copied

Figma Finished

Elementor Finished

Email Sent

Project Completed
```

---

# Email

در مراحل زیر ایمیل ارسال شود.

شروع پروژه

شروع صفحه

پایان صفحه

پایان پروژه

خطا

گیرنده

```
User Email

+

emad_1382@yahoo.com
```

---

# Retry

```
Login

3

Generate

1

Upload

3

Clipboard

3

Google Sheet

3

Email

2
```

---

# Screenshot

فقط هنگام خطا Screenshot ذخیره شود.

---

# Timeout

```
Low

4 دقیقه

Medium

7 دقیقه

High

10 دقیقه
```

---

# Code Quality

هر فایل فقط یک مسئولیت داشته باشد.

Functionها کوچک باشند.

کدها Comment مناسب داشته باشند.

از Magic Number استفاده نشود.

تمام Timeoutها داخل Config باشند.

---

# چیزی که نباید انجام شود

از Selenium استفاده نکن.

از Puppeteer استفاده نکن.

Database ایجاد نکن.

Redis استفاده نکن.

Docker نیاز نیست.

هیچ Framework Backend اضافه نشود.

---

# چیزی که باید تولید شود

AI باید تمام فایل‌های پروژه را تولید کند.

تمام Workflow GitHub را بنویسد.

تمام فایل‌های Typescript را تولید کند.

تمام Configها را تولید کند.

تمام Helperها را تولید کند.

تمام Prompt Builder را تولید کند.

تمام Logger را تولید کند.

تمام Gmail Service را تولید کند.

تمام Google Sheet Service را تولید کند.

هیچ فایل ناقصی باقی نماند.

---

# چک‌لیست نهایی قبل از پایان تولید کد

قبل از اینکه Agent تولید پروژه را تمام‌شده اعلام کند، این موارد را بررسی و تأیید کند:

| مورد                                     | وضعیت |
| ---------------------------------------- | ----- |
| Repository کامل ساخته شده                | ✅     |
| GitHub Actions بدون خطا اجرا می‌شود      | ✅     |
| Login به UXPilot تست شده                 | ✅     |
| Create Project تست شده                   | ✅     |
| Upload Website تست شده                   | ✅     |
| Upload Image تست شده                     | ✅     |
| Generate Desktop تست شده                 | ✅     |
| Generate Mobile (در صورت نیاز) تست شده   | ✅     |
| Copy HTML تست شده                        | ✅     |
| Copy to Figma تست شده                    | ✅     |
| تبدیل Elementor تست شده                  | ✅     |
| دانلود JSON تست شده                      | ✅     |
| Google Sheet Read/Write تست شده          | ✅     |
| ارسال ایمیل تست شده                      | ✅     |
| مدیریت خطا و Screenshot تست شده          | ✅     |
| Retryها تست شده‌اند                      | ✅     |
| Workflow برای پروژه چندصفحه‌ای تست شده   | ✅     |
| Workflow برای Edits After Design تست شده | ✅     |

---

# چند پیشنهاد نهایی برای افزایش کیفیت (بدون سنگین کردن پروژه)

به نظرم فقط این چند مورد را هم به مستند اضافه کن، چون ارزش زیادی دارند و پیچیدگی خاصی ایجاد نمی‌کنند:

### ۱. ستون `Current Page`

یک ستون جدید در Sheet اضافه کن که هنگام اجرای پروژه مقدار آن دائماً به‌روزرسانی شود:

* Home
* Pricing
* About
* ...

اگر پروژه وسط کار قطع شد، دقیقاً مشخص است روی کدام صفحه بوده است.

---

### ۲. ستون `Current Step`

به جای اینکه فقط `Status = Running` باشد، مرحله فعلی نیز ثبت شود:

* Login
* Upload Context
* Generate
* Export HTML
* Figma
* Elementor
* Email

این کار هم برای Resume و هم برای دیباگ فوق‌العاده مفید است.

---

### ۳. ذخیره لینک UXPilot

بعد از ساخت پروژه در UXPilot، URL همان پروژه را در ستون `Design URL` ذخیره کن تا برای Editهای بعدی نیاز به جستجوی مجدد نباشد.

---

### ۴. لاگ زمان اجرا

در لاگ هر مرحله مدت زمان نیز ثبت شود؛ مثلاً:

```text
[Generate] Home Finished (06:42)
```

بعداً برای بهینه‌سازی سرعت پروژه بسیار مفید خواهد بود.

---
