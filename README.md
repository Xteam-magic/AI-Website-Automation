# AI Website Automation

سیستم کاملاً خودکار برای مدیریت پروژه‌های طراحی UI، از طریق Google Sheet (تنها Source Of Truth)، UXPilot، Figma و Elementor — با Node.js، TypeScript، Playwright و GitHub Actions.

## تکنولوژی‌ها

- Node.js 20+ / TypeScript (strict)
- Playwright (Chromium)
- Google Sheets API (`googleapis` + Service Account)
- Nodemailer (SMTP با Gmail App Password)
- GitHub Actions (Cron ساعتی)

## راه‌اندازی

```bash
npm install
npx playwright install --with-deps chromium   # فقط بار اول
cp .env.example .env
# مقادیر .env را پر کن (پایین را ببین)
npm run build
npm start
```

برای اجرای فقط بررسی تایپ‌ها بدون Build کامل: `npm run typecheck`

## متغیرهای محیطی / GitHub Secrets

همه در `.env.example` مستند شده‌اند. در GitHub Actions همین‌ها به صورت **Repository Secrets** ست می‌شوند:

| متغیر | توضیح |
| --- | --- |
| `UXPILOT_SHARED_PASSWORD` | پسورد ثابت همه اکانت‌های UXPilot؛ ایمیل از ستون `UX Pilot Account` خوانده می‌شود |
| `ELEMENTOR_SHARED_PASSWORD` | پسورد ثابت همه اکانت‌های converter؛ ایمیل از ستون `CONV Elementor Account` خوانده می‌شود |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON کامل Service Account گوگل (یک‌خطی)، با دسترسی Edit روی شیت |
| `GOOGLE_SHEET_ID` | شناسه Google Sheet |
| `RESEND_API_KEY` | کلید ارسال ایمیل از طریق سرویس Resend |
| `ADMIN_EMAIL` | گیرنده ثابت همه ایمیل‌ها (پیش‌فرض `emad_1382@yahoo.com`) |
| `FIGMA_URL` | لینک فایل Figma مقصد |
| `ELEMENTOR_URL` | لینک ابزار Web2Elementor |
| `AI_BASE_URL` | fallback برای API فاز دوم؛ پیش‌فرض `https://api.gapgpt.app/v1` |
| `AI_PROVIDER` | `openai-compatible` یا `anthropic` |
| `AI_MODEL` | مدل fallback فاز دوم |

## ساختار Repository

```
AI-Website-Automation/
├── .github/workflows/scheduler.yml   # Cron ساعتی، concurrency، Upload Log/Screenshot
├── docs/                             # ۶ مستند مرجع پروژه (ورودی اصلی)
├── src/
│   ├── config/config.ts       # تنها منبع Timeout/Retry/URL/Path/Model Map/Secrets
│   ├── logger/logger.ts        # تنها منبع نوشتن Log (Console + logs/log.txt)
│   ├── helpers/                 # wait.ts (poll/sleep) · retry.ts · screenshot.ts (فقط خطا)
│   ├── types/index.ts            # ProjectRow، enum نهایی Status/Current Step، Pages/Edits
│   ├── sheet/googleSheet.ts        # Read/Update بر اساس نام ستون + انتخاب ردیف بعدی
│   ├── browser/browser.ts           # یک Instance Chromium برای کل طول یک اجرای پروژه
│   ├── uxpilot/                      # login · createProject · generate · export · editProject
│   ├── figma/paste.ts                 # Paste + Rename Frame (پرریسک‌ترین ماژول)
│   ├── elementor/convert.ts            # HTML -> JSON + دانلود
│   ├── gmail/mail.ts                    # تنها منبع ارسال ایمیل (۵ نقطه)
│   ├── prompts/buildPrompt.ts            # تنها منبع ساخت Prompt
│   ├── ai/                               # Phase 2 AI client + prompt + tool executor + agent loop
│   ├── runner/
│   │     ├── pageRunner.ts                # پایپ‌لاین یک صفحه
│   │     └── projectRunner.ts              # مدیریت کل پروژه (start/edit/resume)
│   └── index.ts                            # نقطه شروع — یک پروژه در هر اجرا
├── downloads/    # HTML/JSON خروجی، به تفکیک Project ID / Page
├── screenshots/  # فقط هنگام خطا
└── logs/         # log.txt کامل هر اجرا
```

## معماری اجرا — تصمیمات نهایی‌شده

- **مدل Scheduler:** هر اجرای GitHub Action دقیقاً **یک پروژه** را پردازش می‌کند و بعد از اتمام خارج می‌شود (`exit 0` موفق/بدون‌کار، `exit 1` خطا)؛ پروژه بعدی با اجرای ساعت بعد Cron شروع می‌شود.
- **اولویت انتخاب پروژه در هر اجرا:** `Running` (Resume) → `Completed` با `Edits After Design` پر → اولین `Start`.
- **ارسال ایمیل:** سرویس فعلی Resend، مطابق پیاده‌سازی موجود در `src/gmail/mail.ts`.
- **ذخیره خروجی:** HTML و JSON روی دیسک در `downloads/ProjectID/Page/` ذخیره می‌شوند؛ مسیر نسبی فایل در ستون‌های `HTML File` و `JSON File` شیت نوشته می‌شود (نه خودِ محتوا).
- **Resume:** صفحات قبل از `Current Page` تمام‌شده فرض می‌شوند و رد می‌شوند؛ صفحهٔ در حال انجام (و بقیه صفحات بعدش) از ابتدای پایپ‌لاین صفحه دوباره اجرا می‌شود — بازتولید یک صفحهٔ نیمه‌کاره بی‌خطر است (فقط خروجی همان صفحه را دوباره می‌نویسد) و نیاز به بازسازی وضعیت ریزدانه‌تر (وسط Paste فیگما، وسط Convert المنتور) را که با Crash از بین می‌رود، دور می‌زند.
- **Status Enum:** فقط مقادیر enum نهایی `docs/06_Sheet_Structure.txt` استفاده می‌شود؛ جزئیاتی مثل شکست Mobile در `Current Step` / ایمیل ثبت می‌شود، نه در ستون `Status`.
- **Login:** ایمیل UXPilot از `UX Pilot Account` همان ردیف می‌آید و password ثابت از GitHub Actions خوانده می‌شود؛ `Figma Needed` فقط روی مرحلهٔ Copy to Figma / Paste اثر دارد.
- **Implementation:** فقط وقتی `Implementation = Yes` است مرحلهٔ converter/implementation اجرا می‌شود؛ خود طراحی و HTML export مستقل از این فلگ باقی می‌ماند.
- **Phase 2 AI:** بعد از پایان تمام صفحات Phase 1 اجرا می‌شود. مدل کل ردیف live sheet را می‌خواند و GitHub Actions فقط ابزارهای تصمیم‌گرفته‌شده توسط مدل را اجرا می‌کند.
- **Drive content:** لینک‌های Google Drive برای ستون‌های محتوایی قبل از generation در تب جدید باز و محتوای کاملشان خوانده می‌شود.

## محدودیت‌های شناخته‌شده (قبل از اولین اجرای واقعی بخوان)

1. **Selectorهای UXPilot / Figma / Web2Elementor تأیید نشده‌اند.** این محیط به این سه سایت دسترسی مرورگر ندارد، پس همهٔ Selectorها بر پایهٔ بهترین برآورد (Playwright role/label/text locators) نوشته شده‌اند و هرکدام در یک آبجکت `selectors` جدا بالای فایل مربوطه جمع شده‌اند. بعد از اولین اجرای واقعی روی GitHub Actions یا لوکال، هر Selector که نخورد را با Screenshot/HTML خطا مشخص کن تا فقط همان خط اصلاح شود.
2. **`figma/paste.ts` پرریسک‌ترین بخش است.** Canvas فیگما WebGL است نه DOM معمولی و API عمومی فیگما قابلیت Paste ندارد؛ «اولین فضای خالی» با یک فاصله‌گذاری ثابت افقی بر اساس شمارهٔ صفحه شبیه‌سازی شده، نه با تشخیص واقعی فضای خالی. Rename فریم هم به شورتکات‌های کیبورد فیگما متکی است که ممکن است دقیقاً با محصول فعلی یکی نباشد.
3. **`HTML File` / `JSON File` فقط مسیر نسبی محلی هستند، نه لینک عمومی.** سند نهایی (۰۵) خواسته بود «فقط لینک فایل در شیت ذخیره شود»، اما هیچ سرویس ذخیره‌سازی/هاست عمومی در Stack مصوب (Node/TS/Playwright/Sheets/Gmail/Actions/dotenv) وجود ندارد، و Runnerهای GitHub Actions هم دائمی نیستند. فعلاً مسیر نسبی داخل Repository (`downloads/...`) در ستون نوشته می‌شود که برای رهگیری/دیباگ دقیق است ولی بعد از پاک شدن Artifact یک لینک قابل‌کلیک نیست. اگر لینک واقعی لازم است، باید یک سرویس ذخیره‌سازی (Google Drive API با همان Service Account، یا آپلود به یک باکت) به Stack اضافه شود — تصمیم با توست.
4. **Image/Logo Upload** فرض کرده هم یک فیلد «URL تصویر» ممکن است وجود داشته باشد و هم یک File Picker استاندارد (با دانلود موقت تصویر و آپلود آن)؛ کدام یک واقعاً در UXPilot هست، فقط با تست واقعی مشخص می‌شود.

## چک‌لیست نهایی (طبق `docs/04_Master_Prompt.md`)

| مورد | وضعیت |
| --- | --- |
| Repository کامل ساخته شده | ✅ |
| Build بدون خطا (`typecheck` + `build`) | ✅ |
| GitHub Actions Workflow آماده اجراست (syntax/steps) | ✅ |
| Login به UXPilot تست شده روی سایت واقعی | ⏳ نیاز به اولین اجرای زنده |
| Create Project تست شده | ⏳ |
| Upload Website / Upload Image تست شده | ⏳ |
| Generate Desktop / Mobile تست شده | ⏳ |
| Copy HTML / Copy to Figma تست شده | ⏳ |
| تبدیل و دانلود Elementor تست شده | ⏳ |
| Google Sheet Read/Write تست شده (منطق انتخاب ردیف با داده فرضی تست شد) | ✅ منطق / ⏳ اتصال واقعی |
| ارسال ایمیل تست شده | ⏳ نیاز به `GMAIL_APP_PASSWORD` واقعی |
| مدیریت خطا، Screenshot، Retry | ✅ (پیاده‌سازی) |
| Workflow پروژه چندصفحه‌ای | ✅ (پیاده‌سازی + تست منطقی) |
| Workflow برای Edits After Design | ✅ (پیاده‌سازی) |
| Resume بعد از قطع‌شدن | ✅ (پیاده‌سازی، سطح صفحه) |

موارد ⏳ فقط با پر کردن Secretهای واقعی و یک اجرای زنده قابل تأیید هستند — منطق و معماری کامل و Build سبزند.
