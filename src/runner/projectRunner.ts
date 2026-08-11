import type { BrowserSession } from "../browser/browser";
import { googleSheetService } from "../sheet/googleSheet";
import { logger } from "../logger/logger";
import { config } from "../config/config";
import { login } from "../uxpilot/login";
import { setupProjectContext } from "../uxpilot/createProject";
import { openExistingProject } from "../uxpilot/editProject";
import { captureErrorScreenshot } from "../helpers/screenshot";
import { sendErrorEmail, sendProjectCompletedEmail, sendProjectStartedEmail } from "../gmail/mail";
import { runPage } from "./pageRunner";
import { CurrentStep, PageSpec, ProjectRow, ProjectStatus } from "../types";
import { buildEditsTextForPage } from "../prompts/buildPrompt";

const log = logger.scope("ProjectRunner");

export type RunMode = "resume" | "edit" | "start";

function nowIso(): string {
  return new Date().toISOString();
}

/** Maps a failed step name to one of the canonical Error statuses. */
function mapStepToErrorStatus(step: string): ProjectStatus {
  const s = step.toLowerCase();
  if (s.includes("login")) return "Error Login";
  if (s.includes("generate")) return "Error Generate";
  if (s.includes("export") || s.includes("html") || s.includes("figma")) return "Error Export";
  if (s.includes("elementor") || s.includes("json")) return "Error Elementor";
  return "Needs Review";
}

/**
 * Central error handler for a whole project run: screenshot, log, email,
 * sheet status update — in that order, per project rule — before the
 * original error is rethrown by the caller to stop the workflow.
 */
async function handleFailure(session: BrowserSession, row: ProjectRow, step: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  log.error(`Project "${row.projectName}" failed at step "${step}"`, err);

  let screenshotPath: string | undefined;
  try {
    screenshotPath = await captureErrorScreenshot(session.page, row.projectName, row.currentPage || "project", step);
  } catch (screenshotErr) {
    log.error("Failed to capture error screenshot", screenshotErr);
  }

  try {
    await googleSheetService.updateRow(row.rowNumber, {
      status: mapStepToErrorStatus(step),
      lastError: message.slice(0, 500),
    });
  } catch (sheetErr) {
    log.error("Failed to write the error status back to the sheet", sheetErr);
  }

  try {
    await sendErrorEmail({
      userEmail: row.userEmail,
      projectName: row.projectName,
      step,
      errorMessage: message,
      lastUrl: session.page.url(),
      screenshotPath,
    });
  } catch (emailErr) {
    log.error("Failed to send the error email", emailErr);
  }
}

/** Runs every page in order. If startFromPageName is set (a resume), earlier pages are skipped. */
async function runAllPages(session: BrowserSession, row: ProjectRow, startFromPageName?: string): Promise<void> {
  const pages: PageSpec[] = row.pages;
  const startIndex = startFromPageName
    ? Math.max(
        0,
        pages.findIndex((p) => p.page.toLowerCase() === startFromPageName.toLowerCase())
      )
    : 0;

  for (let i = startIndex; i < pages.length; i++) {
    await runPage({
      session,
      row,
      pageSpec: pages[i],
      pageIndex: i + 1,
      totalPages: pages.length,
      isEditRun: false,
    });
  }
}

/** Runs only the pages named in Edits After Design. */
async function runEditPages(session: BrowserSession, row: ProjectRow): Promise<void> {
  const uniquePageNames = Array.from(new Set(row.editsAfterDesign.map((e) => e.page)));

  for (const pageName of uniquePageNames) {
    const pageSpec: PageSpec =
      row.pages.find((p) => p.page.toLowerCase() === pageName.toLowerCase()) ?? { page: pageName, description: "" };
    const editsText = buildEditsTextForPage(row.editsAfterDesign, pageName);
    const pageIndex = row.pages.findIndex((p) => p.page.toLowerCase() === pageName.toLowerCase());

    await runPage({
      session,
      row,
      pageSpec,
      pageIndex: pageIndex >= 0 ? pageIndex + 1 : 1,
      totalPages: row.pages.length || uniquePageNames.length,
      isEditRun: true,
      editsText,
    });
  }
}

/**
 * Runs one full project end to end, in one of three modes:
 * - "start": a brand-new project (Status was Start).
 * - "edit":  an already-Completed project with pending Edits After Design.
 * - "resume": a project left Running by an interrupted previous run.
 *
 * Resume strategy (documented simplification): pages strictly before
 * `Current Page` are treated as done and skipped; the in-progress page (and
 * everything after it) is (re)run from the beginning of the page pipeline.
 * Regenerating an in-progress page is safe — it simply overwrites that
 * page's output — and avoids trying to reconstruct fine-grained
 * sub-step state (mid-Figma-paste, mid-Elementor-convert, etc.) that does
 * not survive a crashed browser/process.
 */
export async function runProject(session: BrowserSession, row: ProjectRow, mode: RunMode): Promise<void> {
  let currentStep: CurrentStep = "Login";

  try {
    await googleSheetService.updateRow(row.rowNumber, {
      status: "Running",
      currentStep: "Login",
      lastRunTime: nowIso(),
      runId: config.secrets.githubRunId,
    });

    if (mode === "start") {
      await sendProjectStartedEmail({
        userEmail: row.userEmail,
        projectName: row.projectName,
        pageCount: row.pages.length,
        currentStage: "Login",
      });
    }

    await login(session.page);

    if (mode === "edit") {
      currentStep = "Open Project";
      await googleSheetService.updateRow(row.rowNumber, { currentStep });
      await openExistingProject(session.page, row.projectName);

      currentStep = "Generate Desktop";
      await runEditPages(session, row);

      await googleSheetService.updateRow(row.rowNumber, { editsAfterDesign: [] });
    } else if (mode === "start" || (mode === "resume" && !row.designUrl)) {
      // A resume with no Design URL yet means the previous run crashed
      // before the UXPilot project was even created — nothing to reopen,
      // so this behaves exactly like a fresh start.
      currentStep = "Create Project";
      await googleSheetService.updateRow(row.rowNumber, { currentStep });
      await setupProjectContext(session.page, row);
      await googleSheetService.updateRow(row.rowNumber, { designUrl: session.page.url() });

      currentStep = "Generate Desktop";
      await runAllPages(session, row, mode === "resume" ? row.currentPage || undefined : undefined);
    } else {
      // resume, project already exists
      currentStep = "Open Project";
      await googleSheetService.updateRow(row.rowNumber, { currentStep });
      await openExistingProject(session.page, row.projectName);

      currentStep = "Generate Desktop";
      await runAllPages(session, row, row.currentPage || undefined);
    }

    await googleSheetService.updateRow(row.rowNumber, {
      status: "Completed",
      currentStep: "Completed",
      lastFinishedTime: nowIso(),
    });
    await sendProjectCompletedEmail({ userEmail: row.userEmail, projectName: row.projectName });

    log.info(`Project "${row.projectName}" completed successfully.`);
  } catch (err) {
    await handleFailure(session, row, currentStep, err);
    throw err;
  }
}
