import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";
import { ProjectLevel } from "../types";

const log = logger.scope("UXPilot/Generate");

/** Thrown specifically by generateMobile() so callers can treat a mobile failure as non-fatal (desktop is kept). */
export class MobileGenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileGenerateError";
  }
}

/**
 * SELECTOR NOTES — same caveat as the other UXPilot files: unverified
 * against the live DOM, isolated here for easy fixing after the first real
 * run.
 */
const selectors = {
  promptInput: (page: Page) => page.getByPlaceholder(/describe|prompt|what do you want/i).or(page.getByRole("textbox")),
  generateButton: (page: Page) => page.getByRole("button", { name: /generate|send/i }),
  spinner: (page: Page) => page.getByRole("status").or(page.locator("[class*='spinner' i], [class*='loading' i]")),
  previewFrame: (page: Page) => page.locator("iframe[title*='preview' i], [class*='preview' i]"),
  copyExportControls: (page: Page) => page.getByRole("button", { name: /copy|export/i }),

  // On-canvas click target that opens the Generate menu for the mobile variant.
  designSurface: (page: Page) => page.locator("[class*='canvas' i], [class*='design-surface' i]").first(),
  generateMobileOption: (page: Page) => page.getByRole("menuitem", { name: /mobile/i }).or(page.getByText(/generate mobile version/i)),
};

/**
 * True once generation looks finished, per the doc's rule that ANY of these
 * signals — whichever happens first — means "done": the Generate button is
 * usable again, a preview rendered, copy/export controls appeared, or the
 * spinner disappeared.
 */
async function isGenerationFinished(page: Page): Promise<boolean> {
  const spinnerGone = (await selectors.spinner(page).count()) === 0;
  const previewVisible = (await selectors.previewFrame(page).count()) > 0;
  const exportVisible = (await selectors.copyExportControls(page).count()) > 0;
  const generateEnabled = await selectors.generateButton(page).first().isEnabled().catch(() => false);

  return spinnerGone && (previewVisible || exportVisible || generateEnabled);
}

async function clickGenerateAndWait(page: Page, timeoutMs: number, label: string): Promise<void> {
  await selectors.generateButton(page).first().click();

  // No further clicks happen once Generate has been pressed — the project
  // rule is to only wait, polling for one of the finish signals above.
  await waitUntil(() => isGenerationFinished(page), { timeoutMs, intervalMs: 2_000, label });
}

async function attemptGenerateDesktop(page: Page, prompt: string, level: ProjectLevel): Promise<void> {
  await selectors.promptInput(page).first().fill(prompt);
  await clickGenerateAndWait(page, config.timeouts.generateByLevel[level], "desktop generation to finish");
}

/**
 * Pastes the built prompt and generates the desktop design, retrying once
 * (config.retries.generate) by re-clicking Generate if the first attempt
 * times out.
 */
export async function generateDesktop(page: Page, prompt: string, level: ProjectLevel): Promise<void> {
  log.info("Starting desktop generation...");
  await retry(() => attemptGenerateDesktop(page, prompt, level), {
    retries: config.retries.generate,
    label: "Generate Desktop",
  });
  log.info("Desktop generation finished.");
}

async function attemptGenerateMobile(page: Page, level: ProjectLevel): Promise<void> {
  await selectors.designSurface(page).click();
  await selectors.generateButton(page).first().click();
  await selectors.generateMobileOption(page).first().click();

  await waitUntil(() => isGenerationFinished(page), {
    timeoutMs: config.timeouts.generateByLevel[level],
    intervalMs: 2_000,
    label: "mobile generation to finish",
  });
}

/**
 * Generates the mobile version. Per project rule, a mobile failure must NOT
 * take down the whole page/project — the caller (pageRunner, Phase 4) is
 * expected to catch MobileGenerateError specifically and record
 * "Desktop Finished / Mobile Failed" instead of stopping the run.
 */
export async function generateMobile(page: Page, level: ProjectLevel): Promise<void> {
  log.info("Starting mobile generation...");
  try {
    await retry(() => attemptGenerateMobile(page, level), {
      retries: config.retries.generate,
      label: "Generate Mobile",
    });
    log.info("Mobile generation finished.");
  } catch (err) {
    throw new MobileGenerateError(err instanceof Error ? err.message : String(err));
  }
}
