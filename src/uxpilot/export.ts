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
    page.locator(
      'div.tl-frame-label'
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
      /lucide[-\s]?globe/.test(value) ||
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
 * Publish the selected generated UXPilot page, open the published page in a
 * fresh tab, open the browser-equivalent `view-source:` route, and return the
 * raw HTML source. UXPilot's Source Code panel is intentionally not used here
 * because it requires a paid tier in the customer's current account.
 */
async function publishAndCaptureRawHtml(
  page: Page,
  pageName: string
): Promise<{ publishedUrl: string; html: string }> {
  const globeButton = page.locator(
    'button:has(svg.lucide-globe):visible'
  ).first();

  await globeButton.waitFor({ state: "visible", timeout: 10_000 });
  await globeButton.click();
  log.info("Globe/publish button clicked. Waiting for Publish Settings...");

  const publishHeading = page.getByText(/^Publish Settings$/i).first();
  await publishHeading.waitFor({ state: "visible", timeout: 10_000 });

  const statusPublished = page.getByText(/^Published$/i).first();
  const statusNotPublished = page.getByText(/^Not published$/i).first();

  if (await statusNotPublished.isVisible().catch(() => false)) {
    const publishButton = page.getByRole("button", { name: /^Publish$/i }).last();
    await publishButton.waitFor({ state: "visible", timeout: 10_000 });
    await publishButton.click();
    log.info(`Publishing "${pageName}"...`);

    await waitUntil(
      async () => await statusPublished.isVisible().catch(() => false),
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        label: "published status",
      }
    );
  } else {
    await waitUntil(
      async () =>
        (await statusPublished.isVisible().catch(() => false)) ||
        (await statusNotPublished.isVisible().catch(() => false)),
      {
        timeoutMs: 10_000,
        intervalMs: 250,
        label: "publish status",
      }
    );
  }

  if (!(await statusPublished.isVisible().catch(() => false))) {
    throw new Error(`UXPilot page "${pageName}" is not published.`);
  }

  const copyLinkButton = page.locator('button[title="Copy Link"]:visible').last();
  await copyLinkButton.waitFor({ state: "visible", timeout: 10_000 });

  let publishedUrl = "";

  publishedUrl = await page.evaluate(() => {
    const visible = (el: Element) => {
      const h = el as HTMLElement;
      const r = h.getBoundingClientRect();
      const s = window.getComputedStyle(h);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    };
    const values = Array.from(document.querySelectorAll("input"))
      .filter(visible)
      .map((input) => (input as HTMLInputElement).value.trim())
      .filter((value) => /^https?:\/\//i.test(value));
    return values[values.length - 1] || "";
  });

  await copyLinkButton.click();

  if (!publishedUrl) {
    try {
      publishedUrl = await page.evaluate(async () => navigator.clipboard.readText());
    } catch {
      publishedUrl = "";
    }
  }

  publishedUrl = publishedUrl.trim();
  if (!/^https?:\/\//i.test(publishedUrl)) {
    throw new Error(`Could not retrieve published URL for "${pageName}".`);
  }

  log.info(`Published URL for "${pageName}": ${publishedUrl}`);

  // Close the publish dialog before opening the published URL in a separate tab.
  const closeButton = page.locator(
    'button:has(svg.lucide-x):visible'
  ).last();
  if (await closeButton.count()) {
    await closeButton.click().catch(() => undefined);
  }

  const sourcePage = await page.context().newPage();
  try {
    await sourcePage.goto(publishedUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await sourcePage.waitForLoadState("networkidle").catch(() => undefined);
    await sourcePage.waitForTimeout(1_000);

    // Browser menus (right-click -> View page source) are outside Playwright's
    // page DOM. The browser's exact equivalent is the view-source: URL, which
    // opens the same raw source document without depending on Chrome UI menus.
    await sourcePage.goto(`view-source:${publishedUrl}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await waitUntil(
      async () => {
        const text = await sourcePage.locator("body").innerText().catch(() => "");
        return text.trim().length > 0;
      },
      {
        timeoutMs: 30_000,
        intervalMs: 500,
        label: "raw page source to load",
      }
    );

    const html = await sourcePage.locator("body").innerText();
    if (!html.trim()) {
      throw new Error(`View-source returned empty HTML for "${pageName}".`);
    }

    log.info(`Raw published HTML captured for "${pageName}" (${html.length} characters).`);
    return { publishedUrl, html };
  } finally {
    await sourcePage.close().catch(() => undefined);
  }
}

async function selectGeneratedPageByName(
  page: Page,
  pageName: string
): Promise<void> {
  const normalizedTarget = pageName.replace(/\s+/g, " ").trim().toLowerCase();
  const labels = page.locator('div.tl-frame-label:visible');
  const count = await labels.count();

  for (let i = 0; i < count; i++) {
    const label = labels.nth(i);
    const text = (await label.innerText().catch(() => "")).replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) continue;

    const matches =
      text === normalizedTarget ||
      text.endsWith(`- ${normalizedTarget}`) ||
      text.includes(`- ${normalizedTarget}`);

    if (!matches) continue;

    log.info(`Selecting generated page "${pageName}"...`);
    await label.scrollIntoViewIfNeeded().catch(() => undefined);

    try {
      await label.click({ timeout: 5_000 });
    } catch {
      try {
        await label.click({ timeout: 5_000, force: true });
      } catch {
        await label.evaluate((el) => {
          (el as HTMLElement).dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }));
        });
      }
    }

    await waitUntil(
      async () => await isDesignToolbarVisible(page),
      {
        timeoutMs: 7_000,
        intervalMs: 250,
        label: `UXPilot toolbar after selecting ${pageName}`,
      }
    );

    log.info(`Generated page "${pageName}" selected successfully.`);
    return;
  }

  throw new Error(`Could not locate generated page frame "${pageName}".`);
}

/**
 * New HTML export path for the current UXPilot account:
 * select generated design -> globe/publish -> publish if needed -> Copy Link
 * -> open published URL -> view-source -> capture complete raw HTML.
 */
export async function copyAsHtml(
  page: Page,
  pageName?: string
): Promise<{ publishedUrl: string; html: string }> {
  log.info(
    `Exporting published HTML${pageName ? ` for "${pageName}"` : ""}...`
  );

  if (pageName) {
    await selectGeneratedPageByName(page, pageName);
  } else {
    await selectGeneratedDesign(page);
  }

  return retry(
    async () => publishAndCaptureRawHtml(page, pageName || "current page"),
    {
      retries: config.retries.clipboard,
      label: "Published page raw HTML export",
    }
  );
}

/**
 * New Figma path requested for the current UXPilot UI:
 * select page -> top-right Export -> Image -> Copy 1 screen -> wait for
 * successful copy notification. The caller then pastes the clipboard into
 * the configured Figma file.
 */
export async function copyToFigma(
  page: Page,
  pageName?: string
): Promise<void> {
  log.info(`Copying ${pageName ? `"${pageName}" ` : ""}design to Figma via Image export...`);

  if (pageName) {
    await selectGeneratedPageByName(page, pageName);
  } else {
    await selectGeneratedDesign(page);
  }

  const exportButton = page
    .getByRole("button", { name: /^Export$/i })
    .last();
  await exportButton.waitFor({ state: "visible", timeout: 10_000 });
  await exportButton.click();
  log.info("Top-right UXPilot Export button clicked.");

  const imageLabel = page
    .locator('label')
    .filter({ has: page.getByText(/^Image$/i) })
    .last();
  await imageLabel.waitFor({ state: "visible", timeout: 10_000 });
  await imageLabel.click();

  const imageRadio = imageLabel.locator('input[type="radio"]');
  await waitUntil(
    async () => await imageRadio.isChecked().catch(() => false),
    {
      timeoutMs: 5_000,
      intervalMs: 250,
      label: "Image export option selected",
    }
  );

  const copyScreenButton = page.getByRole(
    "button",
    { name: /^Copy\s+1\s+screen$/i }
  ).last();
  await copyScreenButton.waitFor({ state: "visible", timeout: 10_000 });

  await waitUntil(
    async () => await copyScreenButton.isEnabled().catch(() => false),
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      label: "Copy 1 screen button enabled",
    }
  );

  await copyScreenButton.click();
  log.info("Clicked 'Copy 1 screen'. Waiting for successful copy notification...");

  await waitUntil(
    async () => {
      const body = await page.locator("body").innerText().catch(() => "");
      return /1\s+screen\s+copied/i.test(body);
    },
    {
      timeoutMs: config.timeouts.figmaCopyToastMs,
      intervalMs: 500,
      label: 'Figma image copy confirmation',
    }
  );

  log.info('Figma image export copied successfully; clipboard is ready for Figma paste.');
}
