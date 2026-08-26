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
      const regexes = serializedHints.map(
        (source) => new RegExp(source, "i")
      );
      const buttons = Array.from(
        document.querySelectorAll("button")
      );

      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;

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
          .join(" ");

        if (
          regexes.some((regex) => regex.test(metadata))
        ) {
          (button as HTMLButtonElement).click();
          return {
            clicked: true,
            metadata,
          };
        }
      }

      return {
        clicked: false,
        metadata: "",
      };
    },
    hints.map((hint) => hint.source)
  );

  if (!result.clicked) {
    throw new Error(
      `Could not find ${label} icon in the current UXPilot toolbar.`
    );
  }

  log.info(
    `${label} icon clicked (${result.metadata}).`
  );
}

async function getVisibleToolbarMetadata(
  page: Page
): Promise<string[]> {
  return page.evaluate(() => {
    return Array.from(
      document.querySelectorAll("button")
    )
      .filter((button) => {
        const rect = button.getBoundingClientRect();

        if (rect.width < 1 || rect.height < 1) {
          return false;
        }

        const style =
          window.getComputedStyle(button);

        return (
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .map((button) =>
        [
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
          .toLowerCase()
      );
  });
}

async function isDesignToolbarVisible(
  page: Page
): Promise<boolean> {
  const metadata =
    await getVisibleToolbarMetadata(page);

  return metadata.some(
    (value) =>
      /source.*code/.test(value) ||
      /lucide[-\s]?code/.test(value) ||
      /copy.*export/.test(value) ||
      /copy\/export/.test(value)
  );
}

/**
 * Selects the actual generated design surface.
 *
 * This intentionally verifies that the UXPilot design toolbar appears
 * after the click. A plain click on a generic workspace/canvas container
 * is not treated as a successful selection.
 */
async function selectGeneratedDesign(
  page: Page
): Promise<void> {
  const labelCandidates =
    selectors.generatedDesignLabels(page);

  const labelCount =
    await labelCandidates.count();

  for (let i = 0; i < labelCount; i++) {
    const label =
      labelCandidates.nth(i);

    if (
      !(await label
        .isVisible()
        .catch(() => false))
    ) {
      continue;
    }

    try {
      log.info(
        `Selecting generated design label ${i + 1}...`
      );

      await label.click({
        timeout: 5000,
      });

      await waitUntil(
        async () =>
          await isDesignToolbarVisible(page),
        {
          timeoutMs: 5000,
          intervalMs: 250,
          label:
            "UXPilot design toolbar after selecting generated page",
        }
      );

      log.info(
        "Generated design selected successfully and its toolbar is visible."
      );

      return;
    } catch (error) {
      log.warn(
        `Generated design label ${i + 1} did not become selected: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

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

  const count =
    await candidates.count();

  if (count === 0) {
    throw new Error(
      "No generated design surface was found on the UXPilot page."
    );
  }

  for (let i = 0; i < count; i++) {
    const candidate =
      candidates.nth(i);

    if (
      !(await candidate
        .isVisible()
        .catch(() => false))
    ) {
      continue;
    }

    const box =
      await candidate
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
          await isDesignToolbarVisible(page),
        {
          timeoutMs: 5000,
          intervalMs: 250,
          label:
            "UXPilot design toolbar after selecting generated page",
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

async function zoomOutOnce(
  page: Page
): Promise<void> {
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

  await new Promise((resolve) =>
    setTimeout(resolve, 180)
  );
}

async function getVisibleZoomPercent(
  page: Page
): Promise<number | null> {
  return page.evaluate(() => {
    const viewportHeight =
      window.innerHeight;

    const candidates = Array.from(
      document.querySelectorAll("body *")
    );

    const matches = candidates
      .map((element) => {
        const text =
          (element.textContent || "")
            .trim();

        if (!/^\d{1,3}%$/.test(text)) {
          return null;
        }

        const rect =
          element.getBoundingClientRect();

        if (
          rect.width < 1 ||
          rect.height < 1
        ) {
          return null;
        }

        const style =
          window.getComputedStyle(element);

        if (
          style.visibility === "hidden" ||
          style.display === "none"
        ) {
          return null;
        }

        const distanceFromBottom =
          Math.max(
            0,
            viewportHeight - rect.bottom
          );

        return {
          percent: Number.parseInt(
            text.slice(0, -1),
            10
          ),
          area:
            rect.width * rect.height,
          distanceFromBottom,
        };
      })
      .filter(
        (
          value
        ): value is {
          percent: number;
          area: number;
          distanceFromBottom: number;
        } => value !== null
      )
      .sort((a, b) => {
        if (
          Math.abs(
            a.distanceFromBottom -
              b.distanceFromBottom
          ) > 12
        ) {
          return (
            a.distanceFromBottom -
            b.distanceFromBottom
          );
        }

        return a.area - b.area;
      });

    return matches.length > 0
      ? matches[0].percent
      : null;
  });
}

async function zoomOutToMinimum(
  page: Page,
  minimumPercent = 5
): Promise<void> {
  const maxClicks = 30;

  for (
    let i = 0;
    i < maxClicks;
    i++
  ) {
    const currentPercent =
      await getVisibleZoomPercent(page);

    if (
      currentPercent !== null &&
      currentPercent <= minimumPercent
    ) {
      log.info(
        `Canvas zoom reached ${currentPercent}% (target ${minimumPercent}%).`
      );
      return;
    }

    try {
      await zoomOutOnce(page);
    } catch (error) {
      const afterFailure =
        await getVisibleZoomPercent(
          page
        );

      if (
        afterFailure !== null &&
        afterFailure <= minimumPercent
      ) {
        log.info(
          `Canvas zoom is already at ${afterFailure}%; stopping zoom-out.`
        );
        return;
      }

      throw error;
    }
  }

  const finalPercent =
    await getVisibleZoomPercent(page);

  if (
    finalPercent !== null &&
    finalPercent <= minimumPercent
  ) {
    log.info(
      `Canvas zoom reached ${finalPercent}% (target ${minimumPercent}%).`
    );
    return;
  }

  throw new Error(
    `Could not reduce UXPilot canvas zoom to ${minimumPercent}% within ${maxClicks} clicks.`
  );
}

/**
 * Re-selects the generated page after zoom and scrolling so the
 * floating design toolbar is attached to the actual design.
 */
async function prepareDesignToolbarForSourceCode(
  page: Page
): Promise<void> {
  // Initial selection.
  await selectGeneratedDesign(page);

  // Zoom all the way out.
  await zoomOutToMinimum(
    page,
    5
  );

  // Zooming can clear the selection.
  await new Promise((resolve) =>
    setTimeout(resolve, 500)
  );

  // IMPORTANT: select the actual generated page again.
  await selectGeneratedDesign(page);

  // Move over the actual design and scroll a little.
  const scrollCandidates =
    page.locator(
      [
        'iframe[title*="preview" i]',
        '[data-testid*="design-surface" i]',
        '[data-testid*="artboard" i]',
        '[class*="design-surface" i]',
        '[class*="artboard" i]',
        '[class*="preview" i]',
      ].join(", ")
    );

  const scrollCount =
    await scrollCandidates.count();

  let scrolled = false;

  for (
    let i = 0;
    i < scrollCount;
    i++
  ) {
    const candidate =
      scrollCandidates.nth(i);

    if (
      !(await candidate
        .isVisible()
        .catch(() => false))
    ) {
      continue;
    }

    const box =
      await candidate
        .boundingBox()
        .catch(() => null);

    if (!box) {
      continue;
    }

    await page.mouse.move(
      box.x + box.width / 2,
      box.y + box.height / 2
    );

    await page.mouse.wheel(
      0,
      650
    );

    scrolled = true;
    break;
  }

  if (!scrolled) {
    const viewport =
      page.viewportSize();

    const x = viewport
      ? Math.round(
          viewport.width * 0.55
        )
      : 720;

    const y = viewport
      ? Math.round(
          viewport.height * 0.55
        )
      : 450;

    await page.mouse.move(
      x,
      y
    );

    await page.mouse.wheel(
      0,
      650
    );
  }

  await new Promise((resolve) =>
    setTimeout(resolve, 500)
  );

  // Scrolling can also remove the selection.
  await selectGeneratedDesign(page);

  await new Promise((resolve) =>
    setTimeout(resolve, 800)
  );
}

async function openSourceCodePanel(
  page: Page
): Promise<void> {
  await prepareDesignToolbarForSourceCode(
    page
  );

  await clickIconButtonByHint(
    page,
    [
      /source.*code/i,
      /view.*code/i,
      /lucide[-\s]?code/i,
      /code-2/i,
      /brackets/i,
      /^code$/i,
    ],
    "Source Code"
  );

  await waitUntil(
    async () =>
      (
        await selectors
          .sourceCodePanel(page)
          .count()
      ) > 0,
    {
      timeoutMs: 10000,
      intervalMs: 250,
      label:
        "Source Code panel to open",
    }
  );

  log.info(
    "Source Code panel opened."
  );
}

async function closeSourceCodePanel(
  page: Page
): Promise<void> {
  const panel =
    selectors
      .sourceCodePanel(page)
      .first();

  const panelVisible =
    await panel
      .isVisible()
      .catch(() => false);

  if (!panelVisible) {
    return;
  }

  const clicked =
    await page.evaluate(() => {
      const sourceCodeHeaders =
        Array.from(
          document.querySelectorAll("*")
        ).filter((element) => {
          const text =
            (element.textContent || "")
              .replace(/\s+/g, " ")
              .trim();

          const rect =
            element.getBoundingClientRect();

          return (
            text === "Source Code" &&
            rect.width > 0 &&
            rect.height > 0
          );
        });

      for (
        const header of sourceCodeHeaders
      ) {
        let container:
          | HTMLElement
          | null =
          header.parentElement;

        for (
          let depth = 0;
          depth < 8 && container;
          depth++,
          container =
            container.parentElement
        ) {
          const buttons =
            Array.from(
              container.querySelectorAll(
                "button"
              )
            );

          for (
            const button of buttons
          ) {
            const rect =
              button.getBoundingClientRect();

            if (
              rect.width < 1 ||
              rect.height < 1
            ) {
              continue;
            }

            const style =
              window.getComputedStyle(
                button
              );

            if (
              style.display ===
                "none" ||
              style.visibility ===
                "hidden"
            ) {
              continue;
            }

            const metadata = [
              button.getAttribute(
                "aria-label"
              ),
              button.getAttribute(
                "title"
              ),
              button.getAttribute(
                "data-testid"
              ),
              button.textContent,
              ...Array.from(
                button.querySelectorAll(
                  "svg"
                )
              ).flatMap((svg) => [
                svg.getAttribute(
                  "data-lucide"
                ),
                svg.getAttribute(
                  "aria-label"
                ),
                svg.getAttribute(
                  "class"
                ),
              ]),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();

            const isClose =
              /close|dismiss|lucide-x/.test(
                metadata
              ) ||
              (
                button.textContent ||
                ""
              )
                .trim()
                .toLowerCase() ===
                "x";

            if (isClose) {
              (
                button as HTMLButtonElement
              ).click();

              return true;
            }
          }
        }
      }

      return false;
    });

  if (!clicked) {
    await page.keyboard
      .press("Escape")
      .catch(
        () => undefined
      );
  }

  await waitUntil(
    async () =>
      !(
        await panel
          .isVisible()
          .catch(() => false)
      ),
    {
      timeoutMs: 5000,
      intervalMs: 250,
      label:
        "Source Code panel to close",
    }
  );

  log.info(
    "Source Code panel closed."
  );
}

async function captureSourceCodeCopy(
  page: Page
): Promise<string> {
  await clickIconButtonByHint(
    page,
    [
      /^copy$/i,
      /copy/i,
    ],
    "Source Code Copy"
  );

  let html = "";

  await waitUntil(
    async () => {
      try {
        html =
          await readClipboardText(page);

        return (
          html.trim().length > 0
        );
      } catch {
        return false;
      }
    },
    {
      timeoutMs:
        config.timeouts.clipboardMs,
      intervalMs: 500,
      label:
        "Source Code HTML clipboard",
    }
  );

  return html;
}

async function captureSourceCodeDownload(
  page: Page
): Promise<string> {
  const downloadPromise =
    page.waitForEvent(
      "download",
      {
        timeout: 10000,
      }
    );

  await clickIconButtonByHint(
    page,
    [/download/i],
    "Source Code Download"
  );

  const download =
    await downloadPromise;

  const filePath =
    path.join(
      os.tmpdir(),
      `uxpilot-${Date.now()}-${download.suggestedFilename()}`
    );

  await download.saveAs(
    filePath
  );

  const text =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  return text;
}

/**
 * Current live UXPilot route:
 * Select design -> Zoom Out -> Select design -> scroll ->
 * Select design -> Source Code -> Copy.
 *
 * The close operation is intentionally outside the retry so a successful
 * HTML capture can never cause repeated copy/open cycles.
 */
export async function copyAsHtml(
  page: Page
): Promise<string> {
  log.info(
    "Copying generated design HTML from Source Code..."
  );

  const html = await retry(
    async () => {
      await openSourceCodePanel(
        page
      );

      let capturedHtml = "";

      try {
        capturedHtml =
          await captureSourceCodeCopy(
            page
          );
      } catch (copyError) {
        log.warn(
          `Source Code copy failed, trying download fallback: ${
            copyError instanceof Error
              ? copyError.message
              : String(copyError)
          }`
        );

        capturedHtml =
          await captureSourceCodeDownload(
            page
          );
      }

      if (
        !capturedHtml ||
        capturedHtml.trim().length === 0
      ) {
        throw new Error(
          "Source Code returned empty HTML."
        );
      }

      log.info(
        `HTML captured successfully (${capturedHtml.length} characters).`
      );

      return capturedHtml;
    },
    {
      retries:
        config.retries.clipboard,
      label:
        "Source Code HTML export",
    }
  );

  // Return immediately after the HTML is captured.
  // The caller saves the file and updates Google Sheets before any Figma work.
  // The Source Code panel is closed only when the Figma step starts.
  return html;
}

/**
 * Select the generated design -> open UXPilot Export -> choose Figma under
 * COPY TO -> click the bottom "Export 1 screen" action -> wait for the
 * "1 screen copied! Paste to Figma ..." notification.
 */
export async function copyToFigma(
  page: Page
): Promise<void> {
  log.info("Copying design to Figma...");

  // Source Code may still be open after HTML capture.
  await closeSourceCodePanel(page);

  // Re-attach the floating toolbar to the actual generated screen.
  await prepareDesignToolbarForSourceCode(page);

  // Open the UXPilot Export panel from the selected design toolbar.
  await clickIconButtonByHint(
    page,
    [
      /^export$/i,
      /copy.*export/i,
      /copy\/export/i,
    ],
    "Export"
  );

  const selectedFigma = await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };

    const exactFigmaNodes = Array.from(document.querySelectorAll("*"))
      .filter((element) => visible(element) && normalize(element.textContent || "") === "Figma");

    for (const node of exactFigmaNodes) {
      let card: HTMLElement | null = null;
      let cursor: HTMLElement | null = node as HTMLElement;

      for (let depth = 0; depth < 8 && cursor; depth++, cursor = cursor.parentElement) {
        const cardText = normalize(cursor.innerText || cursor.textContent || "");
        const hasControl = Boolean(
          cursor.matches('label, button, [role="radio"]') ||
          cursor.querySelector('input[type="radio"], [role="radio"], button')
        );

        if (cardText === "Figma" && hasControl) {
          card = cursor;
          break;
        }
      }

      if (!card) continue;

      let inCopyTo = false;
      let section: HTMLElement | null = card;
      for (let depth = 0; depth < 10 && section; depth++, section = section.parentElement) {
        const sectionText = normalize(section.innerText || section.textContent || "");
        if (/\bCOPY TO\b/i.test(sectionText)) {
          inCopyTo = true;
          break;
        }
      }

      if (!inCopyTo) continue;

      (card as HTMLElement).click();

      const checked = Boolean(
        card.querySelector('input[type="radio"]:checked, [role="radio"][aria-checked="true"]')
      );
      const classText = `${card.className || ""} ${card.parentElement?.className || ""}`;
      const selectedState = /selected|active|checked/i.test(classText);

      if (!checked && !selectedState) {
        const label = card.closest("label") as HTMLElement | null;
        if (label && label !== card) label.click();
      }

      return true;
    }

    return false;
  });

  if (!selectedFigma) {
    throw new Error(
      "Could not select the standalone Figma option under COPY TO. Export options such as Figma (Nodey plugin) are intentionally excluded."
    );
  }

  log.info("Selected standalone Figma under COPY TO (Figma Nodey plugin excluded).");

  const exportScreenButton = page.getByRole(
    "button",
    { name: /export\s+1\s+screen/i }
  ).or(
    page.getByText(/export\s+1\s+screen/i)
  ).last();

  await exportScreenButton.waitFor({
    state: "visible",
    timeout: 10000,
  });

  await exportScreenButton.click();

  log.info(
    "Clicked 'Export 1 screen'. Waiting for the Figma copy confirmation..."
  );

  await waitUntil(
    async () => {
      const copiedToast = page.getByText(
        /1\s+screen\s+copied/i
      ).or(
        page.getByText(
          /paste\s+to\s+figma/i
        )
      );

      return (
        (await copiedToast.count()) > 0 &&
        (await copiedToast.last().isVisible().catch(() => false))
      );
    },
    {
      timeoutMs:
        config.timeouts.figmaCopyToastMs,
      intervalMs: 500,
      label:
        '"1 screen copied" Figma notification',
    }
  );

  log.info(
    'Received "1 screen copied" notification. Paste to Figma can continue.'
  );
}
