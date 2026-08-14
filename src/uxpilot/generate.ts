import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { ProjectLevel } from "../types";

const log = logger.scope("UXPilot/Generate");

export class MobileGenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileGenerateError";
  }
}

const selectors = {
  promptInput: (page: Page) =>
    page.locator(
      'textarea[placeholder="Describe your design, @ to reference images or documents"]'
    ),

  generateButton: (page: Page) =>
    page.getByRole("button", { name: /generate|send/i }),

  stopButton: (page: Page) =>
    page.getByRole("button", { name: /^stop$/i }),

  spinner: (page: Page) =>
    page
      .getByRole("status")
      .or(page.locator("[class*='spinner' i], [class*='loading' i]")),

  previewFrame: (page: Page) =>
    page.locator("iframe[title*='preview' i], [class*='preview' i]"),

  copyExportControls: (page: Page) =>
    page.getByRole("button", { name: /copy\s*\/\s*export/i }),

  designSurface: (page: Page) =>
    page
      .locator(
        '[data-testid*="canvas" i], [data-testid*="design-surface" i], [class*="design-surface" i], [class*="canvas" i]'
      )
      .first(),

  generateMobileOption: (page: Page) =>
    page
      .getByRole("menuitem", { name: /mobile/i })
      .or(page.getByText(/generate mobile version/i)),
};


async function saveGenerationInputScreenshot(page: Page): Promise<void> {
  const screenshotsDir = path.join(process.cwd(), "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const screenshotPath = path.join(
    screenshotsDir,
    `uxpilot-generation-input-${timestamp}.png`
  );

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  log.info(`Generation input screenshot saved: ${screenshotPath}`);
}


async function getStoredProjectContext(page: Page): Promise<string> {
  try {
    return await page.evaluate(
      () =>
        (
          window as unknown as {
            __xmagicProjectPromptContext?: string;
          }
        ).__xmagicProjectPromptContext || ""
    );
  } catch {
    return "";
  }
}


async function isGenerationFinished(page: Page): Promise<boolean> {
  const stopVisible = await selectors
    .stopButton(page)
    .first()
    .isVisible()
    .catch(() => false);

  if (stopVisible) return false;


  const spinnerVisible = await selectors
    .spinner(page)
    .first()
    .isVisible()
    .catch(() => false);

  if (spinnerVisible) return false;


  const previewVisible =
    (await selectors.previewFrame(page).count()) > 0 &&
    (await selectors.previewFrame(page)
      .first()
      .isVisible()
      .catch(() => false));


  const exportVisible =
    (await selectors.copyExportControls(page).count()) > 0 &&
    (await selectors.copyExportControls(page)
      .first()
      .isVisible()
      .catch(() => false));


  const designVisible =
    (await selectors.designSurface(page).count()) > 0 &&
    (await selectors.designSurface(page)
      .first()
      .isVisible()
      .catch(() => false));


  return previewVisible || exportVisible || designVisible;
}


/**
 * Waits indefinitely until UXPilot has genuinely finished generating.
 * There is intentionally NO timeout and NO attempt to click a Stop button.
 */
async function waitForGenerationToFinish(
  page: Page,
  label: string
): Promise<void> {
  const startedAt = Date.now();
  let lastLogAt = startedAt;

  while (true) {
    if (await isGenerationFinished(page)) {
      const elapsedSeconds = Math.round(
        (Date.now() - startedAt) / 1000
      );

      log.info(`${label} finished after ${elapsedSeconds}s.`);
      return;
    }

    const now = Date.now();

    if (now - lastLogAt >= 30_000) {
      const elapsedSeconds = Math.round(
        (now - startedAt) / 1000
      );

      log.info(
        `${label} is still running after ${elapsedSeconds}s. Waiting indefinitely for completion...`
      );

      lastLogAt = now;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 2_000)
    );
  }
}

async function waitForPromptInput(
  page: Page
): Promise<ReturnType<Page["locator"]>> {
  const promptInput = selectors.promptInput(page).first();

  await promptInput.waitFor({
    state: "visible",
    timeout: 0,
  });

  return promptInput;
}


async function clickGenerateAndWait(
  page: Page,
  _timeoutMs: number,
  label: string
): Promise<void> {
  await selectors.generateButton(page).first().click();

  await waitForGenerationToFinish(
    page,
    label
  );
}


async function attemptGenerateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel,
  onPromptReady?: (fullPrompt: string) => Promise<void>
): Promise<void> {
  const projectContext = await getStoredProjectContext(page);

  const finalPrompt = projectContext
    ? [
        projectContext,
        "",
        "CURRENT PAGE PROMPT:",
        prompt,
      ].join("\n")
    : prompt;


  const promptInput = await waitForPromptInput(page);

  await promptInput.fill(finalPrompt);


  await new Promise((resolve) =>
    setTimeout(resolve, 750)
  );


  await saveGenerationInputScreenshot(page);

  if (onPromptReady) {
    await onPromptReady(finalPrompt);
  }


  await clickGenerateAndWait(
    page,
    config.timeouts.generateByLevel[level],
    "desktop generation"
  );
}


export async function generateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel,
  onPromptReady?: (fullPrompt: string) => Promise<void>
): Promise<void> {
  log.info("Starting desktop generation...");


  await retry(
    () =>
      attemptGenerateDesktop(
        page,
        prompt,
        level,
        onPromptReady
      ),
    {
      retries: config.retries.generate,
      label: "Generate Desktop",
    }
  );


  log.info("Desktop generation finished.");
}



async function attemptGenerateMobile(
  page: Page,
  level: ProjectLevel
): Promise<void> {
  await selectors.designSurface(page).click();


  await selectors.generateButton(page)
    .first()
    .click();


  await selectors.generateMobileOption(page)
    .first()
    .click();


  await waitForGenerationToFinish(
    page,
    "mobile generation"
  );
}


export async function generateMobile(
  page: Page,
  level: ProjectLevel
): Promise<void> {
  log.info("Starting mobile generation...");


  try {
    await retry(
      () =>
        attemptGenerateMobile(
          page,
          level
        ),
      {
        retries: config.retries.generate,
        label: "Generate Mobile",
      }
    );


    log.info("Mobile generation finished.");

  } catch (err) {
    throw new MobileGenerateError(
      err instanceof Error
        ? err.message
        : String(err)
    );
  }
}
