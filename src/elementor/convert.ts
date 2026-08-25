import fs from "fs";
import path from "path";
import type { BrowserContext, Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("Elementor");

const selectors = {
  loginEmail: (page: Page) => page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)),
  loginPassword: (page: Page) => page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)),
  loginButton: (page: Page) => page.getByRole("button", { name: /log ?in|sign ?in/i }),
  loginError: (page: Page) => page.getByText(/invalid|incorrect|wrong password|failed/i),
  htmlTextarea: (page: Page) =>
    page.getByPlaceholder(/paste your html/i).or(page.locator("textarea")).or(page.getByRole("textbox")),
  convertButton: (page: Page) => page.getByRole("button", { name: /^convert$/i }),
  conversionDoneIndicator: (page: Page) => page.getByRole("button", { name: /export to elementor/i }),
  exportButton: (page: Page) => page.getByRole("button", { name: /export to elementor/i }),
};

async function tryElementorLogin(page: Page, account: string): Promise<void> {
  const email = selectors.loginEmail(page).first();
  const password = selectors.loginPassword(page).first();
  const emailCount = await email.count();
  const passwordCount = await password.count();

  // Some Web2Elementor deployments expose the converter publicly. In that case
  // there is no login form and we intentionally continue without credentials.
  if (!emailCount || !passwordCount) return;

  if (!account.trim()) {
    throw new Error("CONV Elementor Account is required because the converter requested login.");
  }
  if (!config.secrets.elementorSharedPassword) {
    throw new Error("Elementor shared password is not configured in GitHub Actions.");
  }

  log.info("Elementor converter login form detected. Logging in with the project's sheet account...");
  await email.fill(account.trim());
  await password.fill(config.secrets.elementorSharedPassword);
  await selectors.loginButton(page).first().click();

  await waitUntil(
    async () => {
      if ((await selectors.loginError(page).count()) > 0) {
        throw new Error("Elementor converter reported a login error.");
      }
      return (await selectors.htmlTextarea(page).count()) > 0;
    },
    {
      timeoutMs: config.timeouts.elementorLoginMs,
      intervalMs: 500,
      label: "Elementor converter login",
    }
  );
}

export async function convertHtmlToElementor(
  context: BrowserContext,
  params: { html: string; projectId: string; pageName: string; accountEmail: string }
): Promise<string> {
  const elementorPage = await context.newPage();

  try {
    log.info(`Opening Web2Elementor: ${config.urls.elementorConverter}`);
    await elementorPage.goto(config.urls.elementorConverter, { waitUntil: "domcontentloaded" });
    await elementorPage.waitForLoadState("networkidle").catch(() => undefined);

    await tryElementorLogin(elementorPage, params.accountEmail);

    await selectors.htmlTextarea(elementorPage).first().fill(params.html);
    await selectors.convertButton(elementorPage).first().click();

    await waitUntil(
      async () => (await selectors.conversionDoneIndicator(elementorPage).count()) > 0,
      {
        timeoutMs: config.timeouts.elementorConvertMs,
        intervalMs: 500,
        label: "HTML -> Elementor conversion to finish",
      }
    );

    const downloadDir = path.join(config.paths.downloads, params.projectId, params.pageName);
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const [download] = await Promise.all([
      elementorPage.waitForEvent("download", { timeout: config.timeouts.elementorDownloadMs }),
      selectors.exportButton(elementorPage).first().click(),
    ]);

    const jsonPath = path.join(downloadDir, `${params.pageName}.json`);
    await download.saveAs(jsonPath);
    log.info(`Elementor JSON saved: ${jsonPath}`);
    return jsonPath;
  } finally {
    await elementorPage.close();
  }
}
