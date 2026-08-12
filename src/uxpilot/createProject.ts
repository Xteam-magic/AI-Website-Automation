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
 * SELECTOR NOTES
 * --------------
 * UXPilot DOM-specific selectors are isolated here so they can be
 * corrected without changing the workflow logic.
 */
const selectors = {
  createNewButton: (page: Page) =>
    page.getByRole("button", {
      name: /^create new$/i,
    }),

  createFileOption: (page: Page) =>
    page.getByRole("menuitem", {
      name: /^create new file$/i,
    }),

  projectNameInput: (page: Page) =>
    page.getByLabel(/^File Name$/i),

  fileContextInput: (page: Page) =>
    page.getByPlaceholder(
      /Example: Use dark theme colors/i
    ),

  createConfirmButton: (page: Page) =>
    page.getByRole("button", {
      name: /^create$/i,
    }),

  editorReadyIndicator: (page: Page) =>
    page.getByRole("button", {
      name: /generate|send/i,
    }),

  maybeLaterButton: (page: Page) =>
    page.getByRole("button", {
      name: /^maybe later$/i,
    }),

  /**
   * Live UXPilot model selector.
   *
   * Current live values:
   * Standard
   * Max
   * Glide
   * Glide Pro
   */
  modelDropdown: (page: Page) =>
    page.getByRole("button", {
      name: /^(Standard|Max|Glide|Glide Pro)$/i,
    }),

  /**
   * Live UXPilot model slider:
   * Standard -> Max -> Glide -> Glide Pro
   */
  modelSlider: (page: Page) =>
    page
      .locator(
        "div.relative.cursor-pointer.touch-none"
      )
      .last(),

  /**
   * Main UXPilot composer.
   *
   * Live DOM:
   * <textarea
   *   placeholder="Describe your design, @ to reference images or documents"
   * >
   */
  mainPromptInput: (page: Page) =>
    page.locator(
      'textarea[placeholder="Describe your design, @ to reference images or documents"]'
    ),

  addWebsiteButton: (page: Page) =>
    page.getByRole("button", {
      name: /add website( link)?/i,
    }),

  websiteUrlInput: (page: Page) =>
    page
      .getByPlaceholder(/https?:\/\//i)
      .or(
        page.getByLabel(/website|url/i)
      ),

  addConfirmButton: (page: Page) =>
    page.getByRole("button", {
      name: /^add$/i,
    }),

  websiteImportDoneIndicator: (page: Page) =>
    page.getByText(
      /imported|import complete/i
    ),

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
 * The project documentation currently uses Fast for Low,
 * but the current live UXPilot UI exposes Standard instead.
 */
const MODEL_ALIASES: Record<string, string> = {
  Fast: "Standard",
};

/**
 * Downloads a remote file to a local temporary path.
 *
 * Kept for reference-image handling.
 */
async function downloadToTempFile(
  url: string
): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download "${url}": HTTP ${response.status}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  const extension =
    path.extname(
      new URL(url).pathname
    ) || ".png";

  const filePath =
    path.join(
      os.tmpdir(),
      `upload-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}${extension}`
    );

  fs.writeFileSync(
    filePath,
    buffer
  );

  return filePath;
}

/**
 * Uploads a non-logo reference image.
 *
 * Logo handling intentionally does NOT use this function.
 * Logo is pasted into the main composer as an image URL.
 */
async function uploadImageByUrl(
  page: Page,
  triggerLocator: ReturnType<
    typeof selectors.uploadImagesTrigger
  >,
  imageUrl: string
): Promise<void> {
  await retry(
    async () => {
      await triggerLocator
        .first()
        .click();

      const urlField =
        page.getByPlaceholder(
          /https?:\/\//i
        );

      if (
        (await urlField.count()) > 0
      ) {
        await urlField
          .first()
          .fill(imageUrl);

        await page.keyboard.press(
          "Enter"
        );

        return;
      }

      const [fileChooser] =
        await Promise.all([
          page.waitForEvent(
            "filechooser",
            {
              timeout:
                config.timeouts.imageUploadMs,
            }
          ),

          triggerLocator
            .first()
            .click({
              trial: true,
            })
            .catch(
              () => undefined
            ),
        ]);

      const localPath =
        await downloadToTempFile(
          imageUrl
        );

      await fileChooser.setFiles(
        localPath
      );
    },
    {
      retries:
        config.retries.upload,
      label:
        `Upload image: ${imageUrl}`,
    }
  );
}

/**
 * Dismisses the optional UXPilot promotional popup.
 *
 * The popup can appear shortly after navigation,
 * so we wait briefly for it instead of checking only once.
 */
async function dismissOptionalPopup(
  page: Page
): Promise<void> {
  const maybeLaterButton =
    selectors
      .maybeLaterButton(page)
      .first();

  try {
    await maybeLaterButton.waitFor(
      {
        state: "visible",
        timeout: 5000,
      }
    );

    log.info(
      "Optional UXPilot popup detected. Clicking 'Maybe Later'..."
    );

    await maybeLaterButton.click();

    await maybeLaterButton
      .waitFor({
        state: "hidden",
        timeout: 5000,
      })
      .catch(
        () => undefined
      );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 500)
    );
  } catch {
    log.info(
      "No optional UXPilot popup detected."
    );
  }
}

/**
 * Normalizes the configured model name
 * against the model names available in the live UXPilot UI.
 */
function normalizeModelName(
  modelName: string
): string {
  const normalized =
    MODEL_ALIASES[modelName] ??
    modelName;

  const match =
    MODEL_ORDER.find(
      (model) =>
        model.toLowerCase() ===
        normalized.toLowerCase()
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
 * Reads the model currently displayed
 * by the UXPilot model button.
 */
async function getCurrentModel(
  page: Page
): Promise<string> {
  const button =
    selectors
      .modelDropdown(page)
      .first();

  const text =
    (
      await button.innerText()
    ).trim();

  const match =
    MODEL_ORDER.find(
      (model) =>
        model.toLowerCase() ===
        text.toLowerCase()
    );

  if (!match) {
    throw new Error(
      `Unable to determine current UXPilot model from button text "${text}".`
    );
  }

  return match;
}

/**
 * Selects the target model using the live
 * four-step UXPilot model slider.
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
      currentModel as
        (typeof MODEL_ORDER)[number]
    );

  const targetIndex =
    MODEL_ORDER.indexOf(
      targetModel as
        (typeof MODEL_ORDER)[number]
    );

  if (
    currentIndex === -1
  ) {
    throw new Error(
      `Current model "${currentModel}" is not recognized.`
    );
  }

  if (
    targetIndex === -1
  ) {
    throw new Error(
      `Target model "${targetModel}" is not recognized.`
    );
  }

  if (
    currentIndex ===
    targetIndex
  ) {
    log.info(
      `Model "${targetModel}" is already selected.`
    );

    await page.keyboard
      .press("Escape")
      .catch(
        () => undefined
      );

    return;
  }

  const slider =
    selectors
      .modelSlider(page)
      .first();

  await slider.waitFor(
    {
      state: "visible",
      timeout: 5000,
    }
  );

  const box =
    await slider.boundingBox();

  if (!box) {
    throw new Error(
      "Could not determine the UXPilot model slider position."
    );
  }

  /**
   * Live DOM showed a 28px slider thumb.
   *
   * Model positions:
   * 0%       Standard
   * 33.33%   Max
   * 66.67%   Glide
   * 100%     Glide Pro
   */
  const thumbWidth = 28;

  const usableWidth =
    Math.max(
      box.width -
        thumbWidth,
      1
    );

  const stepWidth =
    usableWidth /
    (MODEL_ORDER.length - 1);

  const targetX =
    box.x +
    thumbWidth / 2 +
    stepWidth *
      targetIndex;

  const targetY =
    box.y +
    box.height / 2;

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
          (
            await getCurrentModel(
              page
            )
          ).toLowerCase() ===
          targetModel.toLowerCase()
        );
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 5000,
      intervalMs: 200,
      label:
        `UXPilot model "${targetModel}"`,
    }
  );

  log.info(
    `Model "${targetModel}" selected successfully.`
  );

  await page.keyboard
    .press("Escape")
    .catch(
      () => undefined
    );
}

/**
 * Resolves the actual image URL from:
 *
 * 1. Direct image URLs
 * 2. Google imgres URLs with ?imgurl=...
 * 3. Visible images on the opened page
 * 4. og:image
 */
async function resolveImageUrl(
  imagePage: Page,
  originalUrl: string
): Promise<string> {
  try {
    const parsed =
      new URL(
        originalUrl
      );

    const imgUrl =
      parsed.searchParams.get(
        "imgurl"
      );

    if (imgUrl) {
      return decodeURIComponent(
        imgUrl
      );
    }
  } catch {
    // Continue with DOM resolution.
  }

  const visibleImages =
    imagePage.locator(
      "img:visible"
    );

  if (
    (await visibleImages.count()) >
    0
  ) {
    const source =
      await visibleImages
        .first()
        .getAttribute("src");

    if (source) {
      return new URL(
        source,
        imagePage.url()
      ).href;
    }
  }

  const metaImage =
    imagePage.locator(
      'meta[property="og:image"]'
    );

  if (
    (await metaImage.count()) >
    0
  ) {
    const content =
      await metaImage
        .first()
        .getAttribute(
          "content"
        );

    if (content) {
      return new URL(
        content,
        imagePage.url()
      ).href;
    }
  }

  return originalUrl;
}

/**
 * Opens the logo URL in a separate page, resolves the actual
 * image URL, and copies the IMAGE ADDRESS as plain text.
 *
 * This is intentionally text clipboard only.
 *
 * Previous image-clipboard handling failed in GitHub Actions
 * because image/jpeg was not supported by ClipboardItem.write().
 *
 * Current behavior:
 *
 * Open logo URL
 * -> resolve real image URL
 * -> copy image address
 * -> return to UXPilot
 */
async function copyLogoImageAddressToClipboard(
  page: Page,
  logoUrl: string
): Promise<string> {
  log.info(
    "Opening logo URL in a new page to copy image address..."
  );

  const logoPage =
    await page.context().newPage();

  try {
    await logoPage.goto(
      logoUrl,
      {
        waitUntil:
          "domcontentloaded",
        timeout: 30000,
      }
    );

    await logoPage
      .waitForLoadState(
        "networkidle"
      )
      .catch(
        () => undefined
      );

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          1000
        )
    );

    const resolvedImageUrl =
      await resolveImageUrl(
        logoPage,
        logoUrl
      );

    log.info(
      `Resolved logo image address: ${resolvedImageUrl}`
    );

    /**
     * Grant clipboard permissions for the UXPilot page origin.
     *
     * The clipboard operation itself is text-only.
     */
    await page.context()
      .grantPermissions(
        [
          "clipboard-read",
          "clipboard-write",
        ],
        {
          origin:
            new URL(
              page.url()
            ).origin,
        }
      )
      .catch(
        () => undefined
      );

    /**
     * Copy IMAGE ADDRESS as plain text.
     *
     * No ClipboardItem or image MIME type is used.
     */
    await page.evaluate(
      async (url) => {
        await navigator.clipboard
          .writeText(url);
      },
      resolvedImageUrl
    );

    log.info(
      "Logo image address copied to clipboard successfully."
    );

    return resolvedImageUrl;
  } finally {
    await logoPage.close()
      .catch(
        () => undefined
      );
  }
}

/**
 * Focuses the main UXPilot composer and pastes
 * the copied logo image URL.
 *
 * Important:
 * - Uses focus(), not click()
 * - Does not press Enter
 * - Keeps the logo URL inside the composer for
 *   the final page prompt / Generate step
 */
async function pasteLogoAddressIntoPrompt(
  page: Page
): Promise<void> {
  const prompt =
    selectors
      .mainPromptInput(page)
      .first();

  await prompt.waitFor(
    {
      state: "visible",
      timeout: 10000,
    }
  );

  /**
   * The UXPilot composer toolbar can intercept
   * pointer events, so click() is intentionally avoided.
   */
  await prompt.focus();

  log.info(
    "Pasting logo image address into UXPilot composer..."
  );

  await page.keyboard.press(
    "Control+V"
  );

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        500
      )
  );

  await prompt.focus();

  await page.keyboard.type(
    "\nاین لینک تصویر لوگوی برند هست",
    {
      delay: 10,
    }
  );

  log.info(
    "Logo image address and logo description added to the prompt."
  );
}

/**
 * Creates the new UXPilot project file
 * and waits for the editor to open.
 */
export async function createProject(
  page: Page,
  row: ProjectRow
): Promise<void> {
  log.info(
    `Creating project "${row.projectName}"...`
  );

  /**
   * Popup can block Create New.
   */
  await dismissOptionalPopup(
    page
  );

  await selectors
    .createNewButton(page)
    .first()
    .click();

  /**
   * Safely dismiss again if it reappears.
   */
  await dismissOptionalPopup(
    page
  );

  await selectors
    .createFileOption(page)
    .first()
    .click();

  await selectors
    .projectNameInput(page)
    .first()
    .fill(
      row.projectName
    );

  await selectors
    .fileContextInput(page)
    .first()
    .fill(
      row.designSystem
    );

  await selectors
    .createConfirmButton(page)
    .first()
    .click();

  await waitUntil(
    async () =>
      (
        await selectors
          .editorReadyIndicator(
            page
          )
          .count()
      ) > 0,
    {
      timeoutMs:
        config.timeouts
          .createProjectMs,
      label:
        "UXPilot project editor to open",
    }
  );

  /**
   * Popup may also appear after entering the editor.
   */
  await dismissOptionalPopup(
    page
  );

  log.info(
    "Project created and editor is open."
  );
}

/**
 * Selects the generation model matching
 * the project's Required Project Level.
 */
export async function selectModel(
  page: Page,
  level: ProjectLevel
): Promise<void> {
  const configuredModel =
    config.modelByLevel[
      level
    ];

  const targetModel =
    normalizeModelName(
      configuredModel
    );

  log.info(
    `Selecting model "${targetModel}" for level "${level}"...`
  );

  await selectors
    .modelDropdown(page)
    .first()
    .click();

  await selectModelUsingSlider(
    page,
    targetModel
  );

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        config.timeouts
          .modelSelectSettleMs
      )
  );
}

/**
 * Adds a reference website, if the project has one,
 * and waits for the import to finish.
 */
export async function addWebsiteLink(
  page: Page,
  url: string
): Promise<void> {
  if (
    !url ||
    url.trim().length === 0
  ) {
    return;
  }

  log.info(
    `Adding reference website: ${url}`
  );

  await selectors
    .addWebsiteButton(page)
    .first()
    .click();

  await selectors
    .websiteUrlInput(page)
    .first()
    .fill(
      url.trim()
    );

  await selectors
    .addConfirmButton(page)
    .first()
    .click();

  await waitUntil(
    async () =>
      (
        await selectors
          .websiteImportDoneIndicator(
            page
          )
          .count()
      ) > 0,
    {
      timeoutMs:
        config.timeouts
          .websiteImportMs,
      label:
        "website import to finish",
    }
  );
}

/**
 * Adds the brand logo through the main UXPilot composer.
 *
 * Flow:
 *
 * 1. Read Logo URL
 * 2. Open URL in a new page
 * 3. Resolve actual image address
 * 4. Copy IMAGE ADDRESS
 * 5. Return to UXPilot
 * 6. Focus main composer
 * 7. Paste image URL
 * 8. Add logo description
 * 9. Do not submit
 */
export async function uploadLogo(
  page: Page,
  logoUrl: string
): Promise<void> {
  if (
    !logoUrl ||
    logoUrl.trim().length === 0
  ) {
    return;
  }

  log.info(
    "Adding brand logo through the main UXPilot composer..."
  );

  await copyLogoImageAddressToClipboard(
    page,
    logoUrl.trim()
  );

  await pasteLogoAddressIntoPrompt(
    page
  );
}

/**
 * Uploads every reference image, if the project has any.
 *
 * Reference-image workflow remains unchanged.
 */
export async function uploadSourceImages(
  page: Page,
  imageUrls: string[]
): Promise<void> {
  for (
    const url of imageUrls
  ) {
    log.info(
      `Uploading reference image: ${url}`
    );

    await uploadImageByUrl(
      page,
      selectors.uploadImagesTrigger(
        page
      ),
      url
    );
  }
}

/**
 * Runs the full project context sequence:
 *
 * create
 * -> select model
 * -> add website
 * -> add logo
 * -> upload reference images
 */
export async function setupProjectContext(
  page: Page,
  row: ProjectRow
): Promise<void> {
  await createProject(
    page,
    row
  );

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
