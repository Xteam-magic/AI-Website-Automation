
# مستند پروژه AI Website Automation V1

# بخش پنجم (نسخه نهایی)

## Setup، Deployment، Test و قوانین نهایی پروژه

---

# ترتیب توسعه پروژه

AI باید پروژه را دقیقاً با این ترتیب پیاده‌سازی کند.

```text
Repository
↓

Config
↓

Google Sheet Service
↓

Logger
↓

Browser Manager
↓

UXPilot Login

↓

Create Project

↓

Generate Engine

↓

HTML Export

↓

Figma Module

↓

Elementor Module

↓

Email Service

↓

Project Runner

↓

Github Action

↓

End-To-End Test
```

هیچ مرحله‌ای نباید قبل از تکمیل مرحله قبل شروع شود.

---

# Github Action

Workflow هر **۱ ساعت** اجرا شود.

ترتیب اجرای Workflow:

```text
Checkout Repository

↓

Install Node

↓

npm install

↓

Install Playwright Browsers

↓

Run Automation

↓

Upload Logs

↓

Upload Screenshots (Only On Failure)

↓

Finish
```

اگر هیچ پروژه‌ای با Status=Start یا پروژه‌ای با Edits After Design وجود نداشت، Workflow بدون خطا خاتمه پیدا کند.

---

# Github Secrets

فقط اطلاعات حساس داخل GitHub Secrets قرار بگیرند.

```text
UX_EMAIL

UX_PASSWORD

GOOGLE_SERVICE_ACCOUNT_JSON

GOOGLE_SHEET_ID

GMAIL_EMAIL

GMAIL_APP_PASSWORD

FIGMA_URL
```

هیچ Secret داخل کد یا فایل Config ذخیره نشود.

---

# ساختار Google Sheet (نسخه نهایی)

علاوه بر ستون‌های فعلی، ستون‌های زیر نیز اضافه شوند:

| Column             | توضیح                       |
| ------------------ | --------------------------- |
| Current Step       | مرحله فعلی اجرای پروژه      |
| Current Page       | صفحه‌ای که در حال طراحی است |
| Last Run Time      | زمان آخرین اجرای Workflow   |
| Last Finished Time | زمان پایان موفق پروژه       |

---

# Auto Save (الزامی)

قبل از ورود به هر مرحله مهم، مقدار ستون‌های زیر به‌روزرسانی شوند:

```text
Current Step

Current Page

Last Run Time
```

مثال:

| Status  | Current Step   | Current Page |
| ------- | -------------- | ------------ |
| Running | Login          | -            |
| Running | Upload Context | Home         |
| Running | Generate       | Home         |
| Running | Export HTML    | Home         |
| Running | Figma          | Home         |
| Running | Elementor      | Home         |

اگر Runner وسط اجرا متوقف شود، اجرای بعدی از روی همین اطلاعات ادامه پیدا کند و مراحل قبلی دوباره اجرا نشوند.

---

# ذخیره HTML (نسخه اصلاح‌شده)

به جای ذخیره کل HTML داخل Google Sheet:

```text
Copy HTML

↓

Save File

↓

downloads/project/page/index.html

↓

Upload File

↓

Store Link Inside Sheet
```

داخل Google Sheet فقط لینک فایل ذخیره شود.

مزایا:

* محدودیت حجم سلول‌های Google Sheet از بین می‌رود.
* فایل واقعی همیشه قابل دانلود است.
* ایمیل نیز می‌تواند همان فایل را ضمیمه کند.

---

# ذخیره JSON

برای Elementor نیز دقیقاً همین روش استفاده شود.

```text
Export JSON

↓

Save JSON

↓

Upload

↓

Store Download Link Inside Sheet
```

---

# ساختار پوشه دانلود

```text
downloads/

└── Project_ID/

      ├── Home/

      │      index.html

      │      home.json

      │

      ├── Pricing/

      │      index.html

      │      pricing.json

      │

      └── About/

             index.html
```

تمام فایل‌ها با **Project ID** ذخیره شوند، نه فقط نام پروژه، تا در صورت تشابه نام پروژه‌ها تداخلی ایجاد نشود.

---

# اولین تست

قبل از فعال کردن Scheduler:

```text
npm install

↓

playwright install

↓

npm run start
```

فقط یک پروژه تستی اجرا شود.

اگر مسیر زیر بدون خطا انجام شد:

```text
Start

↓

Running

↓

Generate

↓

HTML

↓

Figma

↓

Elementor

↓

Completed
```

آنگاه GitHub Action فعال شود.

---

# Resume Workflow (الزامی)

اگر GitHub Runner در هر مرحله متوقف شد:

در اجرای بعدی:

1. پروژه‌ای که Status=Running دارد پیدا شود.
2. Current Step خوانده شود.
3. Current Page خوانده شود.
4. اجرای پروژه از همان مرحله ادامه پیدا کند.
5. هیچ مرحله‌ای از ابتدا تکرار نشود.

---

# Definition Of Done

پروژه زمانی کامل است که:

* هر یک ساعت Google Sheet بررسی شود.
* اولین پروژه Start انتخاب شود.
* Status به Running تغییر کند.
* Login موفق انجام شود.
* پروژه در UXPilot ساخته شود.
* تمام صفحات طراحی شوند.
* Mobile Version (در صورت نیاز) تولید شود.
* HTML ذخیره و لینک آن در Sheet ثبت شود.
* Figma به‌روزرسانی شود.
* JSON (در صورت Elementor) تولید و لینک آن ثبت شود.
* ایمیل برای کاربر و مدیر ارسال شود.
* تمام مراحل Log شوند.
* در پایان Status=Completed ثبت شود.

---

# Debug Checklist

در صورت بروز خطا فقط این موارد بررسی شوند:

* GitHub Secrets
* دسترسی Google Sheet
* اعتبار Gmail
* اعتبار حساب UXPilot
* Timeoutها
* Session مرورگر
* اتصال اینترنت Runner
* تغییرات رابط کاربری سایت UXPilot یا Web2Elementor

---

# نسخه اول (MVP)

نسخه اول فقط روی این اهداف تمرکز کند:

* اجرای یک پروژه در هر لحظه.
* یک Browser Instance.
* اجرای کامل روی GitHub Actions.
* عدم استفاده از Database، Queue، Dashboard یا سرویس‌های اضافه.
* پایداری و قابلیت بازیابی (Resume) در اولویت باشد.

---

# نسخه‌های بعدی (فعلاً پیاده‌سازی نشوند)

این موارد برای آینده نگه داشته شوند:

* اجرای هم‌زمان چند پروژه
* Dashboard مدیریتی
* Queue پیشرفته
* گزارش‌های آماری
* اعلان Telegram/Discord
* سیستم مدیریت کاربران
* API اختصاصی

---

# دستور نهایی برای AI Agent

> این مستند را به عنوان تنها مرجع پروژه در نظر بگیر. کل سیستم را با Node.js، TypeScript، Playwright و GitHub Actions پیاده‌سازی کن. از Mock، Placeholder یا TODO استفاده نکن. تمام فایل‌ها، Workflowها، سرویس‌ها و منطق پروژه را به صورت کامل تولید کن. Google Sheet تنها منبع اطلاعات پروژه است و تمام وضعیت‌ها، لینک فایل‌ها و مراحل اجرا باید در همان ثبت شوند. سیستم باید در برابر توقف GitHub Runner مقاوم باشد و با استفاده از ستون‌های Current Step و Current Page اجرای پروژه را از همان نقطه ادامه دهد. فایل‌های HTML و JSON نباید داخل Google Sheet ذخیره شوند؛ فقط لینک آن‌ها ثبت شود. تمام عملیات باید لاگ، مدیریت خطا، Screenshot و ارسال ایمیل داشته باشند.

---