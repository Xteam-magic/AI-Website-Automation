
# 00_START_HERE.md

# AI Website Automation

## دستورالعمل توسعه پروژه

این Repository شامل مستندات کامل پروژه است.

قبل از نوشتن حتی یک خط کد، تمام فایل‌های موجود در پوشه **docs** را به ترتیب مطالعه کن.

```
00_START_HERE.md

↓

01_Project_Overview.md

↓

02_Workflow.md

↓

03_Repository_Structure.md

↓

04_Master_Prompt.md

↓

05_Deployment_and_Test.md
```

هیچ فایل یا بخشی را رد نکن.

ابتدا کل پروژه را درک کن.

اگر تناقض، ابهام یا پیشنهاد مهمی وجود دارد، قبل از شروع توسعه اعلام کن.

پس از تأیید، توسعه پروژه را آغاز کن.

---

# هدف پروژه

هدف این پروژه ساخت یک سیستم کاملاً خودکار برای مدیریت پروژه‌های طراحی UI است.

Google Sheet تنها Source Of Truth پروژه است.

تمام تصمیم‌ها فقط بر اساس اطلاعات Google Sheet گرفته می‌شوند.

سیستم باید بتواند بدون دخالت انسان پروژه را از ابتدا تا انتها اجرا کند.

---

# تکنولوژی‌های مجاز

فقط از موارد زیر استفاده کن.

```
NodeJS

Typescript

Playwright

Google Sheets API

Gmail API

Github Actions

dotenv
```

از هیچ Framework یا تکنولوژی اضافه استفاده نکن مگر اینکه برای اجرای پروژه ضروری باشد.

---

# روش توسعه

پروژه را مرحله‌به‌مرحله توسعه بده.

ابتدا Repository را آماده کن.

سپس فایل‌های پایه را ایجاد کن.

بعد سرویس‌ها را پیاده‌سازی کن.

در نهایت Runner اصلی را بساز.

پس از هر مرحله Build بگیر.

اگر خطایی وجود داشت همان لحظه برطرف کن.

بعد به مرحله بعد برو.

---

# ترتیب توسعه

```
Repository

↓

Config

↓

Logger

↓

Google Sheet

↓

Browser

↓

UXPilot

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

Runner

↓

Github Actions

↓

Testing
```

---

# قوانین توسعه

هر فایل فقط یک مسئولیت داشته باشد.

تمام Functionها کوچک و خوانا باشند.

Magic Number استفاده نشود.

تمام Timeoutها داخل Config قرار بگیرند.

هیچ Secret داخل کد نوشته نشود.

از Placeholder یا TODO استفاده نشود.

تمام فایل‌ها کامل تولید شوند.

---

# کیفیت کد

پروژه باید Production Ready باشد.

تمام Importها صحیح باشند.

TypeScript بدون Error کامپایل شود.

تمام Promiseها مدیریت شوند.

تمام Errorها مدیریت شوند.

Retryها رعایت شوند.

Logها کامل باشند.

---

# خروجی مورد انتظار

در پایان توسعه باید موارد زیر وجود داشته باشد.

✅ Repository کامل

✅ تمام فایل‌های پروژه

✅ Github Workflow

✅ Config

✅ Logger

✅ Google Sheet Service

✅ Gmail Service

✅ UXPilot Module

✅ Figma Module

✅ Elementor Module

✅ Prompt Builder

✅ Runner

✅ README

✅ Build بدون Error

---

# روش کار

پس از پایان هر بخش:

ابتدا Build اجرا کن.

اگر خطایی وجود داشت برطرف کن.

سپس ادامه بده.

اگر به اطلاعات بیشتری نیاز داشتی، سؤال بپرس.

هیچ بخشی را حدس نزن.

---

# نحوه گزارش پیشرفت

در پایان هر مرحله گزارشی کوتاه ارائه کن.

مثال:

```
Phase 1 Completed

Repository ✅

Config ✅

Logger ✅

Next Step:

Google Sheet Service
```

---

# اگر در مستند تناقض دیدی

قبل از تغییر هر چیزی گزارش بده.

خودسرانه Architecture پروژه را تغییر نده.

---

# پایان پروژه

پروژه زمانی تمام شده است که:

* Build بدون Error باشد.
* GitHub Workflow آماده اجرا باشد.
* تمام فایل‌ها کامل باشند.
* هیچ Placeholder یا TODO باقی نمانده باشد.
* ساختار Repository مطابق مستند باشد.

---

# ساختار Repository پیشنهادی

من پیشنهاد می‌کنم Repository را از همان ابتدا به این شکل بسازی:

```
AI-Website-Automation/

│
├── docs/
│     00_START_HERE.md
│     01_Project_Overview.md
│     02_Workflow.md
│     03_Repository_Structure.md
│     04_Master_Prompt.md
│     05_Deployment_and_Test.md
│
├── src/
│
├── .github/
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
├── .gitignore
│
└── README.md
```

---

# چه فایل‌هایی را همراه Repository به Claude بدهی؟

فقط این موارد کافی هستند:

```
Repository

+

6 فایل Markdown

+

Google Sheet (xlsx یا لینک) | https://docs.google.com/spreadsheets/d/1bJFab0nXnV2mTzR2nAVl5V6Aqb7ajz1diAV6fwpID0k/edit?gid=0#gid=0

+

لینک‌های پروژه

UXPilot | https://uxpilot.ai/login

Figma | https://www.figma.com/design/NLkFc0NtOqUnR9Fh6madRL/ENGAR-KE?node-id=0-1&p=f&t=xnoXRind4xGSfm6x-0

Web2Elementor  | https://web2elementor.com/html-to-elementor/
```

نیازی نیست در ابتدا این موارد را بدهی:

❌ GitHub Secrets

❌ رمزهای عبور واقعی

❌ Gmail Password

❌ Service Account واقعی

❌ API Keyها

Claude باید تمام این موارد را به صورت Environment Variable پیاده‌سازی کند و بعداً خودت آن‌ها را مقداردهی کنی.

---

# ترتیب کار Claude که انتظار داری

بهتر است Claude دقیقاً با این روند جلو برود:

```
Phase 1

بررسی مستندات

↓

بررسی تناقض‌ها

↓

تأیید معماری

↓

شروع توسعه

↓

Repository

↓

Services

↓

Runner

↓

Workflow

↓

Build

↓

Fix

↓

Test

↓

Documentation

↓

Finish
```

از او بخواه بعد از پایان هر Phase متوقف شود و گزارش بدهد، نه اینکه بدون توقف تا انتها برود. این کار اگر نیاز به اصلاح مسیر یا تغییرات داشتی، کنترل پروژه را حفظ می‌کند.

---



* **Phase 1:** ساخت Repository، تنظیمات پایه و اسکلت پروژه
* **Phase 2:** سرویس‌ها (Google Sheets، Gmail، Logger، Browser و...)
* **Phase 3:** ماژول‌های UXPilot، Figma و Elementor
* **Phase 4:** Runnerها، GitHub Actions و تست End-to-End


