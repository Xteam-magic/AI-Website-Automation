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

  /**
   * UXPilot's current live model control is a 4-step clickable slider:
   * Standard -> Max -> Glide -> Glide Pro
   *
   * The provided live DOM shows:
   * <div class="relative cursor-pointer touch-none">
   */
  modelSlider: (page: Page) =>
    page.locator("div.relative.cursor-pointer.touch-none").last(),

  addWebsiteButton: (page: Page) =>
    page.getByRole("button", { name: /add website( link)?/i }),

  websiteUrlInput: (page: Page) =>
    page.getByPlaceholder(/https?:\/\//i)
      .or(page.getByLabel(/website|url/i)),

  addConfirmButton: (page: Page) =>
    page.getByRole("button", { name: /^add$/i }),

  websiteImportDoneIndicator: (page: Page) =>
    page.getByText(/imported|import complete/i),

  uploadLogoTrigger: (page: Page) =>
    page.getByRole("button", { name: /upload logo|logo/i }),

  uploadImagesTrigger: (page: Page) =>
    page.getByRole("button", {
      name: /upload image|add image|reference image/i,
    }),
};

/**
 * Actual model order observed in the live UXPilot UI.
 */
const MODEL_ORDER = [
  "Standard",
  "Max",
  "Glide",
  "Glide Pro",
] as const;

/**
 * The project documentation currently maps Low -> Fast,
 * but the live UXPilot UI shown in the current run exposes
 * Standard instead of Fast.
 *
 * Therefore Fast is treated as the live Standard tier.
 */
const MODEL_ALIASES: Record<string, string> = {
  Fast: "Standard",
};

async function downloadToTempFile(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download "${url}": HTTP ${response.status}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  const extension =
    path.extname(new URL(url).pathname) || ".png";

  const filePath = path.join(
    os.tmpdir(),
    `upload-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}${extension}`
  );

  fs.writeFileSync(filePath, buffer);

  return filePath;
}

/**
 * Uploads a single image by URL. UXPilot's exact upload widget is unknown
 * (URL-paste field vs. native file picker), so this tries a URL-paste field
 * first and falls back to downloading the image and using the OS file
 * chooser — the same two options a human would have.
 */
async function uploadImageByUrl(
  page: Page,
  triggerLocator: ReturnType<typeof selectors.uploadLogoTrigger>,
  imageUrl: string
): Promise<void> {
  await retry(
    async () => {
      await triggerLocator.first().click();

      const urlField =
        page.getByPlaceholder(/https?:\/\//i);

      if ((await urlField.count()) > 0) {
        await urlField.first().fill(imageUrl);
        await page.keyboard.press("Enter");
        return;
      }

      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", {
          timeout: config.timeouts.imageUploadMs,
        }),

        // The trigger click above should have already opened the chooser
        // in most native <input type="file"> implementations.
        triggerLocator
          .first()
          .click({ trial: true })
          .catch(() => undefined),
      ]);

      const localPath =
        await downloadToTempFile(imageUrl);

      await fileChooser.setFiles(localPath);
    },
    {
      retries: config.retries.upload,
      label: `Upload image: ${imageUrl}`,
    }
  );
}

/**
 * Dismisses the optional promotional UXPilot popup.
 *
 * The popup can appear slightly after page load, so we wait briefly
 * for it instead of checking only once.
 */
async function dismissOptionalPopup(
  page: Page
): Promise<void> {
  const maybeLaterButton =
    selectors.maybeLaterButton(page).first();

  try {
    await maybeLaterButton.waitFor({
      state: "visible",
      timeout: 5000,
    });

    log.info(
      "Optional UXPilot popup detected. Clicking 'Maybe Later'..."
    );

    await maybeLaterButton.click();

    await maybeLaterButton
      .waitFor({
        state: "hidden",
        timeout: 5000,
      })
      .catch(() => undefined);

    await new Promise((resolve) =>
      setTimeout(resolve, 500)
    );
  } catch {
    log.info("No optional UXPilot popup detected.");
  }
}

/**
 * Normalizes the model requested by project configuration
 * to the model names actually visible in the live UXPilot UI.
 */
function normalizeModelName(modelName: string): string {
  const normalized = MODEL_ALIASES[modelName] ?? modelName;

  const match = MODEL_ORDER.find(
    (model) =>
      model.toLowerCase() === normalized.toLowerCase()
  );

  if (!match) {
    throw new Error(
      `Unsupported UXPilot model "${modelName}". ` +
      `Available live models: ${MODEL_ORDER.join(", ")}`
    );
  }

  return match;
}

/**
 * Reads the model name currently displayed by the UXPilot model button.
 */
async function getCurrentModel(
  page: Page
): Promise<string> {
  const button =
    selectors.modelDropdown(page).first();

  const text = (await button.innerText()).trim();

  const match = MODEL_ORDER.find(
    (model) =>
      model.toLowerCase() === text.toLowerCase()
  );

  if (!match) {
    throw new Error(
      `Unable to determine current UXPilot model from button text "${text}".`
    );
  }

  return match;
}

/**
 * Selects the desired model by clicking the actual live UXPilot
 * stepper/slider at the exact position of the required step.
 *
 * Actual live order:
 *
 * Standard -> Max -> Glide -> Glide Pro
 */
async function selectModelUsingSlider(
  page: Page,
  targetModel: string
): Promise<void> {
  const currentModel =
    await getCurrentModel(page);

  const currentIndex =
    MODEL_ORDER.indexOf(
      currentModel as (typeof MODEL_ORDER)[number]
    );

  const targetIndex =
    MODEL_ORDER.indexOf(
      targetModel as (typeof MODEL_ORDER)[number]
    );

  if (currentIndex === -1) {
    throw new Error(
      `Current model "${currentModel}" is not recognized.`
    );
  }

  if (targetIndex === -1) {
    throw new Error(
      `Target model "${targetModel}" is not recognized.`
    );
  }

  if (currentIndex === targetIndex) {
    log.info(
      `Model "${targetModel}" is already selected.`
    );

    await page.keyboard
      .press("Escape")
      .catch(() => undefined);

    return;
  }

  const slider =
    selectors.modelSlider(page).first();

  await slider.waitFor({
    state: "visible",
    timeout: 5000,
  });

  const box = await slider.boundingBox();

  if (!box) {
    throw new Error(
      "Could not determine the UXPilot model slider position."
    );
  }

  /**
   * The live DOM shows a 28px thumb inside the slider.
   * The four model positions correspond to:
   *
   * 0%       = Standard
   * 33.33%   = Max
   * 66.67%   = Glide
   * 100%     = Glide Pro
   *
   * We therefore click the center of the thumb position.
   */
  const thumbWidth = 28;

  const usableWidth = Math.max(
    box.width - thumbWidth,
    1
  );

  const stepWidth =
    usableWidth / (MODEL_ORDER.length - 1);

  const targetX =
    box.x +
    thumbWidth / 2 +
    stepWidth * targetIndex;

  const targetY =
    box.y + box.height / 2;

  log.info(
    `Moving model from "${currentModel}" to "${targetModel}"...`
  );

  await page.mouse.click(
    targetX,
    targetY
  );

  await waitUntil(
    async () => {
      try {
        return (
          (await getCurrentModel(page)).toLowerCase() ===
          targetModel.toLowerCase()
        );
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 5000,
      intervalMs: 200,
      label: `UXPilot model "${targetModel}"`,
    }
  );

  log.info(
    `Model "${targetModel}" selected successfully.`
  );

  // Close the model popup without affecting the selected value.
  await page.keyboard
    .press("Escape")
    .catch(() => undefined);
}

/** Creates the new UXPilot project file and waits for the editor to open. */
export async function createProject(
  page: Page,
  row: ProjectRow
): Promise<void> {
  log.info(
    `Creating project "${row.projectName}"...`
  );

  // The popup can block the Create New button,
  // so dismiss it before attempting to open the menu.
  await dismissOptionalPopup(page);

  await selectors.createNewButton(page)
    .first()
    .click();

  // Safely dismiss it again if UXPilot shows it here.
  await dismissOptionalPopup(page);

  await selectors.createFileOption(page)
    .first()
    .click();

  await selectors.projectNameInput(page)
    .first()
    .fill(row.projectName);

  await selectors.fileContextInput(page)
    .first()
    .fill(row.designSystem);

  await selectors.createConfirmButton(page)
    .first()
    .click();

  await waitUntil(
    async () =>
      (await selectors.editorReadyIndicator(page).count()) > 0,
    {
      timeoutMs: config.timeouts.createProjectMs,
      label: "UXPilot project editor to open",
    }
  );

  // The promotional popup may also appear after entering the editor.
  await dismissOptionalPopup(page);

  log.info(
    "Project created and editor is open."
  );
}

/** Selects the generation model matching the project's Required Project Level. */
export async function selectModel(
  page: Page,
  level: ProjectLevel
): Promise<void> {
  const configuredModel =
    config.modelByLevel[level];

  const targetModel =
    normalizeModelName(configuredModel);

  log.info(
    `Selecting model "${targetModel}" for level "${level}"...`
  );

  /**
   * The model control is currently a stepper/slider.
   * Clicking the button opens its selector.
   */
  await selectors.modelDropdown(page)
    .first()
    .click();

  await selectModelUsingSlider(
    page,
    targetModel
  );

  // Doc-specified settle time after a successful model selection.
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      config.timeouts.modelSelectSettleMs
    )
  );
}

/** Adds a reference website, if the project has one, and waits for the import to finish. */
export async function addWebsiteLink(
  page: Page,
  url: string
): Promise<void> {
  if (!url || url.trim().length === 0) {
    return;
  }

  log.info(
    `Adding reference website: ${url}`
  );

  await selectors.addWebsiteButton(page)
    .first()
    .click();

  await selectors.websiteUrlInput(page)
    .first()
    .fill(url.trim());

  await selectors.addConfirmButton(page)
    .first()
    .click();

  await waitUntil(
    async () =>
      (await selectors.websiteImportDoneIndicator(page).count()) > 0,
    {
      timeoutMs: config.timeouts.websiteImportMs,
      label: "website import to finish",
    }
  );
}

/** Uploads the logo, if the project has one. */
export async function uploadLogo(
  page: Page,
  logoUrl: string
): Promise<void> {
  if (!logoUrl || logoUrl.trim().length === 0) {
    return;
  }

  log.info("Uploading logo...");

  await uploadImageByUrl(
    page,
    selectors.uploadLogoTrigger(page),
    logoUrl.trim()
  );
}

/** Uploads every reference image, if the project has any. */
export async function uploadSourceImages(
  page: Page,
  imageUrls: string[]
): Promise<void> {
  for (const url of imageUrls) {
    log.info(
      `Uploading reference image: ${url}`
    );

    await uploadImageByUrl(
      page,
      selectors.uploadImagesTrigger(page),
      url
    );
  }
}

/**
 * Runs the full "insert context" sequence in the order the docs specify:
 * create -> select model -> add website -> upload logo -> upload images.
 */
export async function setupProjectContext(
  page: Page,
  row: ProjectRow
): Promise<void> {
  await createProject(page, row);

  await selectModel(
    page,
    row.requiredProjectLevel
  );

  await addWebsiteLink(
    page,
    row.sourceLinks
  );

  await uploadLogo(
    page,
    row.logoUrl
  );

  await uploadSourceImages(
    page,
    row.sourceImages
  );
}
