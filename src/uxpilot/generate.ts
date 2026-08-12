import fs from "fs";
import path from "path";
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
 * SELECTOR NOTES
 * --------------
 * These selectors are isolated because UXPilot's live DOM can change.
 */
const selectors = {
  /**
   * Live UXPilot main composer.
   *
   * Actual live DOM:
   * <textarea
   *   placeholder="Describe your design, @ to reference images or documents"
   * >
   */
  promptInput: (page: Page) =>
    page.locator(
      'textarea[placeholder="Describe your design, @ to reference images or documents"]'
    ),

  generateButton: (page: Page) =>
    page.getByRole("button", {
      name: /generate|send/i,
    }),

  spinner: (page: Page) =>
    page
      .getByRole("status")
      .or(
        page.locator(
          "[class*='spinner' i], [class*='loading' i]"
        )
      ),

  previewFrame: (page: Page) =>
    page.locator(
      "iframe[title*='preview' i], [class*='preview' i]"
    ),

  copyExportControls: (page: Page) =>
    page.getByRole("button", {
      name: /copy\s*\/\s*export/i,
    }),

  /**
   * On-canvas click target that opens the Generate menu
   * for the mobile variant.
   */
  designSurface: (page: Page) =>
    page
      .locator(
        [
          '[data-testid*="canvas" i]',
          '[data-testid*="design-surface" i]',
          '[class*="design-surface" i]',
          '[class*="canvas" i]',
        ].join(", ")
      )
      .first(),

  generateMobileOption: (page: Page) =>
    page
      .getByRole("menuitem", {
        name: /mobile/i,
      })
      .or(
        page.getByText(
          /generate mobile version/i
        )
      ),
};

/**
 * Creates a durable screenshot directory inside the repository
 * and saves the exact UXPilot UI immediately before Generate.
 */
async function saveGenerationInputScreenshot(
  page: Page
): Promise<void> {
  const screenshotsDir = path.join(
    process.cwd(),
    "screenshots"
  );

  fs.mkdirSync(screenshotsDir, {
    recursive: true,
  });

  const timestamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

  const screenshotPath = path.join(
    screenshotsDir,
    `uxpilot-generation-input-${timestamp}.png`
  );

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  log.info(
    `Generation input screenshot saved: ${screenshotPath}`
  );
}

/**
 * True once generation looks finished, per the project's rule that
 * ANY of these signals — whichever happens first — means "done":
 *
 * - Generate becomes usable
 * - Preview appears
 * - Copy/Export appears
 * - Spinner disappears
 */
async function isGenerationFinished(
  page: Page
): Promise<boolean> {
  const spinnerGone =
    (await selectors.spinner(page).count()) ===
    0;

  const previewVisible =
    (await selectors.previewFrame(page).count()) >
    0;

  const exportVisible =
    (await selectors.copyExportControls(page).count()) >
    0;

  const generateEnabled =
    await selectors
      .generateButton(page)
      .first()
      .isEnabled()
      .catch(() => false);

  return (
    spinnerGone &&
    (
      previewVisible ||
      exportVisible ||
      generateEnabled
    )
  );
}

async function clickGenerateAndWait(
  page: Page,
  timeoutMs: number,
  label: string
): Promise<void> {
  await selectors
    .generateButton(page)
    .first()
    .click();

  // After Generate is pressed, do not perform any additional clicks.
  // Only wait until generation is complete.
  await waitUntil(
    () => isGenerationFinished(page),
    {
      timeoutMs,
      intervalMs: 2_000,
      label,
    }
  );
}

async function attemptGenerateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel
): Promise<void> {
  const promptInput =
    selectors
      .promptInput(page)
      .first();

  await promptInput.fill(prompt);

  /**
   * IMPORTANT:
   * This screenshot is taken AFTER the complete page prompt has been
   * inserted and BEFORE Generate is pressed.
   *
   * It therefore captures:
   * - pasted logo
   * - model selection
   * - page prompt
   * - any other context visible in the composer
   */
  await new Promise((resolve) =>
    setTimeout(resolve, 750)
  );

  await saveGenerationInputScreenshot(
    page
  );

  await clickGenerateAndWait(
    page,
    config.timeouts.generateByLevel[level],
    "desktop generation to finish"
  );
}

/**
 * Pastes the built prompt and generates the desktop design,
 * retrying according to config.retries.generate.
 */
export async function generateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel
): Promise<void> {
  log.info(
    "Starting desktop generation..."
  );

  await retry(
    () =>
      attemptGenerateDesktop(
        page,
        prompt,
        level
      ),
    {
      retries:
        config.retries.generate,
      label: "Generate Desktop",
    }
  );

  log.info(
    "Desktop generation finished."
  );
}

async function attemptGenerateMobile(
  page: Page,
  level: ProjectLevel
): Promise<void> {
  await selectors
    .designSurface(page)
    .click();

  await selectors
    .generateButton(page)
    .first()
    .click();

  await selectors
    .generateMobileOption(page)
    .first()
    .click();

  await waitUntil(
    () => isGenerationFinished(page),
    {
      timeoutMs:
        config.timeouts
          .generateByLevel[level],
      intervalMs: 2_000,
      label:
        "mobile generation to finish",
    }
  );
}

/**
 * Generates the mobile version.
 *
 * Per project rule, mobile failure must NOT take down
 * the whole page/project.
 */
export async function generateMobile(
  page: Page,
  level: ProjectLevel
): Promise<void> {
  log.info(
    "Starting mobile generation..."
  );

  try {
    await retry(
      () =>
        attemptGenerateMobile(
          page,
          level
        ),
      {
        retries:
          config.retries.generate,
        label:
          "Generate Mobile",
      }
    );

    log.info(
      "Mobile generation finished."
    );
  } catch (err) {
    throw new MobileGenerateError(
      err instanceof Error
        ? err.message
        : String(err)
    );
  }
}
