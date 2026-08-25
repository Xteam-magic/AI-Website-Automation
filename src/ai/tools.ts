import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { BrowserContext, Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { googleSheetService } from "../sheet/googleSheet";
import { ProjectRow } from "../types";

const execFileAsync = promisify(execFile);
const log = logger.scope("AI/Tools");

export interface ToolCall {
  action: string;
  args?: Record<string, unknown>;
  reason?: string;
  done?: boolean;
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/(password|api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, "$1: [REDACTED]")
    .slice(0, 30_000);
}

function repoPath(relativePath: string): string {
  const root = path.resolve(config.paths.root);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function getTab(pages: Map<string, Page>, tab: string | undefined): Page {
  const key = tab?.trim() || "main";
  const page = pages.get(key);
  if (!page) throw new Error(`Unknown browser tab "${key}".`);
  return page;
}

function locatorFromSpec(page: Page, spec: Record<string, unknown>, action: string) {
  const type = String(spec.type ?? "text").toLowerCase();
  const value = String(spec.value ?? "");
  if (!value) throw new Error(`${action}: locator value is empty.`);

  switch (type) {
    case "role":
      return page.getByRole(value as any, { name: spec.name ? String(spec.name) : undefined });
    case "label":
      return page.getByLabel(value);
    case "placeholder":
      return page.getByPlaceholder(value);
    case "text":
      return page.getByText(value, { exact: spec.exact !== false });
    case "css":
      return page.locator(value);
    default:
      throw new Error(`Unsupported locator type "${type}".`);
  }
}

async function inspectPage(page: Page): Promise<string> {
  const data = await page.evaluate(() => {
    const visible = (el: Element) => {
      const h = el as HTMLElement;
      const r = h.getBoundingClientRect();
      const s = window.getComputedStyle(h);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    };

    const buttons = Array.from(document.querySelectorAll("button"))
      .filter(visible)
      .slice(0, 120)
      .map((el) => ({ text: (el.textContent || "").replace(/\s+/g, " ").trim(), aria: el.getAttribute("aria-label"), title: el.getAttribute("title") }))
      .filter((x) => x.text || x.aria || x.title);

    const links = Array.from(document.querySelectorAll("a[href]"))
      .filter(visible)
      .slice(0, 120)
      .map((el) => ({ text: (el.textContent || "").replace(/\s+/g, " ").trim(), href: (el as HTMLAnchorElement).href }))
      .filter((x) => x.text || x.href);

    const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
      .filter(visible)
      .slice(0, 100)
      .map((el) => ({ tag: el.tagName, type: el.getAttribute("type"), name: el.getAttribute("name"), id: el.getAttribute("id"), placeholder: el.getAttribute("placeholder"), aria: el.getAttribute("aria-label"), value: (el as HTMLInputElement).value?.slice(0, 200) }));

    return {
      url: location.href,
      title: document.title,
      buttons,
      links,
      inputs,
      text: (document.body?.innerText || "").slice(0, 25_000),
    };
  });

  return JSON.stringify(data, null, 2);
}

function allowedUrl(row: ProjectRow, target: string): boolean {
  const url = new URL(target);
  if (["http:", "https:"].includes(url.protocol) === false) return false;

  const allowed = new Set<string>();
  for (const value of Object.values(row.rawColumns)) {
    const matches = String(value).match(/https?:\/\/[^\s|),]+/gi) ?? [];
    for (const match of matches) {
      try { allowed.add(new URL(match).host); } catch { /* ignore malformed values */ }
    }
  }
  allowed.add(new URL(config.urls.uxpilotLogin).host);
  allowed.add(new URL(config.urls.elementorConverter).host);
  allowed.add(new URL(config.urls.figma).host);

  return allowed.has(url.host);
}

function assertSafeCommand(command: string): void {
  const trimmed = command.trim();
  const forbidden = [
    /(^|\s)sudo(\s|$)/i,
    /git\s+(push|reset|clean|checkout\s+--)/i,
    /rm\s+-rf/i,
    /mkfs/i,
    /dd\s+if=/i,
    /curl\s+/i,
    /wget\s+/i,
    /ssh\s+/i,
    /scp\s+/i,
    /chmod\s+/i,
    /chown\s+/i,
    />\s*\/etc\//i,
  ];
  if (forbidden.some((pattern) => pattern.test(trimmed))) {
    throw new Error("Command rejected by the Phase 2 safety guard.");
  }

  const allowedPrefix = /^(npm|npx|node|php|git\s+(status|diff|log)|grep|find|ls|cat|sed|awk|tail|head|pwd|test|stat)(\s|$)/i;
  if (!allowedPrefix.test(trimmed)) {
    throw new Error(`Command not allowed: ${trimmed.split(/\s+/)[0]}`);
  }
}

export async function executeTool(
  context: BrowserContext,
  pages: Map<string, Page>,
  row: ProjectRow,
  tool: ToolCall
): Promise<string> {
  const args = tool.args ?? {};

  switch (tool.action) {
    case "browser.new_tab": {
      const id = String(args.tab || `tab-${pages.size}`);
      if (pages.has(id)) throw new Error(`Tab "${id}" already exists.`);
      const page = await context.newPage();
      pages.set(id, page);
      return JSON.stringify({ tab: id, url: page.url() });
    }

    case "browser.list_tabs": {
      return JSON.stringify(Array.from(pages.entries()).map(([id, page]) => ({ id, url: page.url(), title: page.title().catch(() => "") })));
    }

    case "browser.navigate": {
      const url = String(args.url || "");
      if (!allowedUrl(row, url)) throw new Error(`Navigation blocked: ${url} is not in the project URL allowlist.`);
      const page = getTab(pages, String(args.tab || "main"));
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.timeouts.aiActionMs });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      return JSON.stringify({ url: page.url(), title: await page.title() });
    }

    case "browser.inspect": {
      const page = getTab(pages, String(args.tab || "main"));
      return inspectPage(page);
    }

    case "browser.click": {
      const page = getTab(pages, String(args.tab || "main"));
      const locator = locatorFromSpec(page, args.locator as Record<string, unknown>, "browser.click").first();
      await locator.click({ timeout: config.timeouts.aiActionMs });
      return JSON.stringify({ clicked: true, url: page.url() });
    }

    case "browser.fill": {
      const page = getTab(pages, String(args.tab || "main"));
      const locator = locatorFromSpec(page, args.locator as Record<string, unknown>, "browser.fill").first();
      await locator.fill(String(args.text ?? ""), { timeout: config.timeouts.aiActionMs });
      return JSON.stringify({ filled: true });
    }

    case "browser.press": {
      const page = getTab(pages, String(args.tab || "main"));
      await page.keyboard.press(String(args.key || "Enter"));
      return JSON.stringify({ pressed: String(args.key || "Enter") });
    }

    case "browser.wait": {
      const page = getTab(pages, String(args.tab || "main"));
      const ms = Math.min(Math.max(Number(args.ms || 1000), 0), config.timeouts.aiActionMs);
      await page.waitForTimeout(ms);
      return JSON.stringify({ waited_ms: ms });
    }

    case "fs.list": {
      const target = repoPath(String(args.path || "."));
      const entries = await fs.promises.readdir(target, { withFileTypes: true });
      return JSON.stringify(entries.slice(0, 300).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "dir" : "file" })));
    }

    case "fs.read": {
      const target = repoPath(String(args.path || ""));
      const content = await fs.promises.readFile(target, "utf8");
      const start = Number(args.startLine || 1);
      const end = Number(args.endLine || Math.min(content.split(/\r?\n/).length, start + 500));
      const lines = content.split(/\r?\n/).slice(Math.max(0, start - 1), end);
      return sanitizeOutput(lines.join("\n"));
    }

    case "fs.search": {
      const term = String(args.term || "");
      if (!term) throw new Error("fs.search requires term.");
      const target = repoPath(String(args.path || "."));
      const { stdout } = await execFileAsync("grep", ["-RIn", "--exclude-dir=.git", "--exclude-dir=node_modules", term, target], { maxBuffer: 2_000_000 });
      return sanitizeOutput(stdout);
    }

    case "fs.write": {
      const target = repoPath(String(args.path || ""));
      const parent = path.dirname(target);
      await fs.promises.mkdir(parent, { recursive: true });
      await fs.promises.writeFile(target, String(args.content ?? ""), "utf8");
      return JSON.stringify({ written: true, path: path.relative(config.paths.root, target) });
    }

    case "exec.command": {
      const command = String(args.command || "");
      assertSafeCommand(command);
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], { cwd: config.paths.root, maxBuffer: 4_000_000, timeout: config.timeouts.aiActionMs });
      return JSON.stringify({ stdout: sanitizeOutput(stdout), stderr: sanitizeOutput(stderr) });
    }

    case "sheet.read": {
      return JSON.stringify({ headers: row.headers, columns: row.rawColumns, project_cost: row.projectCost, ai_engine_note: row.aiEngineNote }, null, 2);
    }

    case "sheet.update": {
      const header = String(args.header || "");
      if (!row.headers.some((h) => h.trim().toLowerCase() === header.trim().toLowerCase())) {
        throw new Error(`Sheet column "${header}" does not exist in the live header row.`);
      }
      const value = String(args.value ?? "");
      await googleSheetService.updateColumnByHeader(row.rowNumber, header, value);
      const actualHeader = row.headers.find((h) => h.trim().toLowerCase() === header.trim().toLowerCase()) || header;
      row.rawColumns[actualHeader] = value;
      if (actualHeader.trim().toLowerCase() === "ai engine note") row.aiEngineNote = value;
      if (actualHeader.trim().toLowerCase() === "project cost") row.projectCost = value;
      return JSON.stringify({ updated: true, header: actualHeader });
    }

    case "finish": {
      return JSON.stringify({ finish: true, result: args });
    }

    default:
      throw new Error(`Unknown AI action "${tool.action}".`);
  }
}
