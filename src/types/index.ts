/**
 * Shared type definitions used across the whole project.
 * This is the single source of truth for the shape of a Google Sheet row
 * and for the closed vocabularies (Status / Current Step) the rest of the
 * system relies on.
 */

/** Canonical Status values. Nothing else may ever be written to the Status column. */
export type ProjectStatus =
  | "Start"
  | "Running"
  | "Generating"
  | "Generated"
  | "Waiting Export"
  | "Completed"
  | "Error Login"
  | "Error Generate"
  | "Error Export"
  | "Error Elementor"
  | "Needs Review"
  | "Paused";

/** Canonical Current Step values, used for resume + debugging. */
export type CurrentStep =
  | "Idle"
  | "Read Sheet"
  | "Login"
  | "Create Project"
  | "Open Project"
  | "Upload Context"
  | "Upload Website"
  | "Upload Images"
  | "Generate Desktop"
  | "Generate Mobile"
  | "Export HTML"
  | "Copy To Figma"
  | "Paste Figma"
  | "Elementor Convert"
  | "Download JSON"
  | "Send Email"
  | "Update Sheet"
  | "Completed";

export type ProjectLevel = "High" | "Medium" | "Low";

export type YesNo = "Yes" | "No";

export type ClientDevMethod = "Elementor" | "HTML" | string;

/** One entry of the structured `Pages` JSON column. */
export interface PageSpec {
  page: string;
  description: string;
}

/** One entry of the structured `Edits After Design` JSON column. */
export interface EditSpec {
  page: string;
  edit: string;
}

/**
 * A single Google Sheet row, fully parsed and typed.
 * `rowNumber` is the 1-based row index in the sheet (needed to write updates
 * back to the exact same row).
 */
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

  deadline: string;
  projectCost: string;
  aiSuggestions: string;
  userSuggestions: string;
  paymentStatus: string;
  userRate: string;

  designUrl: string;
  htmlFile: string;
  jsonFile: string;

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
}

/** Fields that the runner is allowed to patch back to the sheet mid-flight. */
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
  >
>;
