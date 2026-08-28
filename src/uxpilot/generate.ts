import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
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
      'textarea[placeholder="Describe your design, @ to reference images or documents"]'
    ),
  sendButton: (page: Page) =>
    page.locator('button[aria-label="Send"]:visible').last(),
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
  sourceCode: (page: Page) =>
    page.getByText(/^Source Code$/i),
  generatedDesignLabels: (page: Page) =>
    page.getByText(
      /^[^\n-]+-\s*(landing|home|pricing|dashboard|about|contact|blog)/i
    ),
  generationStatusText: (page: Page) =>
    page.getByText(/generating|designing|creating|processing/i),
};

async function saveGenerationInputScreenshot(page: Page): Promise<void> {
  const screenshotsDir = path.join(process.cwd(), "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(
    screenshotsDir,
    `uxpilot-generation-input-${timestamp}.png`
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  log.info(`Generation input screenshot saved: ${screenshotPath}`);
}

async function getStoredProjectContext(page: Page): Promise<string> {
  try {
    return await page.evaluate(
      () =>
        (window as unknown as { __xmagicProjectPromptContext?: string })
          .__xmagicProjectPromptContext || ""
    );
  } catch {
    return "";
  }
}

async function composerValue(page: Page): Promise<string> {
  const input = selectors.promptInput(page).last();
  return input
    .evaluate((element) => {
      const node = element as HTMLTextAreaElement;
      return node.value || node.innerText || node.textContent || "";
    })
    .catch(() => "");
}

async function waitForPromptInput(page: Page): Promise<ReturnType<Page["locator"]>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const inputs = selectors.promptInput(page);
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = inputs.nth(i);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Could not find the visible UXPilot generation composer input.");
}

async function setFinalPageInstruction(page: Page, text: string): Promise<void> {
  let input = await waitForPromptInput(page);
  const normalizedTarget = text.replace(/\r\n/g, "\n").trim();

  await input.click();
  await input.fill(text).catch(() => undefined);

  const read = async () =>
    (await composerValue(page)).replace(/\r\n/g, "\n").trim();

  if ((await read()) === normalizedTarget) return;

  await input.evaluate((element, value) => {
    const textarea = element as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, text).catch(() => undefined);

  if ((await read()) === normalizedTarget) return;

  input = await waitForPromptInput(page);
  await input.click();
  await input.press("Control+A").catch(() => undefined);
  await input.press("Backspace").catch(() => undefined);
  await input.press("Control+V").catch(() => undefined);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await read()) === normalizedTarget) return;
    await page.waitForTimeout(250);
  }

  throw new Error(
    "UXPilot final page instruction could not be inserted into the main composer."
  );
}

async function waitForSendButtonReady(page: Page): Promise<ReturnType<Page["locator"]>> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const buttons = page.locator('button[aria-label="Send"]:visible');
    const count = await buttons.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i--) {
      const button = buttons.nth(i);
      if (await button.isEnabled().catch(() => false)) return button;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("UXPilot Send button did not become visible and enabled after the final instruction was inserted.");
}

async function getGeneratedLabelCount(page: Page): Promise<number> {
  return selectors.generatedDesignLabels(page).count().catch(() => 0);
}

async function getSourceCodeCount(page: Page): Promise<number> {
  return selectors.sourceCode(page).count().catch(() => 0);
}

async function hasRealGenerationArtifact(
  page: Page,
  baselineLabels: number,
  baselineSourceCode: number
): Promise<boolean> {
  if ((await getGeneratedLabelCount(page)) > baselineLabels) return true;
  if ((await getSourceCodeCount(page)) > baselineSourceCode) return true;

  const exportVisible =
    (await selectors.copyExportControls(page).count()) > 0 &&
    (await selectors.copyExportControls(page).first().isVisible().catch(() => false));

  // The initial UXPilot workspace already contains the canvas/preview, so those
  // generic elements are NOT considered proof that generation completed.
  return exportVisible && baselineSourceCode === 0;
}

async function waitForGenerationToFinish(
  page: Page,
  label: string,
  baselineLabels: number,
  baselineSourceCode: number
): Promise<void> {
  const startedAt = Date.now();
  let lastLogAt = startedAt;
  let artifactSeen = false;
  let generationStarted = false;

  while (true) {
    const stopVisible = await selectors.stopButton(page).first().isVisible().catch(() => false);
    const spinnerVisible = await selectors.spinner(page).first().isVisible().catch(() => false);
    const statusVisible = await selectors.generationStatusText(page).first().isVisible().catch(() => false);

    if (stopVisible || spinnerVisible || statusVisible) generationStarted = true;

    if (await hasRealGenerationArtifact(page, baselineLabels, baselineSourceCode)) {
      artifactSeen = true;
    }

    // We need an actual generated artifact. If generation-status UI is absent,
    // an artifact appearing is still sufficient; the old starter canvas is not.
    if (artifactSeen && !stopVisible && !spinnerVisible) {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      log.info(`${label} finished after ${elapsedSeconds}s.`);
      return;
    }

    const now = Date.now();
    if (now - lastLogAt >= 30_000) {
      log.info(
        `${label} is still running after ${Math.round((now - startedAt) / 1000)}s. ` +
        `generationStarted=${generationStarted}, artifactSeen=${artifactSeen}. Waiting for completion...`
      );
      lastLogAt = now;
    }

    await page.waitForTimeout(2_000);
  }
}

async function clickSendAndWait(page: Page, label: string): Promise<void> {
  const baselineLabels = await getGeneratedLabelCount(page);
  const baselineSourceCode = await getSourceCodeCount(page);

  const send = await waitForSendButtonReady(page);
  log.info('[UXPilot/Generate] Send button is visible and enabled. Clicking Send...');

  await send.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await send.click({ timeout: 10_000 });
  } catch (error) {
    log.warn(
      `Normal Send click failed; invoking the exact aria-label=Send button through the page DOM: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    await send.evaluate((element) => (element as HTMLButtonElement).click());
  }

  log.info('[UXPilot/Generate] Send clicked successfully. Waiting for generation to finish...');
  await waitForGenerationToFinish(
    page,
    label,
    baselineLabels,
    baselineSourceCode
  );
}

async function attemptGenerateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel,
  onPromptReady?: (fullPrompt: string) => Promise<void>
): Promise<void> {
  await waitForComposerUploads(page);

  const projectContext = await getStoredProjectContext(page);
  const attachmentInstruction = [
    "ATTACHED DOCUMENT INSTRUCTION:",
    "Please carefully review ALL contents of the attached document(s), including every requirement, note, explanation, content item, visual reference, constraint, and project detail. Use all relevant information from the attached document(s) when designing this page. Do not ignore, omit, or summarize away any important instruction or content from the attachment(s). Treat the attached document(s) as authoritative project material.",
  ].join("\n");

  const pageInstruction = [
    "CURRENT PAGE PROMPT:",
    prompt.trim(),
    attachmentInstruction,
  ].join("\n\n");

  // This is the canonical merged prompt. Persist it BEFORE touching the main
  // page composer so the sheet always contains the exact logical prompt that
  // will be used for this page.
  const finalLogicalPrompt = projectContext
    ? `${projectContext}\n\n${pageInstruction}`
    : pageInstruction;

  if (onPromptReady) {
    log.info("Saving Full UXPilot Project Prompt to Google Sheet before the page instruction is pasted into the composer...");
    await onPromptReady(finalLogicalPrompt);
  }

  // Only after the sheet write succeeds do we place the page instruction into
  // the visible main input.
  await setFinalPageInstruction(page, pageInstruction);
  await waitForComposerUploads(page);

  await saveGenerationInputScreenshot(page);
  await clickSendAndWait(page, "desktop generation");
}


export async function generateDesktop(
  page: Page,
  prompt: string,
  level: ProjectLevel,
  onPromptReady?: (fullPrompt: string) => Promise<void>
): Promise<void> {
  log.info("Starting desktop generation...");
  // The initial project flow was stable before the page-specific changes.
  // Keep one deterministic send attempt so a timeout after a real click cannot
  // accidentally submit the same UXPilot request twice.
  await attemptGenerateDesktop(page, prompt, level, onPromptReady);
  log.info("Desktop generation finished.");
}

const mobileSelectors = {
  generateButton: (page: Page) => page.getByRole("button", { name: /generate|send/i }),
  designSurface: (page: Page) =>
    page.locator('[data-testid*="canvas" i], [data-testid*="design-surface" i], [class*="design-surface" i], [class*="canvas" i]').first(),
  generateMobileOption: (page: Page) =>
    page.getByRole("menuitem", { name: /mobile/i }).or(page.getByText(/generate mobile version/i)),
};

async function attemptGenerateMobile(page: Page): Promise<void> {
  await mobileSelectors.designSurface(page).click();
  await mobileSelectors.generateButton(page).first().click();
  await mobileSelectors.generateMobileOption(page).first().click();
  await waitForGenerationToFinish(
    page,
    "mobile generation",
    await getGeneratedLabelCount(page),
    await getSourceCodeCount(page)
  );
}

export async function generateMobile(page: Page, _level: ProjectLevel): Promise<void> {
  log.info("Starting mobile generation...");
  try {
    await attemptGenerateMobile(page);
    log.info("Mobile generation finished.");
  } catch (err) {
    throw new MobileGenerateError(err instanceof Error ? err.message : String(err));
  }
}
