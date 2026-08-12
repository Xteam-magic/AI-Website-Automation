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

/**
 * SELECTOR NOTES — same caveat as login.ts: unverified against the live
 * DOM. Isolated here so a failed first run can be fixed by editing only
 * this object.
 */
const selectors = {
  createNewButton: (page: Page) => page.getByRole("button", { name: /create new/i }),
  createFileOption: (page: Page) => page.getByRole("menuitem", { name: /create (new )?file/i }).or(page.getByText(/create file/i)),
  projectNameInput: (page: Page) =>
  page.getByLabel(/^File Name$/i),

fileContextInput: (page: Page) =>
  page.getByLabel(/^File Context$/i),
  createConfirmButton: (page: Page) => page.getByRole("button", { name: /^create$/i }),
  editorReadyIndicator: (page: Page) => page.getByRole("button", { name: /generate|send/i }),
  maybeLaterButton: (page: Page) =>
  page.getByRole("button", { name: /^maybe later$/i }),

  modelDropdown: (page: Page) => page.getByRole("button", { name: /model/i }).or(page.getByLabel(/model/i)),
  modelOption: (page: Page, modelName: string) => page.getByRole("option", { name: new RegExp(modelName, "i") }),

  addWebsiteButton: (page: Page) => page.getByRole("button", { name: /add website( link)?/i }),
  websiteUrlInput: (page: Page) => page.getByPlaceholder(/https?:\/\//i).or(page.getByLabel(/website|url/i)),
  addConfirmButton: (page: Page) => page.getByRole("button", { name: /^add$/i }),
  websiteImportDoneIndicator: (page: Page) => page.getByText(/imported|import complete/i),

  uploadLogoTrigger: (page: Page) => page.getByRole("button", { name: /upload logo|logo/i }),
  uploadImagesTrigger: (page: Page) => page.getByRole("button", { name: /upload image|add image|reference image/i }),
};

async function downloadToTempFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download "${url}": HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = path.extname(new URL(url).pathname) || ".png";
  const filePath = path.join(os.tmpdir(), `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Uploads a single image by URL. UXPilot's exact upload widget is unknown
 * (URL-paste field vs. native file picker), so this tries a URL-paste field
 * first and falls back to downloading the image and using the OS file
 * chooser — the same two options a human would have.
 */
async function uploadImageByUrl(page: Page, triggerLocator: ReturnType<typeof selectors.uploadLogoTrigger>, imageUrl: string): Promise<void> {
  await retry(
    async () => {
      await triggerLocator.first().click();

      const urlField = page.getByPlaceholder(/https?:\/\//i);
      if (await urlField.count() > 0) {
        await urlField.first().fill(imageUrl);
        await page.keyboard.press("Enter");
        return;
      }

      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: config.timeouts.imageUploadMs }),
        // The trigger click above should have already opened the chooser in
        // most native <input type="file"> implementations; if not, this
        // second click is a harmless no-op retry of the same action.
        triggerLocator.first().click({ trial: true }).catch(() => undefined),
      ]);
      const localPath = await downloadToTempFile(imageUrl);
      await fileChooser.setFiles(localPath);
    },
    { retries: config.retries.upload, label: `Upload image: ${imageUrl}` }
  );
}

async function dismissOptionalPopup(page: Page): Promise<void> {
  const maybeLaterButton = selectors.maybeLaterButton(page);

  if ((await maybeLaterButton.count()) > 0) {
    log.info("Optional UXPilot popup detected. Clicking 'Maybe Later'...");
    await maybeLaterButton.first().click();
    return;
  }

  log.info("No optional popup detected. Continuing...");
}

/** Creates the new UXPilot project file and waits for the editor to open. */
export async function createProject(page: Page, row: ProjectRow): Promise<void> {
  log.info(`Creating project "${row.projectName}"...`);

  await selectors.createNewButton(page).first().click();
  await selectors.createFileOption(page).first().click();
  await selectors.projectNameInput(page).first().fill(row.projectName);
  await selectors.fileContextInput(page).first().fill(row.designSystem);
  await selectors.createConfirmButton(page).first().click();

  await waitUntil(async () => (await selectors.editorReadyIndicator(page).count()) > 0, {
    timeoutMs: config.timeouts.createProjectMs,
    label: "UXPilot project editor to open",
  });

  await dismissOptionalPopup(page);

  log.info("Project created and editor is open.");
}

/** Selects the generation model matching the project's Required Project Level. */
export async function selectModel(page: Page, level: ProjectLevel): Promise<void> {
  const modelName = config.modelByLevel[level];
  log.info(`Selecting model "${modelName}" for level "${level}"...`);

  await selectors.modelDropdown(page).first().click();
  await selectors.modelOption(page, modelName).first().click();

  // Doc-specified settle time after a successful model selection.
  await new Promise((resolve) => setTimeout(resolve, config.timeouts.modelSelectSettleMs));
}

/** Adds a reference website, if the project has one, and waits for the import to finish. */
export async function addWebsiteLink(page: Page, url: string): Promise<void> {
  if (!url || url.trim().length === 0) {
    return;
  }
  log.info(`Adding reference website: ${url}`);

  await selectors.addWebsiteButton(page).first().click();
  await selectors.websiteUrlInput(page).first().fill(url.trim());
  await selectors.addConfirmButton(page).first().click();

  await waitUntil(async () => (await selectors.websiteImportDoneIndicator(page).count()) > 0, {
    timeoutMs: config.timeouts.websiteImportMs,
    label: "website import to finish",
  });
}

/** Uploads the logo, if the project has one. */
export async function uploadLogo(page: Page, logoUrl: string): Promise<void> {
  if (!logoUrl || logoUrl.trim().length === 0) {
    return;
  }
  log.info("Uploading logo...");
  await uploadImageByUrl(page, selectors.uploadLogoTrigger(page), logoUrl.trim());
}

/** Uploads every reference image, if the project has any. */
export async function uploadSourceImages(page: Page, imageUrls: string[]): Promise<void> {
  for (const url of imageUrls) {
    log.info(`Uploading reference image: ${url}`);
    await uploadImageByUrl(page, selectors.uploadImagesTrigger(page), url);
  }
}

/**
 * Runs the full "insert context" sequence in the order the docs specify:
 * create -> select model -> add website -> upload logo -> upload images.
 */
export async function setupProjectContext(page: Page, row: ProjectRow): Promise<void> {
  await createProject(page, row);
  await selectModel(page, row.requiredProjectLevel);
  await addWebsiteLink(page, row.sourceLinks);
  await uploadLogo(page, row.logoUrl);
  await uploadSourceImages(page, row.sourceImages);
}
