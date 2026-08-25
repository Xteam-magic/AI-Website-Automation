import type { BrowserContext, Page } from "playwright";
import { logger } from "../logger/logger";
import { config } from "../config/config";
import { PageSpec, ProjectRow } from "../types";
import { googleSheetService } from "./googleSheet";

const log = logger.scope("SheetContent");

const DRIVE_FILE_RE = /https?:\/\/(?:drive\.google\.com|docs\.google\.com)\/[^\s|)]+/gi;
const DRIVE_ID_RE = /(?:\/d\/|id=)([A-Za-z0-9_-]{10,})/i;

function extractUrls(value: string): string[] {
  return Array.from(value.matchAll(DRIVE_FILE_RE)).map((m) =>
    m[0].replace(/[),]+$/, "")
  );
}

function extractDriveId(url: string): string | null {
  return url.match(DRIVE_ID_RE)?.[1] ?? null;
}

function looksLikeDriveContentLink(value: string): boolean {
  const urls = extractUrls(value);
  return urls.length === 1 && Boolean(extractDriveId(urls[0]));
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function isHtmlDocument(text: string): boolean {
  const sample = text.trimStart().slice(0, 500).toLowerCase();
  return (
    sample.startsWith("<!doctype html") ||
    sample.startsWith("<html") ||
    sample.startsWith("<head") ||
    sample.startsWith("<body")
  );
}

async function readRenderedText(page: Page): Promise<string> {
  // Prefer the actual text container used by file previews when available.
  const candidates: string[] = [];

  for (const selector of ["pre", "code", "[role=\"document\"]"]) {
    const texts = await page.locator(selector).allInnerTexts().catch(() => []);
    for (const text of texts) {
      if (text.trim()) candidates.push(text);
    }
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].replace(/\u00a0/g, " ").trim();
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  return bodyText.replace(/\u00a0/g, " ").trim();
}

async function tryDownloadRawText(
  context: BrowserContext,
  id: string,
  sourceUrl: string
): Promise<string | null> {
  const downloadUrls = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
  ];

  for (const downloadUrl of downloadUrls) {
    const response = await context.request
      .get(downloadUrl, {
        timeout: config.timeouts.driveContentMs,
        failOnStatusCode: false,
        headers: {
          Accept: "text/plain,text/markdown,text/*,*/*;q=0.8",
        },
      })
      .catch(() => null);

    if (!response || !response.ok()) continue;

    const text = stripBom(await response.text());
    if (!text.trim() || isHtmlDocument(text)) continue;

    log.info(
      `Raw Drive download resolved for ${sourceUrl} (${text.length} chars).`
    );
    return text;
  }

  return null;
}

/**
 * Opens the Drive URL in a new browser tab first, waits for the viewer to
 * settle, and then retrieves the raw text using the same authenticated browser
 * context. The viewer text is used only as a final fallback when Drive does
 * not expose a raw download response; it is never preferred over raw content.
 */
async function readDriveFileThroughBrowser(
  context: BrowserContext,
  url: string
): Promise<string> {
  const tab = await context.newPage();
  try {
    log.info(`Opening Drive content in a new browser tab: ${url}`);

    await tab.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeouts.driveContentMs,
    });

    // Wait for the viewer and its file contents to finish rendering before any
    // extraction. networkidle is best-effort because Drive may keep long-lived
    // connections open.
    await tab.waitForLoadState("networkidle", {
      timeout: config.timeouts.driveContentMs,
    }).catch(() => undefined);
    await tab.waitForTimeout(750).catch(() => undefined);

    const id = extractDriveId(url);
    if (!id) throw new Error(`Could not resolve Drive file id from ${url}`);

    // IMPORTANT: always prefer the raw file response. This prevents Google
    // Drive's viewer chrome, toolbar text, page counters, and filenames from
    // being mixed into the actual .md/.json content.
    const raw = await tryDownloadRawText(context, id, url);
    if (raw !== null) return raw;

    // Fallback for files that can be viewed in-browser but cannot be downloaded
    // through the authenticated request context. Keep extraction conservative
    // so we do not silently pretend viewer chrome is file content.
    const rendered = await readRenderedText(tab);
    const cleanRendered = stripViewerChrome(rendered);
    if (
      cleanRendered.length > 0 &&
      !/sign in to continue|request access|you need access/i.test(cleanRendered)
    ) {
      log.warn(
        `Raw download was unavailable for ${url}; using rendered file text fallback (${cleanRendered.length} chars).`
      );
      return cleanRendered;
    }

    throw new Error(`Could not retrieve readable raw content from Drive file ${url}.`);
  } finally {
    await tab.close().catch(() => undefined);
  }
}

function stripViewerChrome(text: string): string {
  // This fallback is intentionally minimal. Raw downloads are the primary path,
  // so we avoid deleting arbitrary lines that could legitimately exist in an MD
  // or text file.
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const t = line.trim();
    return !/^(Open with|Download|Share|Organize|More actions|File details|Google Drive)$/i.test(t);
  });
  return filtered.join("\n").trim();
}

function extractJsonArrayCandidate(text: string): string | null {
  const source = stripBom(text).trim();
  if (!source) return null;

  // First attempt the complete text unchanged.
  if (source.startsWith("[")) {
    return source;
  }

  // Google Drive's viewer may wrap a text file with UI text. Extract the first
  // complete top-level JSON array without changing anything inside the array.
  const start = source.indexOf("[");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1).trim();
      }
    }
  }

  return null;
}

function parseJsonPages(text: string): PageSpec[] | null {
  const candidate = extractJsonArrayCandidate(text);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return null;

    const pages = parsed
      .map((item) => {
        const page = String(
          item?.page ?? item?.name ?? item?.title ?? ""
        ).trim();
        const prompt = String(item?.prompt ?? "").trim();
        const description = String(
          item?.description ?? item?.content ?? prompt
        ).trim();

        const priorityRaw = Number(item?.priority);
        const priority = Number.isFinite(priorityRaw)
          ? priorityRaw
          : undefined;

        const pageStatus = String(item?.status ?? "").trim() || undefined;

        return {
          page,
          description,
          prompt: prompt || undefined,
          priority,
          pageStatus,
        } satisfies PageSpec;
      })
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
    .map((item) => ({
      ...item,
      description: item.description.trim(),
    }))
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
      if (/^(pages?|صفحات?|صفحه(?:‌ها)?|project pages)$/i.test(title)) {
        continue;
      }
      if (current) items.push(current);
      current = { page: title, description: "" };
      continue;
    }
    if (current) current.description += `${rawLine}\n`;
  }

  if (current) items.push(current);

  return items
    .map((item) => ({
      ...item,
      description: item.description.trim(),
    }))
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
      "Expected a JSON array of page objects, 'Page: Name' blocks, or Markdown headings."
  );
}

function setResolvedKnownField(
  row: ProjectRow,
  header: string,
  content: string
): void {
  const normalized = header.toLowerCase().replace(/\s+/g, " ").trim();

  if (normalized === "full project doc") row.fullProjectDoc = content;
  else if (normalized === "design system") row.designSystem = content;
  else if (normalized === "brand description") row.brandDescription = content;
  else if (normalized === "color palette") row.colorPalette = content;
  else if (normalized === "fonts") row.fonts = content;
  else if (normalized === "source links") row.sourceLinks = content;
  else if (normalized === "source images") {
    row.sourceImages = content
      .split(/\r?\n|,/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  else if (normalized === "user suggestions") row.userSuggestions = content;
  else if (normalized === "ai suggestions") row.aiSuggestions = content;
  else if (normalized === "pages") {
    row.pages = parsePagesDocument(content);
    row.countPage = row.pages.length;
  }
  else if (normalized === "edits after design") {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error(
        "Edits After Design Drive document must contain a JSON array."
      );
    }
    row.editsAfterDesign = parsed
      .map((item) => ({
        page: String(item?.page ?? "").trim(),
        edit: String(item?.edit ?? "").trim(),
      }))
      .filter((item) => item.page && item.edit);
  }
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

  await googleSheetService.updateRow(row.rowNumber, {
    currentStep: "Resolve Drive Content",
  });

  for (const header of candidateHeaders) {
    const original = row.rawColumns[header] ?? "";
    const url = extractUrls(original)[0];
    const content = await readDriveFileThroughBrowser(context, url);

    // The rawColumns object is the source of truth for every current and future
    // MD/text column. This means new long-content columns automatically receive
    // the complete raw file contents without requiring a code change.
    row.rawColumns[header] = content;
    setResolvedKnownField(row, header, content);

    log.info(
      `Resolved Google Drive content for column "${header}" (${content.length} chars).`
    );
  }

  return row;
}
