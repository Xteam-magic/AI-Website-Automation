/**
 * Shared type definitions used across the whole project.
 * The Google Sheet remains the source of truth, but unknown/future columns are
 * preserved in `rawColumns` so the phase-2 AI engine can reason over every live
 * column without requiring a code release for each new sheet column.
 */

export type ProjectStatus =
  | "Start"
  | "Running"
  | "Generating"
  | "Generated"
  | "Waiting Export"
  | "Completed"
  | "AI Running"
  | "Error Login"
  | "Error Generate"
  | "Error Export"
  | "Error Elementor"
  | "Error AI"
  | "Needs Review"
  | "Paused";

export type CurrentStep =
  | "Idle"
  | "Read Sheet"
  | "Login"
  | "Create Project"
  | "Open Project"
  | "Resolve Drive Content"
  | "Upload Context"
  | "Upload Website"
  | "Upload Images"
  | "Generate Desktop"
  | "Generate Mobile"
  | "Export HTML"
  | "Copy To Figma"
  | "Paste Figma"
  | "Elementor Login"
  | "Elementor Convert"
  | "Download JSON"
  | "Send Email"
  | "Update Sheet"
  | "AI Load Context"
  | "AI Plan"
  | "AI Execute"
  | "AI Verify"
  | "AI Completed"
  | "Completed";

export type ProjectLevel = "High" | "Medium" | "Low";
export type YesNo = "Yes" | "No";
export type ClientDevMethod = "Elementor" | "HTML" | string;

export interface PageSpec {
  page: string;
  description: string;
}

export interface EditSpec {
  page: string;
  edit: string;
}

export interface ProjectRow {
  rowNumber: number;

  projectId: string;
  status: ProjectStatus;
  projectName: string;
  requiredProjectLevel: ProjectLevel;

  userId: string;
  userName: string;
  userPhone: string;
  userEmail: string;

  fullProjectDoc: string;
  designSystem: string;
  brandDescription: string;
  colorPalette: string;
  fonts: string;
  language: string;

  pages: PageSpec[];
  countPage: number;

  sourceLinks: string;
  sourceImages: string[];
  logoUrl: string;

  figmaNeeded: YesNo;
  mobileVersion: YesNo;
  clientDevMethod: ClientDevMethod;
  implementation: YesNo;

  deadline: string;
  projectCost: string;
  aiSuggestions: string;
  userSuggestions: string;
  paymentStatus: string;
  userRate: string;

  designUrl: string;
  htmlFile: string;
  jsonFile: string;

  uxPilotAccount: string;
  convElementorAccount: string;
  aiTokenAccount: string;
  aiEngineNote: string;

  editsAfterDesign: EditSpec[];

  currentStep: CurrentStep;
  currentPage: string;
  lastRunTime: string;
  lastFinishedTime: string;
  runId: string;
  retryCount: number;
  lastError: string;

  fullLogs: string;
  fullUxPilotProjectPrompt: string;

  /** Exact live header names and values from the current sheet. */
  rawColumns: Record<string, string>;
  /** Exact live headers as returned by the sheet. */
  headers: string[];
}

export type ProjectRowUpdate = Partial<
  Pick<
    ProjectRow,
    | "status"
    | "currentStep"
    | "currentPage"
    | "lastRunTime"
    | "lastFinishedTime"
    | "runId"
    | "retryCount"
    | "lastError"
    | "designUrl"
    | "htmlFile"
    | "jsonFile"
    | "editsAfterDesign"
    | "fullLogs"
    | "fullUxPilotProjectPrompt"
    | "aiEngineNote"
    | "projectCost"
  >
>;

export interface SheetColumnUpdate {
  header: string;
  value: string;
}
