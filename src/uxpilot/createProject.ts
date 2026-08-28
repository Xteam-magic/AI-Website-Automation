import fs from "fs";
import os from "os";
import path from "path";
import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";
import { ProjectLevel, ProjectRow } from "../types";
import { googleSheetService } from "../sheet/googleSheet";

const log = logger.scope("UXPilot/CreateProject");

const selectors = {
  createNewButton: (page: Page) =>
    page.getByRole("button", { name: /^create new$/i }),
  createFileOption: (page: Page) =>
    page.getByRole("menuitem", { name: /^create new file$/i }),
  projectNameInput: (page: Page) =>
    page.getByLabel(/^File Name$/i),
  fileContextInput: (page: Page) =>
    page.getByPlaceholder(/Example: Use dark theme colors/i),
  createConfirmButton: (page: Page) =>
    page.getByRole("button", { name: /^create$/i }),
  editorReadyIndicator: (page: Page) =>
    page.getByRole("button", { name: /generate|send/i }),
  maybeLaterButton: (page: Page) =>
    page.getByRole("button", { name: /^maybe later$/i }),
  modelDropdown: (page: Page) =>
    page.getByRole("button", {
      name: /^(Standard|Max|Glide|Glide Pro)$/i,
    }),
  modelSlider: (page: Page) =>
    page.locator("div.relative.cursor-pointer.touch-none").last(),
  mainPromptInput: (page: Page) =>
    page.locator(
      'textarea[placeholder="Describe your design, @ to reference images or documents"]'
    ),
  composerToolbar: (page: Page) =>
    page.locator('[data-testid="chat-composer-toolbar"]').first(),
  addWebsiteButton: (page: Page) =>
    page.getByRole("button", { name: /add website( link)?/i }),
  websiteUrlInput: (page: Page) =>
    page
      .getByPlaceholder(/https?:\/\//i)
      .or(page.getByLabel(/website|url/i)),
  addConfirmButton: (page: Page) =>
    page.getByRole("button", { name: /^add$/i }),
  websiteImportDoneIndicator: (page: Page) =>
    page.getByText(/imported|import complete/i),
  uploadImagesTrigger: (page: Page) =>
    page.getByRole("button", {
      name: /upload image|add image|reference image/i,
    }),
};

const MODEL_ORDER = [
  "Standard",
  "Max",
  "Glide",
  "Glide Pro",
] as const;

const MODEL_ALIASES: Record<string, string> = {
  Fast: "Standard",
};

type FlexibleProjectRow = ProjectRow & Record<string, unknown>;

function readField(row: ProjectRow, keys: string[]): unknown {
  const data = row as FlexibleProjectRow;
  for (const key of keys) {
    const value = data[key];
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }
  return "";
}

function formatField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).trim();
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readRawColumn(row: ProjectRow, aliases: string[]): string {
  const rawColumns = (row as FlexibleProjectRow).rawColumns;
  if (!rawColumns || typeof rawColumns !== "object") return "";

  const wanted = aliases.map(normalizeHeader);
  for (const [header, value] of Object.entries(rawColumns)) {
    if (wanted.includes(normalizeHeader(header))) {
      return formatField(value);
    }
  }
  return "";
}

/**
 * Some live-sheet columns are intentionally not part of the fixed ProjectRow
 * interface. Include only additional fields that can materially improve UI/UX
 * generation, while excluding credentials, operational state, billing and
 * workflow-control columns from the UXPilot prompt.
 */
function collectAdditionalDesignContext(row: ProjectRow): Array<[string, string]> {
  const rawColumns = (row as FlexibleProjectRow).rawColumns;
  if (!rawColumns || typeof rawColumns !== "object") return [];

  const knownHeaders = new Set(
    [
      "Project ID",
      "Status",
      "Project Name",
      "Required Project Level",
      "User ID",
      "User Name",
      "User Phone",
      "User Email",
      "Full Project Doc",
      "Design System",
      "Brand Description",
      "Color Palette",
      "Static Content",
      "Pages",
      "Count Page",
      "Fonts",
      "Language",
      "Source Links",
      "Source Images",
      "Logo URL",
      "Figma Needed",
      "Mobile Version",
      "Client Dev Method",
      "Deadline",
      "AI Suggestions",
      "User Suggestions",
      "Design URL",
      "HTML File",
      "JSON File",
      "Edits After Design",
      "Payment Status",
      "User Rate",
      "Project Cost",
      "UX Pilot Account",
      "CONV Elementor Account",
      "AI Token Account",
      "AI Engine Note",
      "Current Step",
      "Current Page",
      "Last Run Time",
      "Last Finished Time",
      "Run ID",
      "Retry Count",
      "Last Error",
      "Full Logs",
      "Full UXPilot Project Prompt",
    ].map(normalizeHeader),
  );

  const excludedTokens = [
    "password",
    "secret",
    "token",
    "account",
    "credential",
    "api key",
    "email",
    "phone",
    "user id",
    "payment",
    "cost",
    "rate",
    "status",
    "current step",
    "current page",
    "last run",
    "last finished",
    "run id",
    "retry",
    "error",
    "full logs",
    "design url",
    "html file",
    "json file",
    "edit after design",
  ];

  const designTokens = [
    "content",
    "copy",
    "text",
    "description",
    "requirement",
    "goal",
    "objective",
    "audience",
    "persona",
    "feature",
    "function",
    "cta",
    "tone",
    "voice",
    "style",
    "visual",
    "layout",
    "navigation",
    "menu",
    "brand",
    "design",
    "color",
    "font",
    "language",
    "reference",
    "inspiration",
    "competitor",
    "asset",
    "image",
    "icon",
    "logo",
    "mobile",
    "responsive",
    "accessibility",
    "seo",
    "static",
    "content strategy",
    "section",
    "page",
  ];

  const results: Array<[string, string]> = [];
  for (const [header, rawValue] of Object.entries(rawColumns)) {
    const normalized = normalizeHeader(header);
    if (!normalized || knownHeaders.has(normalized)) continue;
    if (excludedTokens.some((token) => normalized.includes(token))) continue;
    if (!designTokens.some((token) => normalized.includes(token))) continue;

    const value = formatField(rawValue);
    if (!value) continue;
    results.push([header.toUpperCase(), value]);
  }

  return results;
}

/**
 * Builds the project-wide context required in the final generation prompt.
 * All project information that can improve visual/design accuracy is preserved,
 * including Static Content and additional live-sheet design/content columns.
 */
export function buildProjectPromptContext(row: ProjectRow): string {
  const fullProjectDoc = formatField(
    readField(row, ["fullProjectDoc", "Full Project Doc", "full_project_doc"])
  );
  const pages = formatField(readField(row, ["pages", "Pages"]));
  const fonts = formatField(readField(row, ["fonts", "font", "Fonts", "Font"]));
  const language = formatField(readField(row, ["language", "Language"]));
  const aiSuggestions = formatField(
    readField(row, ["aiSuggestions", "aiSuggestion", "AI Suggestions", "AI Suggestion", "ai_suggestions"])
  );
  const userSuggestions = formatField(
    readField(row, ["userSuggestions", "userSuggestion", "User Suggestions", "User Suggestion", "user_suggestions"])
  );
  const staticContent = readRawColumn(row, [
    "Static Content",
    "Static content",
    "staticContent",
    "static_content",
  ]);
  const sourceImages = formatField(readField(row, ["sourceImages", "Source Images"]));
  const logoUrl = formatField(readField(row, ["logoUrl", "Logo URL"]));
  const additionalDesignContext = collectAdditionalDesignContext(row);

  const structuredFields: Array<[string, string]> = [
    ["PROJECT NAME", formatField(readField(row, ["projectName", "Project Name"]))],
    ["FULL PROJECT DOC", fullProjectDoc],
    ["DESIGN SYSTEM", formatField(readField(row, ["designSystem", "Design System"]))],
    ["BRAND DESCRIPTION", formatField(readField(row, ["brandDescription", "Brand Description"]))],
    ["STATIC CONTENT", staticContent],
    ["COLOR PALETTE", formatField(readField(row, ["colorPalette", "Color Palette"]))],
    ["PAGES", pages],
    ["COUNT PAGE", formatField(readField(row, ["countPage", "Count Page"]))],
    ["FONTS", fonts],
    ["LANGUAGE", language],
    ["SOURCE LINKS", formatField(readField(row, ["sourceLinks", "Source Links"]))],
    ["SOURCE IMAGES", sourceImages],
    ["LOGO URL", logoUrl],
    ["MOBILE VERSION", formatField(readField(row, ["mobileVersion", "Mobile Version"]))],
    ["FIGMA NEEDED", formatField(readField(row, ["figmaNeeded", "Figma Needed"]))],
    ["CLIENT DEV METHOD", formatField(readField(row, ["clientDevMethod", "Client Dev Method"]))],
    ["IMPLEMENTATION", formatField(readField(row, ["implementation", "Implementation"]))],
    ["DEADLINE", formatField(readField(row, ["deadline", "Deadline"]))],
    ["AI SUGGESTIONS", aiSuggestions],
    ["USER SUGGESTIONS", userSuggestions],
  ];

  structuredFields.push(...additionalDesignContext);

  return [
    "PROJECT CONTEXT",
    "",
    ...structuredFields.flatMap(([label, value]) => [`${label}:`, value || "(empty)", ""]),
    "RULE: The current page is generated independently. Do not collapse multiple pages into one screen.",
    "RULE: Keep all supplied project constraints; page-specific instructions are authoritative only for the current page.",
  ].join("\n");
}

async function downloadToTempFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download "${url}": HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = path.extname(new URL(url).pathname) || ".png";
  const filePath = path.join(
    os.tmpdir(),
    `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`
  );
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function resolveImageUrl(page: Page, originalUrl: string): Promise<string> {
  try {
    const parsed = new URL(originalUrl);
    const imgUrl = parsed.searchParams.get("imgurl");
    if (imgUrl) return decodeURIComponent(imgUrl);
  } catch {
    // Continue with DOM resolution.
  }

  const visibleImages = page.locator("img:visible");
  if ((await visibleImages.count()) > 0) {
    const src = await visibleImages.first().getAttribute("src");
    if (src) return new URL(src, page.url()).href;
  }

  const ogImage = page.locator('meta[property="og:image"]');
  if ((await ogImage.count()) > 0) {
    const content = await ogImage.first().getAttribute("content");
    if (content) return new URL(content, page.url()).href;
  }

  return originalUrl;
}

async function downloadLogoImage(page: Page, logoUrl: string): Promise<string> {
  log.info("Opening logo URL in a new page...");
  const logoPage = await page.context().newPage();
  try {
    await logoPage.goto(logoUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await logoPage.waitForLoadState("networkidle").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const imageUrl = await resolveImageUrl(logoPage, logoUrl);
    log.info(`Resolved logo image URL: ${imageUrl}`);
    return await downloadToTempFile(imageUrl);
  } finally {
    await logoPage.close().catch(() => undefined);
  }
}

async function uploadFileThroughComposer(page: Page, localPath: string): Promise<void> {
  const toolbar = selectors.composerToolbar(page);
  await toolbar.waitFor({ state: "visible", timeout: 10000 });

  const buttons = toolbar.getByRole("button");
  if ((await buttons.count()) === 0) {
    throw new Error("Could not find the attachment (+) button in the UXPilot composer.");
  }

  const addButton = buttons.first();
  log.info("Opening UXPilot composer attachment menu...");
  await addButton.click();

  const fileInputs = page.locator('input[type="file"]');
  if ((await fileInputs.count()) > 0) {
    await fileInputs.last().setInputFiles(localPath);
    log.info("Logo file selected through UXPilot file input.");
    return;
  }

  const uploadOption = page
    .getByRole("menuitem", {
      name: /upload.*(file|image)|add.*(file|image)|attach/i,
    })
    .or(
      page.getByText(
        /upload.*(file|image)|add.*(file|image)|attach/i
      )
    )
    .first();

  await uploadOption.waitFor({ state: "visible", timeout: 5000 });
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", {
      timeout: config.timeouts.imageUploadMs,
    }),
    uploadOption.click(),
  ]);
  await fileChooser.setFiles(localPath);
  log.info("Logo file uploaded through UXPilot attachment menu.");
}

async function waitForComposerAttachment(page: Page): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await selectors.mainPromptInput(page).waitFor({
    state: "visible",
    timeout: 10000,
  });
}

async function isVisible(locator: ReturnType<Page["locator"]>): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function closeModelPicker(page: Page): Promise<void> {
  const slider = selectors.modelSlider(page).first();

  // Keep the original Escape behavior, but do not rely on it.
  await page.keyboard.press("Escape").catch(() => undefined);

  if (!(await isVisible(slider))) {
    return;
  }

  log.info("Model picker is still open after Escape. Clicking outside the picker...");

  // Never use locator.click() here. The editor canvas is backed by a tldraw
  // hit-test layer that can intercept DOM locator clicks even when the target
  // element is visible. A real viewport mouse click reproduces UXPilot's
  // outside-click dismissal behavior reliably.
  const viewport = page.viewportSize();
  const width = viewport?.width ?? 1440;
  const height = viewport?.height ?? 900;

  // These points are intentionally outside the model picker and away from
  // the composer controls. Try more than one point because responsive layout
  // can shift the picker slightly between runs.
  const outsidePoints: Array<[number, number]> = [
    [Math.floor(width * 0.72), Math.floor(height * 0.22)],
    [Math.floor(width * 0.82), Math.floor(height * 0.42)],
    [Math.floor(width * 0.60), Math.floor(height * 0.18)],
  ];

  let closed = false;
  for (const [x, y] of outsidePoints) {
    if (!(await isVisible(slider))) {
      closed = true;
      break;
    }

    log.info(`Clicking outside model picker at (${x}, ${y})...`);
    await page.mouse.click(x, y);
    await new Promise((resolve) => setTimeout(resolve, 350));

    if (!(await isVisible(slider))) {
      closed = true;
      break;
    }
  }

  if (!closed) {
    await waitUntil(
      async () => !(await isVisible(slider)),
      {
        timeoutMs: 3000,
        intervalMs: 100,
        label: "UXPilot model picker to close",
      }
    );
  }

  log.info("Model picker closed successfully.");
}

async function composerTextValue(page: Page): Promise<string> {
  const prompt = selectors.mainPromptInput(page).first();
  return prompt
    .evaluate((element) => {
      const node = element as HTMLTextAreaElement;
      return node.value || node.innerText || node.textContent || "";
    })
    .catch(() => "");
}

async function isComposerUploadBusy(page: Page): Promise<boolean> {
  // Do NOT inspect the whole body or generic [data-testid*=upload] nodes.
  // UXPilot keeps permanent upload controls in the DOM, which would make a
  // completed attachment look busy forever. Only visible, explicitly busy
  // indicators are considered.
  const busySelectors = [
    '[aria-label*="uploading" i]',
    '[aria-label*="processing" i]',
    '[aria-label*="preparing" i]',
    '[aria-label*="converting" i]',
    '[data-testid*="uploading" i]',
    '[data-testid*="processing" i]',
    '[data-testid*="preparing" i]',
    '[data-testid*="converting" i]',
    '[role="progressbar"]',
  ];

  for (const selector of busySelectors) {
    const nodes = page.locator(selector);
    const count = await nodes.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      if (await nodes.nth(i).isVisible().catch(() => false)) {
        return true;
      }
    }
  }

  const visibleBusyText = page
    .locator('button, [role="status"], [role="alert"], [aria-live], div, span')
    .filter({ hasText: /^(\s*)?(Uploading(?:\.\.\.)?|Processing(?:\.\.\.)?|Preparing(?:\.\.\.)?|Converting(?:\.\.\.)?)(\s*)?$/i });

  const count = await visibleBusyText.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    if (await visibleBusyText.nth(i).isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function hasComposerAttachment(page: Page): Promise<boolean> {
  const attachmentText = await page.locator(
    'button, [role="button"], [data-testid], span, div'
  ).filter({ hasText: /pasted-document\.docx|\.docx$|\.pdf$|\.png$|\.jpg$|\.jpeg$|attached document/i }).count().catch(() => 0);
  return attachmentText > 0;
}

/**
 * UXPilot converts sufficiently large composer input into an uploaded document.
 * The visible textarea then no longer contains the original full text. Therefore
 * success is based on either the full text remaining in the textarea OR the
 * attachment/document chip appearing, followed by a real upload-settle wait.
 */
export async function waitForComposerUploads(page: Page): Promise<void> {
  const start = Date.now();
  const discoveryTimeout = 20_000;
  let attachmentSeen = false;
  let busySeen = false;
  let quietChecks = 0;

  while (Date.now() - start < discoveryTimeout) {
    attachmentSeen = attachmentSeen || await hasComposerAttachment(page);
    busySeen = busySeen || await isComposerUploadBusy(page);
    const value = await composerTextValue(page);

    if (attachmentSeen || busySeen || value.trim().length > 0) {
      break;
    }
    await page.waitForTimeout(250);
  }

  const settleDeadline = Date.now() + 120_000;
  while (Date.now() < settleDeadline) {
    const busy = await isComposerUploadBusy(page);
    attachmentSeen = attachmentSeen || await hasComposerAttachment(page);

    if (!busy) {
      quietChecks += 1;
      if (quietChecks >= 3) {
        await page.waitForTimeout(700);
        log.info(
          attachmentSeen
            ? "UXPilot composer attachment upload completed and settled."
            : "No visible UXPilot upload indicator found; composer settled and is ready for the next instruction."
        );
        return;
      }
    } else {
      quietChecks = 0;
      log.info("UXPilot composer is still uploading/processing; waiting...");
    }

    await page.waitForTimeout(500);
  }

  throw new Error("Timed out waiting for UXPilot composer attachments to finish uploading/processing.");
}

async function pasteProjectContext(page: Page, text: string): Promise<void> {
  const input = selectors.mainPromptInput(page).first();
  await input.waitFor({ state: "visible", timeout: 15_000 });

  await input.click();
  await input.press("Control+A").catch(() => undefined);
  await input.press("Backspace").catch(() => undefined);

  let pasted = false;
  try {
    pasted = await page.evaluate(async (value) => {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return false;
      }
    }, text);
  } catch {
    pasted = false;
  }

  log.info(`Pasting full project context into UXPilot composer (${text.length} chars)...`);
  if (pasted) {
    await input.press("Control+V").catch(() => undefined);
  } else {
    await input.fill(text);
  }

  // The large context is intentionally pasted only once. UXPilot may turn it
  // into pasted-document.docx; re-writing the textarea while that conversion
  // is in progress can cancel/reset the upload.
  const startedAt = Date.now();
  const deadline = startedAt + 180_000;
  let attachmentSeen = false;
  let lastLogAt = startedAt;

  while (Date.now() < deadline) {
    attachmentSeen = attachmentSeen || await hasComposerAttachment(page);
    const busy = await isComposerUploadBusy(page);
    const current = await composerTextValue(page);
    const textAccepted = current.trim() === text.trim();

    if (attachmentSeen) {
      log.info("UXPilot converted the large project context into a document attachment; continuing without rewriting the composer.");
      return;
    }

    if (textAccepted && !busy) {
      log.info("UXPilot retained the full project context as composer text.");
      return;
    }

    const now = Date.now();
    if (now - lastLogAt >= 10_000) {
      log.info(
        `Waiting for UXPilot project-context paste to settle (attachment=${attachmentSeen}, uploadBusy=${busy}, textareaChars=${current.length})...`
      );
      lastLogAt = now;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    "Timed out waiting for UXPilot to accept the full project context after the single paste operation."
  );
}

async function appendProjectContextToComposer(page: Page, row: ProjectRow): Promise<void> {
  const context = buildProjectPromptContext(row);

  // Persist the exact project-level merged document BEFORE it is pasted into
  // UXPilot. At the later page-generation stage this same Sheet column is
  // updated again with the page-specific final logical prompt.
  const promptHeader = row.headers.find((header) => {
    const normalized = normalizeHeader(header);
    return (
      normalized === "full ux pilio project prompt" ||
      normalized === "full uxpilot project prompt"
    );
  });

  if (promptHeader) {
    log.info("Saving the exact project-level UXPilot prompt to Google Sheet BEFORE pasting it into the main composer...");
    await googleSheetService.updateColumnByHeader(
      row.rowNumber,
      promptHeader,
      context
    );
    (row as ProjectRow & { fullUxPilotProjectPrompt?: string }).fullUxPilotProjectPrompt = context;
  }

  await page.evaluate((value) => {
    (window as unknown as { __xmagicProjectPromptContext?: string }).__xmagicProjectPromptContext = value;
  }, context);

  await closeModelPicker(page);
  await pasteProjectContext(page, context);

  log.info(
    `Project context accepted by the UXPilot composer (${context.length} chars), as text or an auto-converted document.`
  );
}

async function dismissOptionalPopup(page: Page): Promise<void> {
  const maybeLater = selectors.maybeLaterButton(page).first();
  try {
    await maybeLater.waitFor({ state: "visible", timeout: 5000 });
    log.info("Optional UXPilot popup detected. Clicking 'Maybe Later'...");
    await maybeLater.click();
    await maybeLater.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {
    log.info("No optional UXPilot popup detected.");
  }
}

function normalizeModelName(modelName: string): string {
  const normalized = MODEL_ALIASES[modelName] ?? modelName;
  const match = MODEL_ORDER.find(
    (model) => model.toLowerCase() === normalized.toLowerCase()
  );
  if (!match) {
    throw new Error(
      `Unsupported UXPilot model "${modelName}". Available models: ${MODEL_ORDER.join(", ")}`
    );
  }
  return match;
}

async function getCurrentModel(page: Page): Promise<string> {
  const button = selectors.modelDropdown(page).first();
  const text = (await button.innerText()).trim();
  const match = MODEL_ORDER.find(
    (model) => model.toLowerCase() === text.toLowerCase()
  );
  if (!match) {
    throw new Error(`Unable to determine current UXPilot model from "${text}".`);
  }
  return match;
}

async function selectModelUsingSlider(page: Page, targetModel: string): Promise<void> {
  const currentModel = await getCurrentModel(page);
  const currentIndex = MODEL_ORDER.indexOf(
    currentModel as (typeof MODEL_ORDER)[number]
  );
  const targetIndex = MODEL_ORDER.indexOf(
    targetModel as (typeof MODEL_ORDER)[number]
  );

  if (currentIndex === -1 || targetIndex === -1) {
    throw new Error(
      `Invalid model transition: "${currentModel}" -> "${targetModel}".`
    );
  }

  if (currentIndex === targetIndex) {
    await closeModelPicker(page);
    return;
  }

  const slider = selectors.modelSlider(page).first();
  await slider.waitFor({ state: "visible", timeout: 5000 });
  const box = await slider.boundingBox();
  if (!box) {
    throw new Error("Unable to determine model slider position.");
  }

  const thumbWidth = 28;
  const usableWidth = Math.max(box.width - thumbWidth, 1);
  const stepWidth = usableWidth / (MODEL_ORDER.length - 1);
  const targetX = box.x + thumbWidth / 2 + stepWidth * targetIndex;
  const targetY = box.y + box.height / 2;

  log.info(`Moving model from "${currentModel}" to "${targetModel}"...`);
  await page.mouse.click(targetX, targetY);

  await waitUntil(
    async () => {
      try {
        return (
          await getCurrentModel(page)
        ).toLowerCase() === targetModel.toLowerCase();
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 5000,
      intervalMs: 200,
      label: `model "${targetModel}"`,
    }
  );

  await closeModelPicker(page);
  log.info(`Model "${targetModel}" selected successfully.`);
}

export async function createProject(
  page: Page,
  row: ProjectRow
): Promise<void> {
  log.info(`Creating project "${row.projectName}"...`);
  await dismissOptionalPopup(page);
  await selectors.createNewButton(page).first().click();
  await dismissOptionalPopup(page);
  await selectors.createFileOption(page).first().click();
  await selectors.projectNameInput(page).first().fill(row.projectName);
  await selectors.fileContextInput(page).first().fill(row.designSystem);
  await selectors.createConfirmButton(page).first().click();

  await waitUntil(
    async () =>
      (await selectors.editorReadyIndicator(page).count()) > 0,
    {
      timeoutMs: config.timeouts.createProjectMs,
      label: "UXPilot project editor to open",
    }
  );

  await dismissOptionalPopup(page);
  log.info("Project created and editor is open.");
}

export async function selectModel(
  page: Page,
  level: ProjectLevel
): Promise<void> {
  const configuredModel = config.modelByLevel[level];
  const targetModel = normalizeModelName(configuredModel);
  log.info(`Selecting model "${targetModel}" for level "${level}"...`);
  await selectors.modelDropdown(page).first().click();
  await selectModelUsingSlider(page, targetModel);
  await new Promise((resolve) =>
    setTimeout(resolve, config.timeouts.modelSelectSettleMs)
  );
}

export async function addWebsiteLink(
  page: Page,
  url: string
): Promise<void> {
  if (!url || url.trim().length === 0) return;

  log.info(`Adding reference website: ${url}`);
  await selectors.addWebsiteButton(page).first().click();
  await selectors.websiteUrlInput(page).first().fill(url.trim());
  await selectors.addConfirmButton(page).first().click();

  await waitUntil(
    async () =>
      (await selectors.websiteImportDoneIndicator(page).count()) > 0,
    {
      timeoutMs: config.timeouts.websiteImportMs,
      label: "website import to finish",
    }
  );
}

export async function uploadLogo(
  page: Page,
  logoUrl: string
): Promise<void> {
  if (!logoUrl || logoUrl.trim().length === 0) return;

  log.info("Downloading brand logo...");
  const localPath = await downloadLogoImage(page, logoUrl.trim());
  await uploadFileThroughComposer(page, localPath);
  await waitForComposerAttachment(page);
  log.info("Brand logo added to the UXPilot composer.");
}

export async function uploadSourceImages(
  page: Page,
  imageUrls: string[]
): Promise<void> {
  for (const url of imageUrls) {
    log.info(`Uploading reference image: ${url}`);
    await retry(
      async () => {
        const trigger = selectors.uploadImagesTrigger(page).first();
        await trigger.click();
        const localPath = await downloadToTempFile(url);
        const fileInputs = page.locator('input[type="file"]');

        if ((await fileInputs.count()) > 0) {
          await fileInputs.last().setInputFiles(localPath);
          return;
        }

        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser", {
            timeout: config.timeouts.imageUploadMs,
          }),
          trigger.click({ trial: true }).catch(() => undefined),
        ]);
        await fileChooser.setFiles(localPath);
      },
      {
        retries: config.retries.upload,
        label: `Upload image: ${url}`,
      }
    );
  }
}

/**
 * Runs the context stage in the required order.
 * The exported buildProjectPromptContext() is intended to be reused by
 * generate.ts so the same full project context survives the final fill().
 */
export async function setupProjectContext(
  page: Page,
  row: ProjectRow
): Promise<void> {
  await createProject(page, row);
  await selectModel(page, row.requiredProjectLevel);
  await addWebsiteLink(page, row.sourceLinks);
  await uploadLogo(page, row.logoUrl);
  await appendProjectContextToComposer(page, row);
  await uploadSourceImages(page, row.sourceImages);
  // All attachments must finish uploading before generation starts. The
  // upload detector below only considers visible, explicit busy indicators.
  await waitForComposerUploads(page);
}
