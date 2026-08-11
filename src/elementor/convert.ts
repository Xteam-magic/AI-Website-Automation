import fs from "fs";
import path from "path";
import type { BrowserContext } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("Elementor");

/**
 * SELECTOR NOTES — unverified against the live web2elementor.com DOM (same
 * caveat as the UXPilot modules). Isolated here for easy fixing.
 */
const selectors = {
  htmlTextarea: (page: import("playwright").Page) => page.getByPlaceholder(/paste your html/i).or(page.getByRole("textbox")),
  convertButton: (page: import("playwright").Page) => page.getByRole("button", { name: /^convert$/i }),
  conversionDoneIndicator: (page: import("playwright").Page) => page.getByRole("button", { name: /export to elementor/i }),
  exportButton: (page: import("playwright").Page) => page.getByRole("button", { name: /export to elementor/i }),
};

/**
 * Pastes HTML into Web2Elementor, converts it, downloads the resulting
 * Elementor JSON, and saves it to downloads/{projectId}/{pageName}/. No
 * automatic retry here, per project rule — a failed Elementor export is one
 * of the explicit workflow-stopping conditions, not a retryable step.
 */
export async function convertHtmlToElementor(
  context: BrowserContext,
  params: { html: string; projectId: string; pageName: string }
): Promise<string> {
  const elementorPage = await context.newPage();

  try {
    log.info(`Opening Web2Elementor: ${config.urls.elementorConverter}`);
    await elementorPage.goto(config.urls.elementorConverter, { waitUntil: "domcontentloaded" });

    await selectors.htmlTextarea(elementorPage).first().fill(params.html);
    await selectors.convertButton(elementorPage).first().click();

    await waitUntil(async () => (await selectors.conversionDoneIndicator(elementorPage).count()) > 0, {
      timeoutMs: config.timeouts.elementorConvertMs,
      label: "HTML -> Elementor conversion to finish",
    });

    const downloadDir = path.join(config.paths.downloads, params.projectId, params.pageName);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

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
