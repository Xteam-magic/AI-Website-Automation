import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("UXPilot/Login");

/**
 * SELECTOR NOTES — READ BEFORE THE FIRST LIVE RUN
 * -------------------------------------------------
 * This environment has no general internet access, so these selectors were
 * never verified against the live https://uxpilot.ai/login DOM — they are
 * written against the general shape of a typical email/password login form,
 * using Playwright's role/label/placeholder locators (resilient to CSS
 * changes) instead of raw class selectors wherever possible.
 *
 * Everything UXPilot-DOM-specific is isolated in this one object. If a step
 * fails on the first real run, fix the matching line here — the functions
 * below should not need to change.
 */
const selectors = {
  emailInput: (page: Page) => page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)),
  passwordInput: (page: Page) => page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)),
  submitButton: (page: Page) => page.getByRole("button", { name: /log ?in|sign ?in/i }),
  // Present only once actually logged into the dashboard.
  loggedInIndicator: (page: Page) => page.getByRole("button", { name: /create new/i }),
  loginErrorMessage: (page: Page) => page.getByText(/invalid|incorrect|failed|wrong password/i),
};

/** True if the current page looks like the logged-in UXPilot dashboard. */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (!url.includes("uxpilot.ai") || url.includes("/login")) {
    return false;
  }
  return (await selectors.loggedInIndicator(page).count()) > 0;
}

async function attemptLogin(page: Page): Promise<void> {
  log.info("Navigating to login page...");
  await page.goto(config.urls.uxpilotLogin, { waitUntil: "domcontentloaded" });

  await selectors.emailInput(page).first().fill(config.secrets.uxEmail);
  await selectors.passwordInput(page).first().fill(config.secrets.uxPassword);
  await selectors.submitButton(page).first().click();

  await waitUntil(
    async () => {
      if ((await selectors.loginErrorMessage(page).count()) > 0) {
        throw new Error("UXPilot reported a login error (invalid credentials or blocked login).");
      }
      return isLoggedIn(page);
    },
    { timeoutMs: config.timeouts.loginMs, intervalMs: 1_000, label: "UXPilot login" }
  );

  log.info("Login successful.");
}

/** Logs into UXPilot, retrying per config.retries.login (3 additional attempts = 4 total). */
export async function login(page: Page): Promise<void> {
  await retry(() => attemptLogin(page), { retries: config.retries.login, label: "UXPilot Login" });
}

/**
 * Called before any step that requires an authenticated session. Re-logs in
 * once if the session looks expired, per the project's "check before every
 * step, re-login once if needed" rule — it does not blindly log in every
 * time, since a fresh login on every step would be unnecessary and slow.
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  if (await isLoggedIn(page)) {
    return;
  }
  log.warn("Session appears expired or missing. Re-authenticating...");
  await login(page);
}
