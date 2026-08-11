import { EditSpec } from "../types";

export interface BuildPromptParams {
  projectName: string;
  designSystem: string;
  fullProjectDoc: string;
  pageName: string;
  pageDescription: string;
  pageIndex: number; // 1-based
  totalPages: number;
  /** Combined edit instructions for this page, only set on an edit run. */
  edits?: string;
}

/**
 * The ONLY place a UXPilot prompt is assembled, per project rule. Always
 * includes, in order: Project Name, Design System, Full Project Doc, and a
 * page-specific instruction block that tells the model exactly which page
 * of the project it is designing right now. Edits (if any) are appended
 * last so they read as an amendment to — not a replacement of — the base
 * project context.
 */
export function buildPrompt(params: BuildPromptParams): string {
  const sections: string[] = [
    `Project Name:\n${params.projectName}`,
    `Design System:\n${params.designSystem}`,
    `Full Project Doc:\n${params.fullProjectDoc}`,
    [
      `You are currently designing page ${params.pageIndex} of ${params.totalPages}.`,
      "",
      `Current Page: ${params.pageName}`,
      params.pageDescription ? `Page Description: ${params.pageDescription}` : "",
      "",
      "Follow all previous project rules.",
      "Keep consistency with previous pages.",
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  ];

  if (params.edits && params.edits.trim().length > 0) {
    sections.push(`Edits Requested For This Page:\n${params.edits.trim()}`);
  }

  return sections.join("\n\n---\n\n");
}

/** Flattens the Edits After Design entries for one page into a single instruction block. */
export function buildEditsTextForPage(edits: EditSpec[], pageName: string): string {
  return edits
    .filter((e) => e.page.trim().toLowerCase() === pageName.trim().toLowerCase())
    .map((e) => `- ${e.edit.trim()}`)
    .join("\n");
}
