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
  const candidates = page.locator(
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
  );

  const count = await candidates.count();

  if (count === 0) {
    throw new Error(
      "No generated design surface was found on the UXPilot page."
    );
  }

  const isDesignToolbarVisible = async (): Promise<boolean> => {
    return page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll("button")
      );

      return buttons.some((button) => {
        const rect = button.getBoundingClientRect();

        if (rect.width < 1 || rect.height < 1) {
          return false;
        }

        const style = window.getComputedStyle(button);

        if (
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return false;
        }

        const metadata = [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.getAttribute("data-testid"),
          button.textContent,
          ...Array.from(
            button.querySelectorAll("svg")
          ).flatMap((svg) => [
            svg.getAttribute("data-lucide"),
            svg.getAttribute("aria-label"),
            svg.getAttribute("class"),
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return (
          /source.*code/.test(metadata) ||
          /lucide[-\s]?code/.test(metadata) ||
          /copy.*export/.test(metadata) ||
          /copy\/export/.test(metadata)
        );
      });
    });
  };

  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);

    const visible = await candidate
      .isVisible()
      .catch(() => false);

    if (!visible) {
      continue;
    }

    const box = await candidate
      .boundingBox()
      .catch(() => null);

    if (!box) {
      continue;
    }

    if (
      box.width < 40 ||
      box.height < 40
    ) {
      continue;
    }

    try {
      log.info(
        `Selecting generated design candidate ${i + 1}...`
      );

      await candidate.click({
        position: {
          x: box.width / 2,
          y: box.height / 2,
        },
        timeout: 5000,
      });

      await waitUntil(
        async () =>
          await isDesignToolbarVisible(),
        {
          timeoutMs: 5000,
          intervalMs: 250,
          label:
            "UXPilot design toolbar to appear after selecting the generated page",
        }
      );

      log.info(
        "Generated design selected successfully and its toolbar is visible."
      );

      return;
    } catch (error) {
      log.warn(
        `Design candidate ${i + 1} did not become selected: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

  throw new Error(
    "Generated design was found, but clicking it did not activate its UXPilot toolbar."
  );
}

async function zoomOutOnce(page: Page): Promise<void> {
  await clickIconButtonByHint(
    page,
    [
      /zoom\s*out/i,
      /decrease\s*zoom/i,
      /zoom-out/i,
      /^-$/i,
    ],
    "Zoom Out"
  );

  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function getVisibleZoomPercent(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const viewportHeight = window.innerHeight;
    const candidates = Array.from(document.querySelectorAll("body *"));

    const matches = candidates
      .map((element) => {
        const text = (element.textContent || "").trim();
        if (!/^\d{1,3}%$/.test(text)) return null;

        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;

        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") return null;

        const distanceFromBottom = Math.max(0, viewportHeight - rect.bottom);
        return { percent: Number.parseInt(text.slice(0, -1), 10), area: rect.width * rect.height, distanceFromBottom };
      })
      .filter((value): value is { percent: number; area: number; distanceFromBottom: number } => value !== null)
      .sort((a, b) => {
        if (Math.abs(a.distanceFromBottom - b.distanceFromBottom) > 12) return a.distanceFromBottom - b.distanceFromBottom;
        return a.area - b.area;
      });

    return matches.length > 0 ? matches[0].percent : null;
  });
}

async function zoomOutToMinimum(page: Page, minimumPercent = 5): Promise<void> {
  // UXPilot's canvas zoom control is the small minus button in the bottom bar.
  // Keep clicking until the visible canvas zoom reaches the requested floor.
  // The hard cap prevents an unexpected UI change from causing an infinite loop.
  const maxClicks = 30;

  for (let i = 0; i < maxClicks; i++) {
    const currentPercent = await getVisibleZoomPercent(page);

    if (currentPercent !== null && currentPercent <= minimumPercent) {
      log.info(`Canvas zoom reached ${currentPercent}% (target ${minimumPercent}%).`);
      return;
    }

    try {
      await zoomOutOnce(page);
    } catch (error) {
      const afterFailure = await getVisibleZoomPercent(page);
      if (afterFailure !== null && afterFailure <= minimumPercent) {
        log.info(`Canvas zoom is already at ${afterFailure}%; stopping zoom-out.`);
        return;
      }
      throw error;
    }
  }

  const finalPercent = await getVisibleZoomPercent(page);
  if (finalPercent !== null && finalPercent <= minimumPercent) {
    log.info(`Canvas zoom reached ${finalPercent}% (target ${minimumPercent}%).`);
    return;
  }

  throw new Error(
    `Could not reduce UXPilot canvas zoom to ${minimumPercent}% within ${maxClicks} clicks.`
  );
}

async function findBestDesignSurface(page: Page): Promise<ReturnType<Page["locator"]>> {
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
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) continue;

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) continue;

    const area = box.width * box.height;
    if (box.width < 40 || box.height < 40) continue;

    // Prefer plausible generated-design frames over generic canvas containers.
    const className = await candidate.getAttribute("class").catch(() => null);
    const testId = await candidate.getAttribute("data-testid").catch(() => null);
    const metadata = `${className || ""} ${testId || ""}`.toLowerCase();

    let score = Math.min(area, 500_000);
    if (/artboard|design-surface|frame/.test(metadata)) score += 2_000_000;
    if (/canvas/.test(metadata)) score += 50_000;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    throw new Error("Generated design surface could not be identified.");
  }

  return candidates.nth(bestIndex);
}

async function clickDesignSurface(page: Page): Promise<void> {
  try {
    const design = await findBestDesignSurface(page);
    const box = await design.boundingBox();

    if (box && box.width >= 40 && box.height >= 40) {
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2
      );
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      return;
    }
  } catch {
    // Fall back to the generated-screen label below.
  }

  await selectGeneratedDesign(page);
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function prepareDesignToolbarForSourceCode

async function closeSourceCodePanel(page: Page): Promise<void> {
  const panelVisible = await selectors
    .sourceCodePanel(page)
    .first()
    .isVisible()
    .catch(() => false);

  if (!panelVisible) return;

  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));

    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      const style = window.getComputedStyle(button);
      if (style.visibility === "hidden" || style.display === "none") continue;

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
        .join(" ")
        .toLowerCase();

      if (!/(close|dismiss|lucide-x|^x$)/i.test(metadata)) continue;

      let parent: HTMLElement | null = button.parentElement;
      for (let depth = 0; depth < 6 && parent; depth++, parent = parent.parentElement) {
        const text = (parent.textContent || "").replace(/\s+/g, " ").trim();
        if (/\bsource code\b/i.test(text)) {
          button.click();
          return true;
        }
      }
    }

    return false;
  });

  if (!clicked) {
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  await waitUntil(
    async () =>
      !(await selectors
        .sourceCodePanel(page)
        .first()
        .isVisible()
        .catch(() => false)),
    {
      timeoutMs: 5000,
      intervalMs: 250,
      label: "Source Code panel to close",
    }
  );
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
 * Design click -> Zoom Out x2 -> Design click -> <> Source Code icon -> Copy icon.
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
 * Design selection -> close Source Code -> re-discover toolbar -> Figma action -> wait for Design copied.
 */
export async function copyToFigma(page: Page): Promise<void> {
  log.info("Copying design to Figma...");

  // Fully close Source Code, then repeat the same toolbar discovery flow used
  // for Source Code so UXPilot re-attaches the floating toolbar to the design.
  await closeSourceCodePanel(page);
  await prepareDesignToolbarForSourceCode(page);

  const option = selectors.copyToFigmaOption(page);

  const waitForFigmaAction = async (): Promise<void> => {
    await waitUntil(
      async () => {
        const optionVisible = await option
          .isVisible()
          .catch(() => false);

        const toastVisible =
          (await selectors.figmaCopiedToast(page).count()) > 0 &&
          (await selectors.figmaCopiedToast(page)
            .first()
            .isVisible()
            .catch(() => false));

        return optionVisible || toastVisible;
      },
      {
        timeoutMs: 10000,
        intervalMs: 250,
        label: "Copy to Figma action",
      }
    );
  };

  let actionReady = false;

  try {
    await clickIconButtonByHint(
      page,
      [/^figma$/i, /copy.*figma/i],
      "Figma"
    );

    await waitForFigmaAction();
    actionReady = true;
  } catch {
    // Some UXPilot builds expose Figma through Copy/Export instead.
  }

  if (!actionReady) {
    await clickIconButtonByHint(
      page,
      [/copy.*export/i, /export/i, /copy\/export/i],
      "Copy/Export"
    );

    await waitForFigmaAction();
  }

  const optionVisible = await option
    .isVisible()
    .catch(() => false);

  if (optionVisible) {
    await option.click();
    log.info(
      "Clicked 'Copy to Figma'. Waiting for Design copied notification..."
    );
  }

  await waitUntil(
    async () =>
      (await selectors.figmaCopiedToast(page).count()) > 0 &&
      (await selectors.figmaCopiedToast(page)
        .first()
        .isVisible()
        .catch(() => false)),
    {
      timeoutMs: config.timeouts.figmaCopyToastMs,
      intervalMs: 500,
      label: '"Design copied" notification',
    }
  );

  log.info('Received "Design copied" notification.');
}
