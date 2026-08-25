# Phase 2 — AI Implementation Engine

## هدف

بعد از پایان کامل Phase 1، مدل هوش مصنوعی وارد کار می‌شود. GitHub Actions فقط executor است؛ تصمیم‌گیری دربارهٔ URL، selector، فایل، تغییر کد، ورود، دیباگ و مقداردهی ستون‌ها را مدل انجام می‌دهد.

## Phase boundary

قبل از Phase 2:

- ورود UXPilot با `UX Pilot Account` انجام می‌شود.
- password UXPilot از GitHub Actions می‌آید.
- هر صفحه به‌صورت مستقل Generate می‌شود.
- HTML هر صفحه ذخیره می‌شود.
- در صورت `Figma Needed = Yes`، نسخهٔ standalone `Figma` در بخش `COPY TO` انتخاب می‌شود؛ گزینهٔ `Figma (Nodey plugin)` عمداً انتخاب نمی‌شود.
- فقط در صورت `Implementation = Yes` و `Client Dev Method = Elementor`، ورود به converter و تبدیل HTML به JSON انجام می‌شود.
- JSON هر صفحه نیز با لینک عمومی همان صفحه در `JSON File` نوشته می‌شود.

هیچ درخواست AI در این فاز وجود ندارد.

## Phase 2 context

مدل همهٔ headerهای live sheet و همهٔ مقدارهای همان ردیف را دریافت می‌کند. بنابراین اضافه شدن ستون‌های جدید بدون تغییر کد نیز در context مدل دیده می‌شود.

`AI Engine Note` برای حافظهٔ عملیاتی استفاده می‌شود و `Project Cost` باید در پایان با برآورد واقعی و به تومان به‌روزرسانی شود.

کلید `AI Token Account` در همان ردیف خوانده می‌شود. base URL و model از ستون‌های اختیاری `AI Base URL` و `AI Model` استفاده می‌کنند و در صورت نبودن آن‌ها از environment fallback می‌گیرند.

## ابزارهای مدل

- `browser.new_tab`
- `browser.list_tabs`
- `browser.navigate`
- `browser.inspect`
- `browser.click`
- `browser.fill`
- `browser.press`
- `browser.wait`
- `fs.list`
- `fs.read`
- `fs.search`
- `fs.write`
- `exec.command`
- `sheet.read`
- `sheet.update`
- `finish`

## محدودیت‌های executor

URLهای browser فقط زمانی مجاز هستند که host آن‌ها در مقدارهای همان ردیف پروژه یا URLهای رسمی Phase 1 دیده شده باشد.

فرمان‌های تخریبی مثل `rm -rf`, `git push`, `git reset`, `sudo`, `ssh`, `scp`, `curl` و `wget` اجرا نمی‌شوند.

مدل باید قبل از تغییر inspect/read انجام دهد و بعد از تغییر verify کند.

## Provider

نسخهٔ اولیه با API سازگار با OpenAI و default base URL زیر آماده شده است:

```text
https://api.gapgpt.app/v1
```

برای یک provider با سبک Anthropic Messages API نیز adapter داخلی وجود دارد؛ در آن حالت `AI_PROVIDER=anthropic` قابل استفاده است.
