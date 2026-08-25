import fs from "fs";
import path from "path";
import type { BrowserSession } from "../browser/browser";
import { googleSheetService } from "../sheet/googleSheet";
import { logger } from "../logger/logger";
import { config } from "../config/config";
import { buildPrompt } from "../prompts/buildPrompt";
import {
  generateDesktop,
  generateMobile,
  MobileGenerateError,
} from "../uxpilot/generate";
import { copyAsHtml, copyToFigma } from "../uxpilot/export";
import { pasteIntoFigma } from "../figma/paste";
import { convertHtmlToElementor } from "../elementor/convert";
import {
  sendPageCompletedEmail,
  sendPageStartedEmail,
} from "../gmail/mail";
import {
  PageSpec,
  ProjectLevel,
  ProjectRow,
} from "../types";

const log = logger.scope("PageRunner");

export interface RunPageParams {
  session: BrowserSession;
  row: ProjectRow;
  pageSpec: PageSpec;
  /** 1-based position of this page within the project. */
  pageIndex: number;
  totalPages: number;
  isEditRun: boolean;
  /** Combined edit instructions for this page — only set when isEditRun is true. */
  editsText?: string;
}

function estimatedMinutesForLevel(level: ProjectLevel): number {
  return Math.round(
    config.timeouts.generateByLevel[level] / 60_000
  );
}

/** Saves the exported HTML to downloads/{projectId}/{pageName}/index.html and returns the absolute path. */
function saveHtmlToDisk(
  projectId: string,
  pageName: string,
  html: string
): string {
  const dir = path.join(
    config.paths.downloads,
    projectId,
    pageName
  );

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, "index.html");

  fs.writeFileSync(
    filePath,
    html,
    "utf-8"
  );

  return filePath;
}

function readFullLogs(): string {
  try {
    return fs.existsSync(config.paths.logFile)
      ? fs.readFileSync(config.paths.logFile, "utf-8")
      : "";
  } catch {
    return "";
  }
}

/**
 * Returns the public GitHub Pages URL for a generated HTML file.
 * The GitHub Pages artifact is uploaded from downloads/, so downloads/
 * itself is the publishing root and is not part of the public URL.
 */
function buildHtmlPublicUrl(
  projectId: string,
  pageName: string
): string {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedPageName = encodeURIComponent(pageName);

  return (
    `https://xteam-magic.github.io/AI-Website-Automation/` +
    `${encodedProjectId}/${encodedPageName}/index.html`
  );
}

function buildJsonPublicUrl(
  projectId: string,
  pageName: string
): string {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedPageName = encodeURIComponent(pageName);

  return (
    `https://xteam-magic.github.io/AI-Website-Automation/` +
    `${encodedProjectId}/${encodedPageName}/${encodeURIComponent(pageName)}.json`
  );
}

/**
 * Runs the full per-page pipeline: build prompt -> generate desktop
 * -> generate mobile (if requested) -> export HTML -> Figma (if requested)
 * -> Elementor (if requested) -> email -> sheet update.
 *
 * Project-level setup (login, create project, model, website, images) has
 * already happened before this is ever called — see projectRunner.ts.
 */
export async function runPage(
  params: RunPageParams
): Promise<void> {
  const {
    session,
    row,
    pageSpec,
    pageIndex,
    totalPages,
    isEditRun,
    editsText,
  } = params;

  const { page, context } = session;
  const pageLog = logger.scope(
    `Page:${pageSpec.page}`
  );

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      status: "Generating",
      currentStep: "Generate Desktop",
      currentPage: pageSpec.page,
    }
  );

  await sendPageStartedEmail({
    userEmail: row.userEmail,
    projectName: row.projectName,
    pageName: pageSpec.page,
    pageIndex,
    totalPages,
    estimatedMinutes:
      estimatedMinutesForLevel(
        row.requiredProjectLevel
      ),
  });

  const prompt = buildPrompt({
    projectName: row.projectName,
    designSystem: row.designSystem,
    fullProjectDoc: row.fullProjectDoc,
    pageName: pageSpec.page,
    pageDescription: pageSpec.description,
    pageIndex,
    totalPages,
    edits: editsText,
  });

  pageLog.info(
    isEditRun
      ? "Generating desktop design (edit run)..."
      : "Generating desktop design..."
  );

  await generateDesktop(
    page,
    prompt,
    row.requiredProjectLevel,
    async (fullPrompt) => {
      const promptHeader =
        `===== PAGE ${pageIndex}/${totalPages}: ${pageSpec.page} =====`;
      const promptBlock =
        `${promptHeader}\n${fullPrompt}`;

      const existingPrompt =
        row.fullUxPilotProjectPrompt?.trim() || "";

      const promptBlocks = existingPrompt
        ? existingPrompt
            .split(/\n\n===== PAGE /)
            .map((block, index) =>
              index === 0
                ? block
                : `===== PAGE ${block}`
            )
            .filter(Boolean)
        : [];
      const filteredPromptBlocks = promptBlocks.filter(
        (block) => !block.startsWith(promptHeader)
      );
      const fullProjectPrompt =
        [...filteredPromptBlocks, promptBlock].join("\n\n");

      await googleSheetService.updateRow(
        row.rowNumber,
        {
          fullUxPilotProjectPrompt: fullProjectPrompt,
        }
      );

      row.fullUxPilotProjectPrompt =
        fullProjectPrompt;
    }
  );

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      status: "Generated",
    }
  );

  let mobileFailed = false;

  if (row.mobileVersion === "Yes") {
    await googleSheetService.updateRow(
      row.rowNumber,
      {
        currentStep: "Generate Mobile",
      }
    );

    try {
      await generateMobile(
        page,
        row.requiredProjectLevel
      );
    } catch (err) {
      if (err instanceof MobileGenerateError) {
        mobileFailed = true;
        pageLog.warn(
          `Mobile generation failed, keeping the desktop result: ${err.message}`
        );
      } else {
        throw err;
      }
    }
  }

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      currentStep: "Export HTML",
    }
  );

  pageLog.info("Copying HTML...");

  const html = await copyAsHtml(page);

  const htmlFilePath = saveHtmlToDisk(
    row.projectId,
    pageSpec.page,
    html
  );

  const htmlPublicUrl = buildHtmlPublicUrl(
    row.projectId,
    pageSpec.page
  );

  const htmlEntry =
    `${pageSpec.page}: ${htmlPublicUrl}`;

  const existingHtml =
    row.htmlFile?.trim() || "";

  const htmlLines = existingHtml
    ? existingHtml
        .split(/\r?\n/)
        .filter(
          (line) =>
            !line.startsWith(
              `${pageSpec.page}: `
            )
        )
    : [];

  const htmlValue =
    [...htmlLines, htmlEntry].join("\n");

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      htmlFile: htmlValue,
    }
  );

  row.htmlFile = htmlValue;

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      fullLogs: readFullLogs(),
    }
  );

  if (row.figmaNeeded === "Yes") {
    await googleSheetService.updateRow(
      row.rowNumber,
      {
        currentStep: "Copy To Figma",
      }
    );

    await copyToFigma(page);

    await googleSheetService.updateRow(
      row.rowNumber,
      {
        currentStep: "Paste Figma",
      }
    );

    await pasteIntoFigma(context, {
      projectName: row.projectName,
      pageName: pageSpec.page,
      pageIndex: pageIndex - 1,
    });
  }

  let jsonFilePath: string | undefined;

  if (row.implementation === "Yes" && row.clientDevMethod.toLowerCase() === "elementor") {
    await googleSheetService.updateRow(
      row.rowNumber,
      {
        currentStep: "Elementor Convert",
      }
    );

    jsonFilePath =
      await convertHtmlToElementor(
        context,
        {
          html,
          projectId: row.projectId,
          pageName: pageSpec.page,
          accountEmail: row.convElementorAccount,
        }
      );

    const jsonPublicUrl = buildJsonPublicUrl(row.projectId, pageSpec.page);
    const jsonEntry = `${pageSpec.page}: ${jsonPublicUrl}`;
    const existingJson = row.jsonFile?.trim() || "";
    const jsonLines = existingJson
      ? existingJson.split(/\r?\n/).filter((line) => !line.startsWith(`${pageSpec.page}: `))
      : [];
    const jsonValue = [...jsonLines, jsonEntry].join("\n");

    await googleSheetService.updateRow(
      row.rowNumber,
      {
        currentStep: "Download JSON",
        jsonFile: jsonValue,
      }
    );
    row.jsonFile = jsonValue;
  }

  const isLastPage =
    pageIndex >= totalPages;

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      currentStep: "Send Email",
    }
  );

  await sendPageCompletedEmail({
    userEmail: row.userEmail,
    projectName: row.projectName,
    pageName: mobileFailed
      ? `${pageSpec.page} (Desktop Finished / Mobile Failed)`
      : pageSpec.page,
    nextStep: isLastPage
      ? "Project Completed"
      : "Next Page",
    htmlFilePath,
    jsonFilePath,
  });

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      currentStep: "Update Sheet",
    }
  );

  pageLog.info(
    `Page "${pageSpec.page}" completed${
      mobileFailed
        ? " (mobile failed)"
        : ""
    }.`
  );

  await googleSheetService.updateRow(
    row.rowNumber,
    {
      fullLogs: readFullLogs(),
    }
  );
}
