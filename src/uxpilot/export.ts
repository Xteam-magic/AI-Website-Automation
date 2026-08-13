import fs from "fs";
import os from "os";
import path from "path";
import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("UXPilot/Export");

const selectors = {
  sourceCodePanel: (page: Page) =>
    page.getByText(/^Source Code$/i).first(),

  copyToFigmaOption: (page: Page) =>
    page
      .getByRole("menuitem", { name: /^copy to figma$/i })
      .or(page.getByText(/^copy to figma$/i))
      .first(),

  figmaCopiedToast: (page: Page) =>
    page.getByText(/design copied/i).first(),

  generatedDesignLabels: (page: Page) =>
    page.getByText(
      /^[^\n-]+-\s*(landing|home|pricing|dashboard|about|contact|blog)/i
    ),
};

async function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(async () => navigator.clipboard.readText());
}

/**
 * Clicks an icon-only button by inspecting its accessible metadata,
 * title, data-testid and SVG data-lucide/class information.
 */
async function clickIconButtonByHint(
  page: Page,
  hints: RegExp[],
  label: string
): Promise<void> {
  const result = await page.evaluate(
    (serializedHints) => {
      const regexes = serializedHints.map((source) => new RegExp(source, "i"));
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;

        const metadata = [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.getAttribute("data-testid"),
          button.textContent,
          ...Array.from(button.querySelectorAll("svg")).flatMap((svg) => [
            svg.getAttribute("data-lucide"),
            svg.getAttribute("aria-label"),
            svg.getAttribute("class"),
          ]),
        ]
          .filter(Boolean)
          .join(" ");

        if (regexes.some((regex) => regex.test(metadata))) {
          (button as HTMLButtonElement).click();
          return { clicked: true, metadata };
        }
      }

      return { clicked: false, metadata: "" };
    },
    hints.map((hint) => hint.source)
  );

  if (!result.clicked) {
    throw new Error(
      `Could not find ${label} icon in the current UXPilot toolbar.`
    );
  }

  log.info(`${label} icon clicked (${result.metadata}).`);
}

async function selectGeneratedDesign(page: Page): Promise<void> {
  const labels = selectors.generatedDesignLabels(page);
  const labelCount = await labels.count();

  for (let i = 0; i < labelCount; i++) {
    const label = labels.nth(i);
    if (!(await label.isVisible().catch(() => false))) continue;

    try {
      await label.click({ timeout: 5000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      return;
    } catch {
      // Try next visible generated-screen label.
    }
  }

  const candidates = page.locator(
    [
      '[data-testid*="canvas" i]',
      '[data-testid*="design" i]',
      '[data-testid*="frame" i]',
      '[data-testid*="artboard" i]',
      '[class*="design-surface" i]',
      '[class*="artboard" i]',
      '[class*="canvas" i]',
    ].join(", ")
  );

  const count = await candidates.count();
  let bestIndex = -1;
  let bestArea = 0;

  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) continue;

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) continue;

    const area = box.width * box.height;
    if (box.width >= 200 && box.height >= 150 && area > bestArea) {
      bestArea = area;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    throw new Error("Generated design surface could not be identified.");
  }

  const design = candidates.nth(bestIndex);
  const box = await design.boundingBox();
  if (!box) throw new Error("Generated design surface has no bounding box.");

  await page.mouse.click(
    box.x + box.width / 2,
    box.y + box.height / 2
  );
}

/**
 * UXPilot keeps the generated-design toolbar attached to the selected page.
 * In the current layout, the toolbar can sit underneath the fixed bottom
 * canvas toolbar when the design is first selected. Scroll only the canvas
 * under the selected design by half a viewport, then select the design again
 * so the attached toolbar is brought into the visible area.
 */
async function revealGeneratedDesignToolbar(page: Page): Promise<void> {
  const design = page.locator(
    [
      '[data-testid*="canvas" i]',
      '[data-testid*="design" i]',
      '[data-testid*="frame" i]',
      '[data-testid*="artboard" i]',
      '[class*="design-surface" i]',
      '[class*="artboard" i]',
      '[class*="canvas" i]',
    ].join(", ")
  );

  const count = await design.count();
  let bestIndex = -1;
  let bestArea = 0;

  for (let i = 0; i < count; i++) {
    const candidate = design.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) continue;

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) continue;

    const area = box.width * box.height;
    if (box.width >= 200 && box.height >= 150 && area > bestArea) {
      bestArea = area;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    throw new Error("Generated design surface could not be identified for toolbar scrolling.");
  }

  const box = await design.nth(bestIndex).boundingBox();
  if (!box) {
    throw new Error("Generated design surface has no bounding box for toolbar scrolling.");
  }

  const viewportHalf = await page.evaluate(() =>
    Math.max(200, Math.round(window.innerHeight * 0.5))
  );

  // The pointer is deliberately placed on the generated-design canvas so the
  // wheel event is handled by the canvas/frames scroller, not the left thread
  // panel or the outer application page.
  await page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2
  );

  await page.mouse.wheel(0, viewportHalf);
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Second click after scrolling: this refreshes the selected frame's
  // contextual toolbar in its now-visible position.
  await selectGeneratedDesign(page);
}

async function openSourceCodePanel(page: Page): Promise<void> {
  await selectGeneratedDesign(page);

  await revealGeneratedDesignToolbar(page);

  await clickIconButtonByHint(
    page,
    [
      /source.*code/i,
      /view.*code/i,
      /^code$/i,
      /code-2/i,
      /brackets/i,
    ],
    "Source Code"
  );

  await waitUntil(
    async () =>
      (await selectors.sourceCodePanel(page).count()) > 0,
    {
      timeoutMs: 10000,
      intervalMs: 250,
      label: "Source Code panel to open",
    }
  );

  log.info("Source Code panel opened.");
}

async function closeSourceCodePanel(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
}

async function captureSourceCodeCopy(page: Page): Promise<string> {
  await clickIconButtonByHint(
    page,
    [/^copy$/i, /copy/i],
    "Source Code Copy"
  );

  let html = "";
  await waitUntil(
    async () => {
      try {
        html = await readClipboardText(page);
        return html.trim().length > 0;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: config.timeouts.clipboardMs,
      intervalMs: 500,
      label: "Source Code HTML clipboard",
    }
  );

  return html;
}

async function captureSourceCodeDownload(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent("download", {
    timeout: 10000,
  });

  await clickIconButtonByHint(
    page,
    [/download/i],
    "Source Code Download"
  );

  const download = await downloadPromise;
  const filePath = path.join(
    os.tmpdir(),
    `uxpilot-${Date.now()}-${download.suggestedFilename()}`
  );

  await download.saveAs(filePath);

  const text = fs.readFileSync(filePath, "utf8");
  return text;
}

/**
 * Current live UXPilot route:
 * Design click -> <> Source Code icon -> Copy icon.
 * Download is only a fallback if clipboard copy fails.
 */
export async function copyAsHtml(page: Page): Promise<string> {
  log.info("Copying generated design HTML from Source Code...");

  return retry(
    async () => {
      await openSourceCodePanel(page);

      let html = "";
      try {
        html = await captureSourceCodeCopy(page);
      } catch (copyError) {
        log.warn(
          `Source Code copy failed, trying download fallback: ${
            copyError instanceof Error
              ? copyError.message
              : String(copyError)
          }`
        );
        html = await captureSourceCodeDownload(page);
      }

      if (!html || html.trim().length === 0) {
        throw new Error("Source Code returned empty HTML.");
      }

      log.info(`HTML captured successfully (${html.length} characters).`);
      await closeSourceCodePanel(page);
      return html;
    },
    {
      retries: config.retries.clipboard,
      label: "Source Code HTML export",
    }
  );
}

/**
 * Design click -> Copy/Export icon -> Copy to Figma -> wait for Design copied.
 */
export async function copyToFigma(page: Page): Promise<void> {
  log.info("Copying design to Figma...");

  await selectGeneratedDesign(page);

  await clickIconButtonByHint(
    page,
    [/copy.*export/i, /export/i, /copy\/export/i],
    "Copy/Export"
  );

  const option = selectors.copyToFigmaOption(page);
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();

  log.info(
    "Clicked 'Copy to Figma'. Waiting for Design copied notification..."
  );

  await waitUntil(
    async () =>
      (await selectors.figmaCopiedToast(page).count()) > 0 &&
      (await selectors.figmaCopiedToast(page).first().isVisible().catch(() => false)),
    {
      timeoutMs: config.timeouts.figmaCopyToastMs,
      intervalMs: 500,
      label: '"Design copied" notification',
    }
  );

  log.info('Received "Design copied" notification.');
}
