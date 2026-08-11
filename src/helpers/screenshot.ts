import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import { config } from "../config/config";
import { logger } from "../logger/logger";

function sanitize(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function timeForFilename(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${hh}-${mm}-${ss}`;
}

/**
 * Saves a screenshot for an error and returns its absolute path.
 * Per project rule, screenshots are ONLY taken on the error path (never at
 * the start of a step), so every call site is inside a catch block.
 */
export async function captureErrorScreenshot(
  page: Page,
  projectName: string,
  pageName: string,
  step: string
): Promise<string> {
  if (!fs.existsSync(config.paths.screenshots)) {
    fs.mkdirSync(config.paths.screenshots, { recursive: true });
  }

  const fileName = `${sanitize(projectName)}_${sanitize(pageName)}_${sanitize(step)}_${timeForFilename()}.png`;
  const filePath = path.join(config.paths.screenshots, fileName);

  try {
    await page.screenshot({ path: filePath, fullPage: true });
    logger.info(`Screenshot saved: ${filePath}`);
  } catch (err) {
    logger.error(`Failed to capture screenshot for step "${step}"`, err);
  }

  return filePath;
}
