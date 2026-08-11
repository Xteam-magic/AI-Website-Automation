عالی، از این قسمت به بعد وارد فاز عملی پروژه می‌شویم. بعد از این بخش، تقریباً AI Agent می‌داند باید چه فایل‌هایی بسازد، هر فایل چه وظیفه‌ای دارد و ترتیب اجرای کل سیستم چگونه است. سعی کردم همه چیز سریع، تمیز و بدون معماری‌های سنگین باشد.

---

# مستند پروژه AI Website Automation V1

# بخش سوم

## ساختار Repository و ترتیب پیاده‌سازی

---

# تکنولوژی‌های پروژه

تمام پروژه فقط با این Stack پیاده‌سازی شود.

```
Node.js

Typescript

Playwright

Google Sheets API

Gmail API

Github Actions

dotenv

```

هیچ Framework اضافه‌ای استفاده نشود.

---

# ساختار نهایی Repository

```
AI-Website-Automation/

│

├── .github/

│      └── workflows/

│              scheduler.yml

│

├── src/

│

│     ├── config/

│     │       config.ts
│     │
│     ├── browser/
│     │       browser.ts
│     │
│     ├── sheet/
│     │       googleSheet.ts
│     │
│     ├── uxpilot/
│     │       login.ts
│     │       createProject.ts
│     │       generate.ts
│     │       export.ts
│     │       editProject.ts
│     │
│     ├── figma/
│     │       paste.ts
│     │
│     ├── elementor/
│     │       convert.ts
│     │
│     ├── gmail/
│     │       mail.ts
│     │
│     ├── logger/
│     │       logger.ts
│     │
│     ├── helpers/
│     │       wait.ts
│     │       retry.ts
│     │       screenshot.ts
│     │
│     ├── runner/
│     │       pageRunner.ts
│     │       projectRunner.ts
│     │
│     ├── prompts/
│     │       buildPrompt.ts
│     │
│     └── index.ts
│
│
├── downloads/
│
├── screenshots/
│
├── logs/
│
├── package.json
│
├── tsconfig.json
│
└── README.md
```

---

# وظیفه هر فایل

## index.ts

شروع کل برنامه

↓

خواندن Google Sheet

↓

انتخاب پروژه

↓

اجرای ProjectRunner

---

## ProjectRunner

وظیفه

مدیریت کل پروژه

```
شروع پروژه

↓

Update Status

↓

Login

↓

Loop Pages

↓

Finish

↓

Email

↓

Update Sheet
```

---

## PageRunner

مدیریت فقط یک صفحه

```
Upload Context

↓

Generate

↓

Mobile

↓

Export HTML

↓

Figma

↓

Elementor

↓

Email

↓

Next Page
```

---

## buildPrompt.ts

تنها مسئول ساخت Prompt است.

ورودی

```
Project

+

Current Page

+

Full Doc

+

Edit

```

خروجی

```
یک Prompt کامل
```

هیچ جای دیگر Prompt ساخته نشود.

---

## login.ts

فقط Login انجام دهد.

هیچ منطق دیگری نداشته باشد.

---

## createProject.ts

مسئول

Create New

↓

Create File

↓

Insert Context

---

## generate.ts

مسئول

Generate

↓

Wait

↓

Finish

---

## export.ts

مسئول

Copy HTML

↓

Copy Figma

---

## paste.ts

فقط

Open Figma

↓

Paste

↓

Rename Frame

---

## convert.ts

HTML

↓

Convert

↓

Export JSON

---

## googleSheet.ts

فقط

Read

Update

Search

Row

---

## mail.ts

تمام ایمیل‌های پروژه فقط از این فایل ارسال شوند.

---

## logger.ts

تمام Logها فقط از این فایل نوشته شوند.

مثلاً

```
logger.info()

logger.error()

logger.warning()
```

---

# ترتیب اجرای فایل‌ها

```
index

↓

googleSheet

↓

projectRunner

↓

login

↓

createProject

↓

pageRunner

↓

generate

↓

mobile

↓

export

↓

figma

↓

elementor

↓

gmail

↓

update sheet

↓

finish
```

---

# ترتیب اجرای پروژه

```
Scheduler

↓

Read Sheet

↓

Status==Start

↓

Running

↓

Login

↓

Create Project

↓

Loop Pages

↓

Completed

↓

Wait 10 Minutes

↓

Next Project
```

---

# ترتیب اجرای صفحات

```
Home

↓

Generate

↓

Export

↓

Email

↓

Pricing

↓

Generate

↓

Export

↓

Email

↓

About

↓

Generate

↓

Export

↓

Finish
```

---

# ساخت Prompt

Prompt همیشه از چهار قسمت تشکیل شود.

---

## قسمت اول

```
Project Name
```

---

## قسمت دوم

```
Design System
```

---

## قسمت سوم

```
Full Project Doc
```

---

## قسمت چهارم

```
Current Page

Example

You are designing page 2 of 5

Current Page

Pricing

Keep consistency with previous pages.
```

---

# اگر Edit باشد

Prompt تبدیل شود به

```
Project

+

Full Doc

+

Current Page

+

Edits

```

---

# Github Secrets

Secrets موردنیاز

```
UX_EMAIL

UX_PASSWORD

GOOGLE_SHEET_ID

GOOGLE_SERVICE_ACCOUNT

GMAIL_EMAIL

GMAIL_PASSWORD

FIGMA_URL

ELEMENTOR_URL
```

هیچ اطلاعات حساسی داخل کد قرار نگیرد.

---

# Config

تمام موارد زیر فقط داخل

config.ts

قرار بگیرند.

```
Timeout

Retry Count

URLs

Wait Times

Model Names

Email Targets

Folder Paths
```

---

# Timeoutها

```
Low

240 sec

Medium

420 sec

High

600 sec

```

---

# Retry

```
Login

3

Upload

3

Generate

1

Clipboard

3

Google Sheet

3

Email

2

```

---

# Screenshot

در شروع هر مرحله

نیازی نیست Screenshot گرفته شود.

فقط در صورت

```
Error
```

Screenshot ذخیره شود.

نام فایل

```
ProjectName

Page

Step

Time

```

مثال

```
ENGAR

Home

Generate

18-42-15.png
```

---

# لاگ‌ها

تمام Logها همزمان در

```
Github Actions

+

logs/log.txt
```

ثبت شوند.

---

# دانلودها

تمام فایل‌های دانلودی

HTML

JSON

داخل

```
downloads/

Project/

Page/
```

ذخیره شوند.

---

# آپدیت Sheet

پس از پایان هر مرحله مهم، فقط همان ستون مرتبط به‌روزرسانی شود.

| مرحله           | ستون                  |
| --------------- | --------------------- |
| شروع پروژه      | Status = Running      |
| پایان Generate  | Status = Generated    |
| پایان HTML      | HTML,CSS File         |
| پایان Elementor | JSON File             |
| پایان پروژه     | Status = Completed    |
| خطا             | Status = Error + Step |

---

# قوانین توقف پروژه

اگر هر کدام از موارد زیر رخ داد، اجرای پروژه متوقف شود:

* Login ناموفق بعد از ۳ تلاش
* Generate ناموفق بعد از Retry
* Google Sheet در دسترس نبود
* Clipboard HTML خالی ماند
* Figma Paste ناموفق بود
* Elementor Export انجام نشد

در هر توقف:

1. Screenshot
2. ثبت Log
3. ارسال ایمیل
4. آپدیت Status
5. پایان Workflow

---

# پیشنهادهای کوچک برای افزایش پایداری

این موارد را بدون پیچیده کردن پروژه از ابتدا لحاظ کن:

### 1. Lock پروژه

به محض اینکه پروژه انتخاب شد:

```
Status

↓

Running
```

و دیگر هیچ Cron دیگری اجازه انتخاب آن پروژه را نداشته باشد.

---

### 2. Resume

اگر Workflow وسط کار قطع شد و Status پروژه `Running` بود، در اجرای بعدی از روی مرحله ثبت‌شده در Sheet ادامه بده، نه اینکه کل پروژه را از ابتدا اجرا کند. برای این کار می‌توان یک ستون جدید مثل `Current Step` اضافه کرد.

---

### 3. تاریخچه

در انتهای پروژه، ستون‌هایی مانند `Last Run Time` و `Last Finished Time` به‌روزرسانی شوند تا مشخص باشد آخرین اجرای موفق چه زمانی بوده است.

---

### 4. شناسه پروژه

در تمام Logها، Screenshotها، ایمیل‌ها و نام فایل‌ها از `Project ID` استفاده شود تا اگر دو پروژه نام یکسان داشتند، تداخلی ایجاد نشود.

---

این پایان **بخش سوم** است.

در **بخش چهارم** وارد مهم‌ترین قسمت می‌شویم:

* Prompt نهایی یکپارچه برای Claude Code / Codex
* دستور تولید کل پروژه از صفر تا صد
* قوانین کدنویسی که Agent باید رعایت کند
* ترتیب تولید فایل‌ها
* چک‌لیست نهایی برای اولین تست روی GitHub Actions

این بخش در عمل همان چیزی خواهد بود که مستقیم به مدل کدنویس می‌دهی تا پروژه را بسازد.
