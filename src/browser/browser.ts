import { chromium, Browser, BrowserContext, Page } from "playwright";
import { logger } from "../logger/logger";

const log = logger.scope("Browser");

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Launches a single headless Chromium instance for the whole project run.
 *
 * Because the scheduler model is "one project per GitHub Actions run", a
 * single session is created here and reused across every step of that one
 * project — login, create project, generate, export, Figma, Elementor — so
 * the UXPilot session cookie stays valid for the whole run without
 * re-authenticating between steps. A new session is only ever created once
 * per run, in index.ts.
 */
export async function launchBrowserSession(): Promise<BrowserSession> {
  log.info("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    // Copy HTML / Copy to Figma round-trip through the OS clipboard —
    // without this grant, Playwright's Chromium blocks clipboard access
    // and those reads silently return an empty string.
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  log.info("Browser ready.");
  return { browser, context, page };
}

/** Closes the browser session. Callers should always do this in a finally block. */
export async function closeBrowserSession(session: BrowserSession | null): Promise<void> {
  if (!session) {
    return;
  }
  try {
    await session.context.close();
    await session.browser.close();
    log.info("Browser closed.");
  } catch (err) {
    log.error("Error while closing browser", err);
  }
}
