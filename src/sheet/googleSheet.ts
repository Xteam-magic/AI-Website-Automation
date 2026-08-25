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
  SheetColumnUpdate,
} from "../types";

const log = logger.scope("GoogleSheet");

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
  Implementation: "implementation",
  Deadline: "deadline",
  "Project Cost": "projectCost",
  "AI Suggestions": "aiSuggestions",
  "User Suggestions": "userSuggestions",
  "Payment Status": "paymentStatus",
  "User Rate": "userRate",
  "Design URL": "designUrl",
  "HTML File": "htmlFile",
  "JSON File": "jsonFile",
  "UX Pilot Account": "uxPilotAccount",
  "CONV Elementor Account": "convElementorAccount",
  "AI Token Account": "aiTokenAccount",
  "AI Engine Note": "aiEngineNote",
  "Edits After Design": "editsAfterDesign",
  "Current Step": "currentStep",
  "Current Page": "currentPage",
  "Last Run Time": "lastRunTime",
  "Last Finished Time": "lastFinishedTime",
  "Run ID": "runId",
  "Retry Count": "retryCount",
  "Last Error": "lastError",
  "Full Logs": "fullLogs",
  "Full ux pilio project prompt": "fullUxPilotProjectPrompt",
};

const READ_RANGE = "A1:ZZZ";

function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function looksLikeDriveDocumentLink(raw: string): boolean {
  const value = (raw ?? "").trim();
  return /^https?:\/\/(?:drive\.google\.com|docs\.google\.com)\//i.test(value);
}

/**
 * Pages and Edits After Design may now contain a Google Drive link instead of
 * inline JSON. Those cells are intentionally deferred until after the browser
 * session starts, because the workflow requirement is to open the Drive file
 * in a new tab and resolve its complete content there.
 *
 * Returning [] here is therefore not an error: hydrateProjectRowFromDrive()
 * replaces the deferred value before any page/edit processing begins.
 */
function parseJsonColumn<T>(raw: string, columnName: string, rowNumber: number): T[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  if (looksLikeDriveDocumentLink(trimmed)) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return parsed as T[];
  } catch (err) {
    throw new Error(
      `Row ${rowNumber}: column "${columnName}" is not valid JSON (${(err as Error).message}). ` +
      "For long-content columns, use a Google Drive file link; otherwise provide a valid JSON array."
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

function parseSourceImages(raw: string): string[] {
  return (raw ?? "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function getByAliases(byHeader: Record<string, string>, aliases: string[]): string {
  const normalized = new Map(Object.entries(byHeader).map(([k, v]) => [normalizeHeader(k), v]));
  for (const alias of aliases) {
    const value = normalized.get(normalizeHeader(alias));
    if (value !== undefined && String(value).trim() !== "") return String(value);
  }
  return "";
}

export class GoogleSheetService {
  private sheetsApi: sheets_v4.Sheets | null = null;
  private sheetTitle: string | null = null;
  private headers: string[] = [];

  private async getApi(): Promise<sheets_v4.Sheets> {
    if (this.sheetsApi) return this.sheetsApi;
    const credentials = JSON.parse(config.secrets.googleServiceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.sheetsApi = google.sheets({ version: "v4", auth });
    return this.sheetsApi;
  }

  private async getSheetTitle(): Promise<string> {
    if (this.sheetTitle) return this.sheetTitle;
    const api = await this.getApi();
    const meta = await api.spreadsheets.get({ spreadsheetId: config.secrets.googleSheetId });
    const firstSheet = meta.data.sheets?.[0]?.properties?.title;
    if (!firstSheet) throw new Error("Could not determine the first sheet/tab name.");
    this.sheetTitle = firstSheet;
    return firstSheet;
  }

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
      range: `${title}!${READ_RANGE}`,
    });

    const values = response.data.values ?? [];
    if (!values.length) {
      log.warn("Sheet is empty (no header row found).");
      return [];
    }

    this.headers = values[0].map((h) => String(h ?? "").trim());
    const dataRows = values.slice(1);
    const projectRows: ProjectRow[] = [];

    dataRows.forEach((rawRow, i) => {
      const rowNumber = i + 2;
      if (rawRow.every((cell) => String(cell ?? "").trim() === "")) return;

      const byHeader: Record<string, string> = {};
      this.headers.forEach((header, colIndex) => {
        byHeader[header] = String(rawRow[colIndex] ?? "");
      });
      const get = (header: string) => byHeader[header] ?? "";

      const row: ProjectRow = {
        rowNumber,
        projectId: get("Project ID"),
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
        implementation: parseYesNo(
          getByAliases(byHeader, ["Implementation", "Implement", "Implementation Needed"])
        ),
        deadline: get("Deadline"),
        projectCost: get("Project Cost"),
        aiSuggestions: get("AI Suggestions"),
        userSuggestions: get("User Suggestions"),
        paymentStatus: get("Payment Status"),
        userRate: get("User Rate"),
        designUrl: get("Design URL"),
        htmlFile: get("HTML File"),
        jsonFile: get("JSON File"),
        uxPilotAccount: getByAliases(byHeader, ["UX Pilot Account", "UXPilot Account"]),
        convElementorAccount: getByAliases(byHeader, ["CONV Elementor Account", "Elementor Account"]),
        aiTokenAccount: getByAliases(byHeader, ["AI Token Account", "AI API Key"]),
        aiEngineNote: getByAliases(byHeader, ["AI Engine Note", "AI Note"]),
        editsAfterDesign: parseJsonColumn<EditSpec>(get("Edits After Design"), "Edits After Design", rowNumber),
        currentStep: (get("Current Step").trim() || "Idle") as CurrentStep,
        currentPage: get("Current Page"),
        lastRunTime: get("Last Run Time"),
        lastFinishedTime: get("Last Finished Time"),
        runId: get("Run ID"),
        retryCount: parseNumber(get("Retry Count"), 0),
        lastError: get("Last Error"),
        fullLogs: get("Full Logs"),
        fullUxPilotProjectPrompt: get("Full ux pilio project prompt"),
        rawColumns: { ...byHeader },
        headers: [...this.headers],
      };

      if (row.countPage === 0 && row.pages.length > 0) row.countPage = row.pages.length;
      projectRows.push(row);
    });

    return projectRows;
  }

  selectNextRow(rows: ProjectRow[]): { row: ProjectRow; mode: "resume" | "edit" | "start" } | null {
    const resumable = rows.find((r) => r.status === "Running" || r.status === "AI Running");
    if (resumable) {
      log.info(`Resuming interrupted project: ${resumable.projectName} (row ${resumable.rowNumber})`);
      return { row: resumable, mode: "resume" };
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

  async updateRow(rowNumber: number, update: ProjectRowUpdate): Promise<void> {
    const entries: SheetColumnUpdate[] = [];
    for (const [field, value] of Object.entries(update)) {
      const header = Object.entries(HEADER_MAP).find(([, mapped]) => mapped === field)?.[0];
      if (!header) continue;
      entries.push({ header, value: this.serializeKnownField(field as keyof ProjectRow, value) });
    }
    await this.updateColumns(rowNumber, entries);
  }

  async updateColumns(rowNumber: number, updates: SheetColumnUpdate[]): Promise<void> {
    if (!updates.length) return;
    await retry(() => this.applyColumnUpdates(rowNumber, updates), {
      retries: config.retries.googleSheet,
      label: `Google Sheet: update row ${rowNumber}`,
    });
  }

  async updateColumnByHeader(rowNumber: number, header: string, value: string): Promise<void> {
    await this.updateColumns(rowNumber, [{ header, value }]);
  }

  getColumn(row: ProjectRow, header: string): string {
    return row.rawColumns[header] ?? "";
  }

  private serializeKnownField(field: keyof ProjectRow, value: unknown): string {
    if (field === "editsAfterDesign") return JSON.stringify(value ?? []);
    if (field === "pages") return JSON.stringify(value ?? []);
    if (field === "sourceImages") return Array.isArray(value) ? value.join("\n") : String(value ?? "");
    return value === undefined || value === null ? "" : String(value);
  }

  private async applyColumnUpdates(rowNumber: number, updates: SheetColumnUpdate[]): Promise<void> {
    if (!this.headers.length) await this.fetchAllRows();
    const api = await this.getApi();
    const title = await this.getSheetTitle();

    const data: sheets_v4.Schema$ValueRange[] = [];
    for (const { header, value } of updates) {
      const normalizedTarget = normalizeHeader(header);
      const colIndex = this.headers.findIndex((h) => normalizeHeader(h) === normalizedTarget);
      if (colIndex === -1) {
        log.warn(`Column "${header}" not found in the live sheet — skipping this field.`);
        continue;
      }
      data.push({
        range: `${title}!${columnLetter(colIndex)}${rowNumber}`,
        values: [[value]],
      });
    }

    if (!data.length) return;
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: config.secrets.googleSheetId,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });
  }
}

export const googleSheetService = new GoogleSheetService();
