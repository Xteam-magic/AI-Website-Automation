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

  const generatedFrameCount = await page
    .locator('[class*="tl-frame-label" i]')
    .filter({ visible: true })
    .count()
    .catch(() => 0);

  if (generatedFrameCount > 0) return true;

  const sourceCodeButton = page
    .getByRole("button", { name: /source code/i })
    .or(page.locator('button[title*="source code" i]'))
    .or(page.locator('button:has(svg[class*="lucide-code" i])'))
    .first();

  if (
    (await sourceCodeButton.count()) > 0 &&
    (await sourceCodeButton.isVisible().catch(() => false))
  ) {
    return true;
  }

  return false;
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


async function waitForAttachmentUploadToFinish(page: Page): Promise<void> {
  const startedAt = Date.now();
  let sawUploading = false;
  let lastLogAt = startedAt;

  while (true) {
    const state = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const uploading = /\bUploading(?:\.{0,3})?\b/i.test(bodyText);

      const attachmentVisible = Array.from(
        document.querySelectorAll("button, [role=button], [data-testid], span, div")
      ).some((element) => {
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        if (
          !/pasted-document/i.test(text) &&
          !/\.(docx|pdf|md|txt|png|jpe?g|webp)$/i.test(text)
        ) {
          return false;
        }
        const rect = (element as HTMLElement).getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      });

      return { uploading, attachmentVisible };
    });

    if (state.uploading) sawUploading = true;

    if (!state.uploading && (state.attachmentVisible || sawUploading)) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const stillUploading = await page.evaluate(() =>
        /\bUploading(?:\.{0,3})?\b/i.test(
          (document.body?.innerText || "").replace(/\s+/g, " ").trim()
        )
      );

      if (!stillUploading) {
        log.info("UXPilot attachment upload completed; continuing to final page instruction.");
        return;
      }
    }

    const now = Date.now();
    if (now - lastLogAt >= 15_000) {
      log.info(
        `Waiting for UXPilot attachment upload to finish after ${Math.round(
          (now - startedAt) / 1000
        )}s...`
      );
      lastLogAt = now;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

const ATTACHED_DOCUMENT_INSTRUCTION = [
  "IMPORTANT: The attached document contains the complete project information, requirements, content, constraints, design guidance, specifications, and all other relevant details.",
  "Treat the attached document as the authoritative source. Carefully use every relevant piece of information from it and do not omit, ignore, or replace any applicable detail when designing this page.",
].join("\n");

async function clickSendAndWaitForGeneration(
  page: Page,
  label: string
): Promise<void> {
  const sendButton = page.locator('button[aria-label="Send"]').first();

  await sendButton.waitFor({
    state: "visible",
    timeout: 30000,
  });

  await page.waitForFunction(() => {
    const button = document.querySelector(
      'button[aria-label="Send"]'
    ) as HTMLButtonElement | null;
    return Boolean(button && !button.disabled);
  }, undefined, { timeout: 30000 });

  log.info("Send button is visible and enabled. Clicking Send...");
  await sendButton.click();
  log.info("Send clicked successfully. Waiting for the real design generation to finish...");

  await waitForGenerationToFinish(page, label);
}

async function attemptGenerateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel,
  onPromptReady?: (fullPrompt: string) => Promise<void>
): Promise<void> {
  await waitForAttachmentUploadToFinish(page);

  const finalPrompt = [
    ATTACHED_DOCUMENT_INSTRUCTION,
    "",
    "CURRENT PAGE PROMPT:",
    prompt,
  ].join("\n");

  const promptInput = await waitForPromptInput(page);
  await promptInput.focus();
  await promptInput.fill(finalPrompt);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  await saveGenerationInputScreenshot(page);

  if (onPromptReady) {
    await onPromptReady(finalPrompt);
  }

  await clickSendAndWaitForGeneration(
    page,
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
