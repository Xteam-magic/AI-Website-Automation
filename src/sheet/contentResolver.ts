import type { BrowserContext, Page } from "playwright";
import { logger } from "../logger/logger";
import { config } from "../config/config";
import { PageSpec, ProjectRow } from "../types";
import { googleSheetService } from "./googleSheet";

const log = logger.scope("SheetContent");

const DRIVE_FILE_RE = /https?:\/\/(?:drive\.google\.com|docs\.google\.com)\/[^\s|)]+/gi;
const DRIVE_ID_RE = /(?:\/d\/|id=)([A-Za-z0-9_-]{10,})/i;

function extractUrls(value: string): string[] {
  return Array.from(value.matchAll(DRIVE_FILE_RE)).map((m) => m[0].replace(/[),]+$/, ""));
}

function extractDriveId(url: string): string | null {
  return url.match(DRIVE_ID_RE)?.[1] ?? null;
}

function looksLikeDriveContentLink(value: string): boolean {
  return extractUrls(value).length === 1 && Boolean(extractDriveId(extractUrls(value)[0]));
}

async function readRenderedText(page: Page): Promise<string> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return bodyText.replace(/\u00a0/g, " ").trim();
}

async function readDriveFileThroughBrowser(context: BrowserContext, url: string): Promise<string> {
  const tab = await context.newPage();
  try {
    log.info(`Opening Drive content in a new browser tab: ${url}`);
    await tab.goto(url, { waitUntil: "domcontentloaded", timeout: config.timeouts.driveContentMs });
    await tab.waitForLoadState("networkidle").catch(() => undefined);

    const rendered = await readRenderedText(tab);
    const cleanRendered = stripViewerChrome(rendered);
    if (cleanRendered.length > 100 && !/sign in to continue|request access/i.test(cleanRendered)) {
      return cleanRendered;
    }

    const id = extractDriveId(url);
    if (!id) throw new Error(`Could not resolve Drive file id from ${url}`);

    // The browser tab is intentionally opened first, as required by the sheet flow.
    // The same browser context is then used to fetch the raw file bytes/text.
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    const response = await context.request.get(downloadUrl, { timeout: config.timeouts.driveContentMs });
    if (!response.ok()) {
      throw new Error(`Drive file download failed for ${url}: HTTP ${response.status()}`);
    }
    const text = await response.text();
    if (!text.trim()) throw new Error(`Drive file ${url} returned empty content.`);
    return text.trim();
  } finally {
    await tab.close().catch(() => undefined);
  }
}

function stripViewerChrome(text: string): string {
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const t = line.trim();
    return !/^(Open with|Download|Share|Organize|More actions|Google Drive|File details)$/i.test(t);
  });
  return filtered.join("\n").trim();
}

function parseJsonPages(text: string): PageSpec[] | null {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    const pages = parsed
      .map((item) => ({
        page: String(item?.page ?? item?.name ?? item?.title ?? "").trim(),
        description: String(item?.description ?? item?.content ?? "").trim(),
      }))
      .filter((item) => item.page.length > 0);
    return pages.length ? pages : null;
  } catch {
    return null;
  }
}

function parsePageBlocksByLabel(text: string): PageSpec[] {
  const lines = text.split(/\r?\n/);
  const items: PageSpec[] = [];
  let current: PageSpec | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^(?:page|صفحه)\s*[:：-]\s*(.+)$/i);
    if (match) {
      if (current) items.push(current);
      current = { page: match[1].trim(), description: "" };
      continue;
    }
    if (current) current.description += `${rawLine}\n`;
  }
  if (current) items.push(current);
  return items
    .map((item) => ({ ...item, description: item.description.trim() }))
    .filter((item) => item.page && item.description);
}

function parseMarkdownPages(text: string): PageSpec[] {
  const lines = text.split(/\r?\n/);
  const items: PageSpec[] = [];
  let current: PageSpec | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    if (heading) {
      const title = heading[2].trim();
      if (/^(pages?|صفحات?|صفحه(?:‌ها)?|project pages)$/i.test(title)) continue;
      if (current) items.push(current);
      current = { page: title, description: "" };
      continue;
    }
    if (current) current.description += `${rawLine}\n`;
  }

  if (current) items.push(current);
  return items
    .map((item) => ({ ...item, description: item.description.trim() }))
    .filter((item) => item.page.length > 0);
}

export function parsePagesDocument(text: string): PageSpec[] {
  const json = parseJsonPages(text);
  if (json) return json;

  const labelled = parsePageBlocksByLabel(text);
  if (labelled.length) return labelled;

  const markdown = parseMarkdownPages(text);
  if (markdown.length) return markdown;

  throw new Error(
    "The Pages Drive document was read successfully, but no page sections could be parsed. " +
    "Use JSON pages, 'Page: Name' blocks, or Markdown headings for each page."
  );
}

export async function hydrateProjectRowFromDrive(
  context: BrowserContext,
  row: ProjectRow
): Promise<ProjectRow> {
  const candidateHeaders = row.headers.filter((header) => {
    const value = row.rawColumns[header] ?? "";
    return looksLikeDriveContentLink(value);
  });

  if (!candidateHeaders.length) return row;

  await googleSheetService.updateRow(row.rowNumber, { currentStep: "Resolve Drive Content" });

  for (const header of candidateHeaders) {
    const original = row.rawColumns[header] ?? "";
    const url = extractUrls(original)[0];
    const content = await readDriveFileThroughBrowser(context, url);
    row.rawColumns[header] = content;

    const normalized = header.toLowerCase();
    if (normalized === "full project doc") row.fullProjectDoc = content;
    else if (normalized === "design system") row.designSystem = content;
    else if (normalized === "brand description") row.brandDescription = content;
    else if (normalized === "color palette") row.colorPalette = content;
    else if (normalized === "fonts") row.fonts = content;
    else if (normalized === "source links") row.sourceLinks = content;
    else if (normalized === "source images") row.sourceImages = content.split(/\r?\n|,/).map((line) => line.trim()).filter(Boolean);
    else if (normalized === "user suggestions") row.userSuggestions = content;
    else if (normalized === "ai suggestions") row.aiSuggestions = content;
    else if (normalized === "edits after design") {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) throw new Error("Edits After Design Drive document must contain a JSON array.");
      row.editsAfterDesign = parsed.map((item) => ({ page: String(item?.page ?? "").trim(), edit: String(item?.edit ?? "").trim() })).filter((item) => item.page && item.edit);
    }
    else if (normalized === "pages") {
      row.pages = parsePagesDocument(content);
      row.countPage = row.pages.length;
    }

    log.info(`Resolved Google Drive content for column "${header}" (${content.length} chars).`);
  }

  return row;
}
