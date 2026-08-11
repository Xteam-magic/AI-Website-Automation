import fs from "fs";
import path from "path";
import { config } from "../config/config";

type LogLevel = "INFO" | "WARN" | "ERROR";

function ensureLogFile(): void {
  if (!fs.existsSync(config.paths.logs)) {
    fs.mkdirSync(config.paths.logs, { recursive: true });
  }
  if (!fs.existsSync(config.paths.logFile)) {
    fs.writeFileSync(config.paths.logFile, "", "utf-8");
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLine(level: LogLevel, message: string): void {
  const line = `[${timestamp()}] [${level}] ${message}`;

  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }

  try {
    ensureLogFile();
    fs.appendFileSync(config.paths.logFile, line + "\n", "utf-8");
  } catch (err) {
    // Logging must never crash the app. If the file write fails, the console
    // line above (and, on GitHub Actions, the job log) is still the record.
    console.error(`[${timestamp()}] [ERROR] Logger failed to write to disk: ${(err as Error).message}`);
  }
}

/** A logger scoped to a stage name, e.g. logger.scope("UXPilot"). */
export interface ScopedLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

function scope(stageName: string): ScopedLogger {
  return {
    info(message: string) {
      writeLine("INFO", `[${stageName}] ${message}`);
    },
    warn(message: string) {
      writeLine("WARN", `[${stageName}] ${message}`);
    },
    error(message: string, error?: unknown) {
      const detail = error instanceof Error ? ` :: ${error.message}` : error ? ` :: ${String(error)}` : "";
      writeLine("ERROR", `[${stageName}] ${message}${detail}`);
    },
  };
}

export const logger = {
  info: (message: string) => writeLine("INFO", message),
  warn: (message: string) => writeLine("WARN", message),
  error: (message: string, error?: unknown) => {
    const detail = error instanceof Error ? ` :: ${error.message}` : error ? ` :: ${String(error)}` : "";
    writeLine("ERROR", `${message}${detail}`);
  },
  scope,
  /** Absolute path to the log file, exposed for the GitHub Actions "Upload Logs" step. */
  logFilePath: config.paths.logFile,
};
