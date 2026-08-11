import { google, sheets_v4 } from "googleapis";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";
import {
  ClientDevMethod,
  CurrentStep,
  EditSpec,
  PageSpec,
  ProjectLevel,
  ProjectRow,
  ProjectRowUpdate,
  ProjectStatus,
  YesNo,
} from "../types";

const log = logger.scope("GoogleSheet");

/**
 * Maps a Google Sheet header (exact text, per docs/06_Sheet_Structure.txt) to
 * the ProjectRow field it fills. Reading and writing both go through this
 * map, so columns are always matched by header text, never by fixed
 * position — the live sheet's column order does not need to match this
 * list. If a header is renamed in the sheet, only this map needs editing.
 */
const HEADER_MAP: Record<string, keyof ProjectRow> = {
  "Project ID": "projectId",
  Status: "status",
  "Project Name": "projectName",
  "Required Project Level": "requiredProjectLevel",
  "User ID": "userId",
  "User Name": "userName",
  "User Phone": "userPhone",
  "User Email": "userEmail",
  "Full Project Doc": "fullProjectDoc",
  "Design System": "designSystem",
  "Brand Description": "brandDescription",
  "Color Palette": "colorPalette",
  Fonts: "fonts",
  Language: "language",
  Pages: "pages",
  "Count Page": "countPage",
  "Source Links": "sourceLinks",
  "Source Images": "sourceImages",
  "Logo URL": "logoUrl",
  "Figma Needed": "figmaNeeded",
  "Mobile Version": "mobileVersion",
  "Client Dev Method": "clientDevMethod",
  Deadline: "deadline",
  "Project Cost": "projectCost",
  "AI Suggestions": "aiSuggestions",
  "User Suggestions": "userSuggestions",
  "Payment Status": "paymentStatus",
  "User Rate": "userRate",
  "Design URL": "designUrl",
  "HTML File": "htmlFile",
  "JSON File": "jsonFile",
  "Edits After Design": "editsAfterDesign",
  "Current Step": "currentStep",
  "Current Page": "currentPage",
  "Last Run Time": "lastRunTime",
  "Last Finished Time": "lastFinishedTime",
  "Run ID": "runId",
  "Retry Count": "retryCount",
  "Last Error": "lastError",
};

/** Converts a 0-based column index into its A1 letter (0 -> A, 26 -> AA, ...). */
function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * Strict JSON parsing for the Pages / Edits After Design columns, per
 * project decision: if the cell is non-empty but not valid JSON, this is
 * treated as a data error and throws rather than guessing at the content.
 * An empty cell is valid and means "no items" (e.g. no pending edits).
 */
function parseJsonColumn<T>(raw: string, columnName: string, rowNumber: number): T[] {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("expected a JSON array");
    }
    return parsed as T[];
  } catch (err) {
    throw new Error(
      `Row ${rowNumber}: column "${columnName}" is not valid JSON (${(err as Error).message}). ` +
        `Fix the cell content in the Google Sheet — this project cannot be safely processed as-is.`
    );
  }
}

function parseYesNo(raw: string): YesNo {
  return (raw ?? "").trim().toLowerCase() === "yes" ? "Yes" : "No";
}

function parseNumber(raw: string, fallback: number): number {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Source Images is documented only as "لینک تصاویر مرجع" with no specified
 * delimiter. This assumes one URL per line, or comma-separated — whichever
 * the sheet actually uses. Adjust this one function if the live sheet uses
 * a different separator.
 */
function parseSourceImages(raw: string): string[] {
  return (raw ?? "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class GoogleSheetService {
  private sheetsApi: sheets_v4.Sheets | null = null;
  private sheetTitle: string | null = null;
  private headers: string[] = [];

  private async getApi(): Promise<sheets_v4.Sheets> {
    if (this.sheetsApi) {
      return this.sheetsApi;
    }
    const credentials = JSON.parse(config.secrets.googleServiceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.sheetsApi = google.sheets({ version: "v4", auth });
    return this.sheetsApi;
  }

  /** The Sheet ID's URL only pins a gid (tab), not a name, so the first tab's title is read dynamically. */
  private async getSheetTitle(): Promise<string> {
    if (this.sheetTitle) {
      return this.sheetTitle;
    }
    const api = await this.getApi();
    const meta = await api.spreadsheets.get({ spreadsheetId: config.secrets.googleSheetId });
    const firstSheet = meta.data.sheets?.[0]?.properties?.title;
    if (!firstSheet) {
      throw new Error("Could not determine the first sheet/tab name from the spreadsheet.");
    }
    this.sheetTitle = firstSheet;
    return firstSheet;
  }

  /** Reads every project row from the sheet, fully parsed and typed. */
  async getAllRows(): Promise<ProjectRow[]> {
    return retry(() => this.fetchAllRows(), {
      retries: config.retries.googleSheet,
      label: "Google Sheet: read rows",
    });
  }

  private async fetchAllRows(): Promise<ProjectRow[]> {
    const api = await this.getApi();
    const title = await this.getSheetTitle();

    const response = await api.spreadsheets.values.get({
      spreadsheetId: config.secrets.googleSheetId,
      range: `${title}!A1:AZ`,
    });

    const values = response.data.values ?? [];
    if (values.length === 0) {
      log.warn("Sheet is empty (no header row found).");
      return [];
    }

    this.headers = values[0].map((h) => String(h ?? "").trim());
    const dataRows = values.slice(1);
    const projectRows: ProjectRow[] = [];

    dataRows.forEach((rawRow, i) => {
      const rowNumber = i + 2; // header is row 1, sheet rows are 1-indexed
      if (rawRow.every((cell) => String(cell ?? "").trim().length === 0)) {
        return; // skip fully blank rows
      }

      const byHeader: Record<string, string> = {};
      this.headers.forEach((header, colIndex) => {
        byHeader[header] = String(rawRow[colIndex] ?? "");
      });
      const get = (header: string): string => byHeader[header] ?? "";

      const row: ProjectRow = {
        rowNumber,
        projectId: get("Project ID"),
        // Deliberately NOT defaulted to "Start" — a blank Status must never
        // be picked up as a project to run.
        status: get("Status").trim() as ProjectStatus,
        projectName: get("Project Name"),
        requiredProjectLevel: (get("Required Project Level").trim() || "Medium") as ProjectLevel,
        userId: get("User ID"),
        userName: get("User Name"),
        userPhone: get("User Phone"),
        userEmail: get("User Email"),
        fullProjectDoc: get("Full Project Doc"),
        designSystem: get("Design System"),
        brandDescription: get("Brand Description"),
        colorPalette: get("Color Palette"),
        fonts: get("Fonts"),
        language: get("Language"),
        pages: parseJsonColumn<PageSpec>(get("Pages"), "Pages", rowNumber),
        countPage: parseNumber(get("Count Page"), 0),
        sourceLinks: get("Source Links"),
        sourceImages: parseSourceImages(get("Source Images")),
        logoUrl: get("Logo URL"),
        figmaNeeded: parseYesNo(get("Figma Needed")),
        mobileVersion: parseYesNo(get("Mobile Version")),
        clientDevMethod: (get("Client Dev Method").trim() || "HTML") as ClientDevMethod,
        deadline: get("Deadline"),
        projectCost: get("Project Cost"),
        aiSuggestions: get("AI Suggestions"),
        userSuggestions: get("User Suggestions"),
        paymentStatus: get("Payment Status"),
        userRate: get("User Rate"),
        designUrl: get("Design URL"),
        htmlFile: get("HTML File"),
        jsonFile: get("JSON File"),
        editsAfterDesign: parseJsonColumn<EditSpec>(get("Edits After Design"), "Edits After Design", rowNumber),
        currentStep: (get("Current Step").trim() || "Idle") as CurrentStep,
        currentPage: get("Current Page"),
        lastRunTime: get("Last Run Time"),
        lastFinishedTime: get("Last Finished Time"),
        runId: get("Run ID"),
        retryCount: parseNumber(get("Retry Count"), 0),
        lastError: get("Last Error"),
      };

      if (row.countPage === 0 && row.pages.length > 0) {
        row.countPage = row.pages.length;
      }

      projectRows.push(row);
    });

    return projectRows;
  }

  /**
   * Picks exactly one row to run this invocation, in the confirmed priority
   * order: Resume (Running) -> Edits After Design (Completed + edits
   * pending) -> new Start project. Returns null if nothing needs to run,
   * which is a normal, successful outcome (the workflow just exits).
   */
  selectNextRow(rows: ProjectRow[]): { row: ProjectRow; mode: "resume" | "edit" | "start" } | null {
    const running = rows.find((r) => r.status === "Running");
    if (running) {
      log.info(`Resuming interrupted project: ${running.projectName} (row ${running.rowNumber})`);
      return { row: running, mode: "resume" };
    }

    const needsEdit = rows.find((r) => r.status === "Completed" && r.editsAfterDesign.length > 0);
    if (needsEdit) {
      log.info(`Found completed project with pending edits: ${needsEdit.projectName} (row ${needsEdit.rowNumber})`);
      return { row: needsEdit, mode: "edit" };
    }

    const start = rows.find((r) => r.status === "Start");
    if (start) {
      log.info(`Found new project to start: ${start.projectName} (row ${start.rowNumber})`);
      return { row: start, mode: "start" };
    }

    return null;
  }

  /** Writes only the given fields back to their exact columns on the given row. */
  async updateRow(rowNumber: number, update: ProjectRowUpdate): Promise<void> {
    await retry(() => this.applyUpdate(rowNumber, update), {
      retries: config.retries.googleSheet,
      label: `Google Sheet: update row ${rowNumber}`,
    });
  }

  private async applyUpdate(rowNumber: number, update: ProjectRowUpdate): Promise<void> {
    if (this.headers.length === 0) {
      await this.fetchAllRows();
    }

    const api = await this.getApi();
    const title = await this.getSheetTitle();

    const reverseMap = new Map<keyof ProjectRow, string>();
    for (const [header, field] of Object.entries(HEADER_MAP)) {
      reverseMap.set(field, header);
    }

    const serialize = (field: keyof ProjectRow, value: unknown): string => {
      if (field === "editsAfterDesign") {
        return JSON.stringify(value ?? []);
      }
      return value === undefined || value === null ? "" : String(value);
    };

    const data: sheets_v4.Schema$ValueRange[] = [];

    for (const [field, value] of Object.entries(update) as [keyof ProjectRowUpdate, unknown][]) {
      const header = reverseMap.get(field as keyof ProjectRow);
      if (!header) {
        continue;
      }
      const colIndex = this.headers.indexOf(header);
      if (colIndex === -1) {
        log.warn(`Column "${header}" not found in the live sheet header row — skipping this field.`);
        continue;
      }
      data.push({
        range: `${title}!${columnLetter(colIndex)}${rowNumber}`,
        values: [[serialize(field, value)]],
      });
    }

    if (data.length === 0) {
      return;
    }

    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: config.secrets.googleSheetId,
      requestBody: { valueInputOption: "RAW", data },
    });
  }
}

export const googleSheetService = new GoogleSheetService();
