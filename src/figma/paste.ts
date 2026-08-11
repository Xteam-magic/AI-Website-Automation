import type { BrowserContext } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("Figma");

/**
 * HIGHEST-RISK MODULE IN THE PROJECT — READ BEFORE THE FIRST LIVE RUN
 * -----------------------------------------------------------------------
 * Figma's canvas is rendered as WebGL inside a <canvas> element, not as
 * normal DOM — there is no reliable way to query it with CSS/role
 * selectors, and Figma's public REST API has no "paste this clipboard
 * content" endpoint (that only exists inside the app's own UI). So this
 * module can only automate the same physical actions a human would take:
 * click somewhere on the canvas, then paste. It cannot know where the
 * "first empty space" actually is.
 *
 * The pragmatic approximation used here: click at a fixed point that shifts
 * further right for each page index, so sequential pastes in a multi-page
 * project land side by side with spacing instead of stacking on top of each
 * other (this matches the doc's "place frames side by side with spacing"
 * requirement, without needing real canvas introspection).
 *
 * Frame renaming relies on Figma's "select a layer, press Enter to rename"
 * shortcut, which may not match the live product exactly. Treat this whole
 * file as the first thing to verify — and most likely adjust — against a
 * real run, per docs/05_Deployment_and_Test.md's Debug Checklist.
 */
const CANVAS_BASE_X = 400;
const CANVAS_BASE_Y = 400;
const CANVAS_PAGE_SPACING_X = 1600;

const selectors = {
  // Figma's toolbar is real DOM even though the canvas itself isn't.
  canvasArea: (page: import("playwright").Page) => page.locator("#canvas, [data-testid='canvas'], canvas").first(),
};

/**
 * Opens a fresh tab for the given Figma file, pastes the clipboard content
 * (already populated by uxpilot/export.ts's copyToFigma) into the canvas,
 * renames the resulting frame, then closes the tab — leaving the caller's
 * original UXPilot page/session untouched.
 */
export async function pasteIntoFigma(
  context: BrowserContext,
  params: { projectName: string; pageName: string; pageIndex: number }
): Promise<void> {
  const figmaPage = await context.newPage();

  try {
    log.info(`Opening Figma file: ${config.urls.figma}`);
    await figmaPage.goto(config.urls.figma, { waitUntil: "domcontentloaded" });

    // Figma's editor is a heavy web app; give it a moment to finish
    // mounting the canvas before interacting with it.
    await waitUntil(async () => (await selectors.canvasArea(figmaPage).count()) > 0, {
      timeoutMs: config.timeouts.figmaPasteMs,
      label: "Figma canvas to load",
    });

    const targetX = CANVAS_BASE_X + params.pageIndex * CANVAS_PAGE_SPACING_X;
    await figmaPage.mouse.click(targetX, CANVAS_BASE_Y);

    await figmaPage.keyboard.press("Control+V");

    // No reliable "paste finished" DOM signal exists, so this is a fixed
    // settle wait rather than a polled condition — unlike every other wait
    // in this project. Revisit if pastes are still landing incomplete.
    await figmaPage.waitForTimeout(5_000);

    const frameName = `${params.projectName} - ${params.pageName}`;
    log.info(`Renaming pasted frame to "${frameName}"...`);
    await figmaPage.keyboard.press("Enter"); // Figma: rename the selected layer
    await figmaPage.keyboard.press("Control+A");
    await figmaPage.keyboard.type(frameName);
    await figmaPage.keyboard.press("Enter");

    log.info("Paste and rename complete.");
  } finally {
    await figmaPage.close();
  }
}
