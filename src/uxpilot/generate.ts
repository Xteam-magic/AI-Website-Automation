import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";
import { ProjectLevel } from "../types";
import { waitForComposerUploads } from "./createProject";

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
      'textarea[placeholder="Describe your design, @ to reference images or documents"], [contenteditable="true"][role="textbox"], [contenteditable="true"]'
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
    page.locator(
      '[data-testid*="design-surface" i], [class*="design-surface" i]'
    ).first(),

  generatedFrameLabels: (page: Page) =>
    page.locator(".tl-frame-label:visible"),

  generationStatusText: (page: Page) =>
    page.getByText(/generating|thinking|creating|building/i).filter({ hasNotText: /what would you like to design/i }),

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


async function getVisibleGeneratedFrameCount(page: Page): Promise<number> {
  return selectors.generatedFrameLabels(page).count().catch(() => 0);
}

async function isGenerationFinished(
  page: Page,
  baselineFrameCount: number,
  generationStarted: boolean
): Promise<boolean> {
  if (!generationStarted) return false;

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

  const frameCount = await getVisibleGeneratedFrameCount(page);
  if (frameCount > baselineFrameCount) return true;

  const previewVisible =
    (await selectors.previewFrame(page).count()) > 0 &&
    (await selectors.previewFrame(page).first().isVisible().catch(() => false));

  const exportVisible =
    (await selectors.copyExportControls(page).count()) > 0 &&
    (await selectors.copyExportControls(page).first().isVisible().catch(() => false));

  const designVisible =
    (await selectors.designSurface(page).count()) > 0 &&
    (await selectors.designSurface(page).first().isVisible().catch(() => false));

  // A generic tldraw canvas exists even before generation. It is deliberately
  // excluded from the completion signal above. Preview/export/real design
  // surfaces are only considered after generation has demonstrably started.
  return previewVisible || exportVisible || designVisible;
}

async function waitForGenerationStart(
  page: Page,
  baselineFrameCount: number,
  label: string
): Promise<boolean> {
  const startedAt = Date.now();
  let lastLogAt = startedAt;

  while (true) {
    const stopVisible = await selectors.stopButton(page).first().isVisible().catch(() => false);
    const spinnerVisible = await selectors.spinner(page).first().isVisible().catch(() => false);
    const statusVisible = await selectors.generationStatusText(page).first().isVisible().catch(() => false);
    const frameCount = await getVisibleGeneratedFrameCount(page);

    if (stopVisible || spinnerVisible || statusVisible || frameCount > baselineFrameCount) {
      log.info(`${label} generation visibly started.`);
      return true;
    }

    const now = Date.now();
    if (now - startedAt >= 30_000) {
      // UXPilot can start generation without exposing a dedicated spinner.
      // At this point we still wait for a real completion artifact instead of
      // declaring success from the pre-existing tldraw canvas.
      log.warn(`${label} has not exposed a generation indicator after 30s. Continuing to wait for a generated artifact.`);
      return true;
    }

    if (now - lastLogAt >= 10_000) {
      log.info(`${label} is waiting for generation to start...`);
      lastLogAt = now;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * Waits indefinitely until UXPilot has genuinely finished generating. A
 * pre-existing tldraw canvas is not considered completion. The wait only
 * resolves after generation has started and a real generated artifact is
 * observed (new frame label, preview, export controls, or design surface).
 */
async function waitForGenerationToFinish(
  page: Page,
  label: string,
  baselineFrameCount: number,
  generationStarted: boolean
): Promise<void> {
  const startedAt = Date.now();
  let lastLogAt = startedAt;

  while (true) {
    if (await isGenerationFinished(page, baselineFrameCount, generationStarted)) {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      log.info(`${label} finished after ${elapsedSeconds}s.`);
      return;
    }

    const now = Date.now();
    if (now - lastLogAt >= 30_000) {
      const elapsedSeconds = Math.round((now - startedAt) / 1000);
      log.info(`${label} is still running after ${elapsedSeconds}s. Waiting indefinitely for completion...`);
      lastLogAt = now;
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function waitForPromptInput(
  page: Page
): Promise<ReturnType<Page["locator"]>> {
  const inputs = selectors.promptInput(page);
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const candidate = inputs.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Could not find the visible UXPilot generation composer input.");
}

async function clickGenerateAndWait(
  page: Page,
  _timeoutMs: number,
  label: string
): Promise<void> {
  const baselineFrameCount = await getVisibleGeneratedFrameCount(page);

  const button = selectors.generateButton(page).first();
  await button.waitFor({ state: "visible", timeout: 15000 });
  await button.click();

  const generationStarted = await waitForGenerationStart(
    page,
    baselineFrameCount,
    label
  );

  await waitForGenerationToFinish(
    page,
    label,
    baselineFrameCount,
    generationStarted
  );
}

async function appendFinalPageInstructionToComposer(
  page: Page,
  text: string
): Promise<void> {
  const promptInput = await waitForPromptInput(page);
  await promptInput.click({ position: { x: 40, y: 25 } });

  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+End`).catch(() => undefined);
  await page.keyboard.insertText(text);

  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  await waitUntil(
    async () => {
      const actual = (await promptInput
        .evaluate((element) => {
          const node = element as HTMLElement & { value?: string };
          return typeof node.value === "string"
            ? node.value
            : node.innerText || node.textContent || "";
        })
        .catch(() => "")).replace(/\r\n/g, "\n").trim();

      return actual.includes(normalizedText);
    },
    {
      timeoutMs: 10000,
      intervalMs: 200,
      label: "UXPilot composer to contain the final page instruction",
    }
  );
}

async function attemptGenerateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel,
  onPromptReady?: (fullPrompt: string) => Promise<void>
): Promise<void> {
  const projectContext = await getStoredProjectContext(page);

  // The project-wide context is inserted during setupProjectContext(). If it is
  // large, UXPilot automatically converts it into a document attachment. The
  // attachment must finish uploading before the page-specific text is added.
  await waitForComposerUploads(page);

  const attachmentInstruction = [
    "",
    "ATTACHED FILE(S) — IMPORTANT INSTRUCTION:",
    "Please carefully review every attached file and consider ALL items, notes, explanations, requirements, visual references, and other information contained in the attached file(s). Do not ignore or skip any part of the attached file(s). Treat their contents as authoritative project references and apply all relevant details to the current page design.",
  ].join("\n");

  const pageInstruction = [
    "",
    "CURRENT PAGE PROMPT:",
    prompt,
    attachmentInstruction,
  ].join("\n");

  // Keep a canonical copy of the exact logical prompt that will be submitted:
  // project context + current page prompt + attachment instruction. The
  // project context itself may be represented in UXPilot as a document chip,
  // while this page-specific block remains as text in the composer.
  const finalPrompt = projectContext
    ? [projectContext, pageInstruction].join("\n")
    : prompt + attachmentInstruction;

  await appendFinalPageInstructionToComposer(page, pageInstruction);

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
  const baselineFrameCount = await getVisibleGeneratedFrameCount(page);

  await selectors.designSurface(page).click();

  await selectors.generateButton(page)
    .first()
    .click();

  await selectors.generateMobileOption(page)
    .first()
    .click();

  const generationStarted = await waitForGenerationStart(
    page,
    baselineFrameCount,
    "mobile generation"
  );

  await waitForGenerationToFinish(
    page,
    "mobile generation",
    baselineFrameCount,
    generationStarted
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
