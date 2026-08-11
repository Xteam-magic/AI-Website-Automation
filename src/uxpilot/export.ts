import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("UXPilot/Export");

/**
 * SELECTOR NOTES — same caveat as the other UXPilot files: unverified
 * against the live DOM, isolated here for easy fixing after the first real
 * run.
 */
const selectors = {
  copyExportMenu: (page: Page) => page.getByRole("button", { name: /copy\s*\/\s*export|export/i }),
  copyAsHtmlOption: (page: Page) => page.getByRole("menuitem", { name: /copy as html/i }).or(page.getByText(/copy as html/i)),
  copyToFigmaOption: (page: Page) => page.getByRole("menuitem", { name: /copy to figma/i }).or(page.getByText(/copy to figma/i)),
  figmaCopiedToast: (page: Page) => page.getByText(/design copied.*paste in figma/i),
};

async function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(async () => navigator.clipboard.readText());
}

/**
 * Copies the generated design as HTML and returns its content, read back
 * from the OS clipboard. Retries the whole copy action (per
 * config.retries.clipboard) if the clipboard comes back empty, per the
 * project's explicit "empty clipboard -> retry up to 3 times" rule.
 */
export async function copyAsHtml(page: Page): Promise<string> {
  log.info("Copying design as HTML...");

  return retry(
    async () => {
      await selectors.copyExportMenu(page).first().click();
      await selectors.copyAsHtmlOption(page).first().click();

      // Give the browser a brief moment to actually populate the clipboard
      // before the first read attempt.
      let html = "";
      await waitUntil(
        async () => {
          html = await readClipboardText(page);
          return html.trim().length > 0;
        },
        { timeoutMs: config.timeouts.clipboardMs, intervalMs: 500, label: "clipboard to contain HTML" }
      );

      return html;
    },
    { retries: config.retries.clipboard, label: "Copy as HTML (clipboard)" }
  );
}

/**
 * Copies the generated design to Figma and waits for UXPilot's
 * "Design copied! Paste in Figma" confirmation toast, per the doc's
 * explicit "do nothing else, just wait for the toast" rule.
 */
export async function copyToFigma(page: Page): Promise<void> {
  log.info("Copying design to Figma...");

  await selectors.copyExportMenu(page).first().click();
  await selectors.copyToFigmaOption(page).first().click();

  await waitUntil(async () => (await selectors.figmaCopiedToast(page).count()) > 0, {
    timeoutMs: config.timeouts.figmaCopyToastMs,
    label: '"Design copied! Paste in Figma" confirmation',
  });

  log.info('Received "Design copied! Paste in Figma" confirmation.');
}
