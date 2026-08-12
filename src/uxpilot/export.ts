import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("UXPilot/Export");

/**
 * SELECTOR NOTES
 * --------------
 * Export/Figma actions only become available after the generated
 * design itself is selected.
 */
const selectors = {
  /**
   * Exact live button shown in the UXPilot toolbar:
   * "Copy/Export"
   */
  copyExportMenu: (page: Page) =>
    page.getByRole("button", {
      name: /^copy\s*\/\s*export$/i,
    }),

  /**
   * Menu option shown after opening Copy/Export.
   */
  copyAsHtmlOption: (page: Page) =>
    page
      .getByRole("menuitem", {
        name: /^copy as html$/i,
      })
      .or(
        page.getByText(
          /^copy as html$/i
        )
      ),

  /**
   * Menu option shown after opening Copy/Export.
   */
  copyToFigmaOption: (page: Page) =>
    page
      .getByRole("menuitem", {
        name: /^copy to figma$/i,
      })
      .or(
        page.getByText(
          /^copy to figma$/i
        )
      ),

  /**
   * UXPilot notification after Copy to Figma.
   *
   * We intentionally match "Design copied" broadly because
   * the rest of the toast text can change.
   */
  figmaCopiedToast: (page: Page) =>
    page.getByText(
      /design copied/i
    ),

  /**
   * Candidate generated-design containers.
   *
   * We do NOT assume one exact class because the live UXPilot
   * canvas can change its generated class names.
   */
  designCandidates: (page: Page) =>
    page.locator(
      [
        'iframe[title*="preview" i]',
        '[data-testid*="canvas" i]',
        '[data-testid*="design-surface" i]',
        '[data-testid*="artboard" i]',
        '[class*="design-surface" i]',
        '[class*="canvas" i]',
        '[class*="artboard" i]',
        '[class*="preview" i]',
      ].join(", ")
    ),
};

/**
 * Reads text from the browser clipboard.
 */
async function readClipboardText(
  page: Page
): Promise<string> {
  return page.evaluate(
    async () =>
      navigator.clipboard.readText()
  );
}

/**
 * Finds the generated design area, clicks it,
 * and waits until the Copy/Export toolbar becomes visible.
 *
 * This is the critical step that was missing in the previous version.
 */
async function selectGeneratedDesign(
  page: Page
): Promise<void> {
  const candidates =
    selectors
      .designCandidates(page);

  const count =
    await candidates.count();

  if (count === 0) {
    throw new Error(
      "No generated design surface was found on the UXPilot page."
    );
  }

  /**
   * Try visible candidates one by one.
   * A successful candidate is the one that causes
   * the Copy/Export toolbar to appear.
   */
  for (
    let i = 0;
    i < count;
    i++
  ) {
    const candidate =
      candidates.nth(i);

    const visible =
      await candidate
        .isVisible()
        .catch(() => false);

    if (!visible) {
      continue;
    }

    const box =
      await candidate
        .boundingBox()
        .catch(() => null);

    if (!box) {
      continue;
    }

    // Ignore tiny UI elements that happen to match the selectors.
    if (
      box.width < 200 ||
      box.height < 150
    ) {
      continue;
    }

    try {
      log.info(
        `Selecting generated design surface candidate ${i + 1}...`
      );

      /**
       * Click the center of the actual design area.
       *
       * This mirrors the human action:
       * click the generated screen itself.
       */
      await candidate.click({
        position: {
          x: box.width / 2,
          y: box.height / 2,
        },
        timeout: 5000,
      });

      await waitUntil(
        async () =>
          (
            await selectors
              .copyExportMenu(page)
              .count()
          ) > 0 &&
          await selectors
            .copyExportMenu(page)
            .first()
            .isVisible()
            .catch(() => false),
        {
          timeoutMs: 5000,
          intervalMs: 250,
          label:
            "Copy/Export toolbar to appear",
        }
      );

      log.info(
        "Generated design selected and Copy/Export toolbar is visible."
      );

      return;
    } catch (err) {
      log.warn(
        `Design candidate ${i + 1} did not open the export toolbar: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`
      );
    }
  }

  throw new Error(
    "Generated design was found, but clicking it did not open the Copy/Export toolbar."
  );
}

/**
 * Opens the Copy/Export toolbar.
 *
 * IMPORTANT:
 * The generated design must be selected first.
 */
async function openCopyExportMenu(
  page: Page
): Promise<void> {
  await selectGeneratedDesign(
    page
  );

  await selectors
    .copyExportMenu(page)
    .first()
    .click();

  await waitUntil(
    async () =>
      (
        await selectors
          .copyAsHtmlOption(page)
          .count()
      ) > 0,
    {
      timeoutMs: 5000,
      intervalMs: 250,
      label:
        "Copy/Export menu to open",
    }
  );

  log.info(
    "Copy/Export menu opened."
  );
}

/**
 * Copies the generated design as HTML and returns
 * the HTML content from the clipboard.
 *
 * Full workflow:
 *
 * Design click
 * -> Copy/Export
 * -> Copy as HTML
 * -> Wait for clipboard
 */
export async function copyAsHtml(
  page: Page
): Promise<string> {
  log.info(
    "Copying design as HTML..."
  );

  return retry(
    async () => {
      await openCopyExportMenu(
        page
      );

      await selectors
        .copyAsHtmlOption(page)
        .first()
        .click();

      log.info(
        "Clicked 'Copy as HTML'. Waiting for clipboard..."
      );

      let html = "";

      await waitUntil(
        async () => {
          try {
            html =
              await readClipboardText(
                page
              );

            return (
              html.trim().length > 0
            );
          } catch {
            return false;
          }
        },
        {
          timeoutMs:
            config.timeouts
              .clipboardMs,
          intervalMs: 500,
          label:
            "clipboard to contain HTML",
        }
      );

      if (
        html.trim().length === 0
      ) {
        throw new Error(
          "Copy as HTML completed but clipboard is empty."
        );
      }

      log.info(
        `HTML copied successfully (${html.length} characters).`
      );

      return html;
    },
    {
      retries:
        config.retries.clipboard,
      label:
        "Copy as HTML (clipboard)",
    }
  );
}

/**
 * Copies the generated design to Figma.
 *
 * Full workflow:
 *
 * Design click
 * -> Copy/Export
 * -> Copy to Figma
 * -> Wait for "Design copied..."
 */
export async function copyToFigma(
  page: Page
): Promise<void> {
  log.info(
    "Copying design to Figma..."
  );

  /**
   * Select the actual generated design first.
   */
  await openCopyExportMenu(
    page
  );

  await selectors
    .copyToFigmaOption(page)
    .first()
    .click();

  log.info(
    "Clicked 'Copy to Figma'. Waiting for 'Design copied...' notification..."
  );

  await waitUntil(
    async () =>
      (
        await selectors
          .figmaCopiedToast(page)
          .count()
      ) > 0 &&
      await selectors
        .figmaCopiedToast(page)
        .first()
        .isVisible()
        .catch(() => false),
    {
      timeoutMs:
        config.timeouts
          .figmaCopyToastMs,
      intervalMs: 500,
      label:
        '"Design copied" confirmation',
    }
  );

  log.info(
    'Received "Design copied" confirmation.'
  );
}
