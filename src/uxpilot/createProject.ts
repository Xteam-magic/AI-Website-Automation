import fs from "fs";
import os from "os";
import path from "path";
import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";
import { ProjectLevel, ProjectRow } from "../types";

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

/**
 * Builds the project-wide context required in the final generation prompt.
 * The Sheet specification contains Full Project Doc, Fonts, Language, Pages,
 * AI Suggestions and User Suggestions as project fields.
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

  const structuredFields = [
    ["PROJECT NAME", formatField(readField(row, ["projectName", "Project Name"]))],
    ["FULL PROJECT DOC", fullProjectDoc],
    ["DESIGN SYSTEM", formatField(readField(row, ["designSystem", "Design System"]))],
    ["BRAND DESCRIPTION", formatField(readField(row, ["brandDescription", "Brand Description"]))],
    ["COLOR PALETTE", formatField(readField(row, ["colorPalette", "Color Palette"]))],
    ["PAGES", pages],
    ["COUNT PAGE", formatField(readField(row, ["countPage", "Count Page"]))],
    ["FONTS", fonts],
    ["LANGUAGE", language],
    ["SOURCE LINKS", formatField(readField(row, ["sourceLinks", "Source Links"]))],
    ["MOBILE VERSION", formatField(readField(row, ["mobileVersion", "Mobile Version"]))],
    ["FIGMA NEEDED", formatField(readField(row, ["figmaNeeded", "Figma Needed"]))],
    ["CLIENT DEV METHOD", formatField(readField(row, ["clientDevMethod", "Client Dev Method"]))],
    ["IMPLEMENTATION", formatField(readField(row, ["implementation", "Implementation"]))],
    ["DEADLINE", formatField(readField(row, ["deadline", "Deadline"]))],
    ["AI SUGGESTIONS", aiSuggestions],
    ["USER SUGGESTIONS", userSuggestions],
  ];

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

async function appendProjectContextToComposer(
  page: Page,
  row: ProjectRow
): Promise<void> {
  const context = buildProjectPromptContext(row);
  await page.evaluate((value) => {
    (window as unknown as { __xmagicProjectPromptContext?: string }).__xmagicProjectPromptContext = value;
  }, context);

  const prompt = selectors.mainPromptInput(page).first();
  await prompt.focus();
  await prompt.fill(context);
  log.info("Project context added to the main UXPilot composer and stored for final generation.");
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
    await page.keyboard.press("Escape").catch(() => undefined);
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

  await page.keyboard.press("Escape").catch(() => undefined);
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
}
