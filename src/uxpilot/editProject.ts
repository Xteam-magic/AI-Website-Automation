import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { waitUntil } from "../helpers/wait";

const log = logger.scope("UXPilot/EditProject");

/**
 * SELECTOR NOTES — same caveat as the other UXPilot files: unverified
 * against the live DOM, isolated here for easy fixing after the first real
 * run.
 */
const selectors = {
  projectSearchInput: (page: Page) => page.getByPlaceholder(/search/i),
  projectCard: (page: Page, projectName: string) => page.getByText(projectName, { exact: false }),
  editorReadyIndicator: (page: Page) => page.getByRole("button", { name: /generate|send/i }),
  pageTab: (page: Page, pageName: string) => page.getByRole("tab", { name: new RegExp(pageName, "i") }).or(page.getByText(new RegExp(`^${pageName}$`, "i"))),
};

/**
 * Opens the UXPilot dashboard, finds a previously created project by name,
 * and opens it. Used for the "Edits After Design" flow, where the project
 * already exists and only needs a specific page re-generated.
 */
export async function openExistingProject(page: Page, projectName: string): Promise<void> {
  log.info(`Opening existing project "${projectName}"...`);

  await page.goto(config.urls.uxpilotDashboard, { waitUntil: "domcontentloaded" });

  const searchInput = selectors.projectSearchInput(page);
  if ((await searchInput.count()) > 0) {
    await searchInput.first().fill(projectName);
  }

  await selectors.projectCard(page, projectName).first().click();

  await waitUntil(async () => (await selectors.editorReadyIndicator(page).count()) > 0, {
    timeoutMs: config.timeouts.createProjectMs,
    label: "existing project editor to open",
  });

  log.info("Existing project opened.");
}

/** Switches the open project to the specific page that needs editing. */
export async function openPageForEdit(page: Page, pageName: string): Promise<void> {
  log.info(`Selecting page "${pageName}" for edit...`);
  await selectors.pageTab(page, pageName).first().click();
}
