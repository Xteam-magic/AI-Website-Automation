import { logger } from "./logger/logger";
import { googleSheetService } from "./sheet/googleSheet";
import { launchBrowserSession, closeBrowserSession, BrowserSession } from "./browser/browser";
import { runProject } from "./runner/projectRunner";

const log = logger.scope("Scheduler");

/**
 * Entry point. Runs once per GitHub Actions invocation (hourly cron):
 * read the sheet, pick exactly one project (Resume -> Edits After Design ->
 * Start), run it end to end, then exit. No internal sleep/loop — the next
 * project, if any, is picked up by the next hourly trigger.
 */
async function main(): Promise<void> {
  log.info("Started");

  log.info("Loading projects from Google Sheet...");
  const rows = await googleSheetService.getAllRows();
  log.info(`Loaded ${rows.length} project row(s).`);

  const selection = googleSheetService.selectNextRow(rows);
  if (!selection) {
    log.info(
      "Nothing to do: no Running project to resume, no Completed project with pending Edits After Design, " +
        "and no project with Status=Start. Exiting cleanly."
    );
    return;
  }

  const { row, mode } = selection;
  log.info(`Selected project "${row.projectName}" (row ${row.rowNumber}) — mode: ${mode}.`);

  let session: BrowserSession | null = null;
  try {
    session = await launchBrowserSession();
    await runProject(session, row, mode);
    log.info(`Project "${row.projectName}" finished successfully.`);
  } finally {
    await closeBrowserSession(session);
  }
}

main()
  .then(() => {
    log.info("Finished.");
    process.exit(0);
  })
  .catch((err) => {
    log.error("Run failed", err);
    process.exit(1);
  });
