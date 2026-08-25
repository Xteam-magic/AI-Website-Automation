import path from "path";
import dotenv from "dotenv";
import { ProjectLevel } from "../types";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable "${name}". Set it in .env (local) or GitHub Secrets.`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

const ROOT_DIR = path.resolve(__dirname, "..", "..");

export const config = {
  paths: {
    root: ROOT_DIR,
    downloads: path.join(ROOT_DIR, "downloads"),
    screenshots: path.join(ROOT_DIR, "screenshots"),
    logs: path.join(ROOT_DIR, "logs"),
    logFile: path.join(ROOT_DIR, "logs", "log.txt"),
  },

  urls: {
    uxpilotLogin: "https://uxpilot.ai/login",
    uxpilotDashboard: "https://uxpilot.ai/a/ui-list",
    figma: optionalEnv(
      "FIGMA_URL",
      "https://www.figma.com/design/NLkFc0NtOqUnR9Fh6madRL/ENGAR-KE"
    ),
    elementorConverter: optionalEnv(
      "ELEMENTOR_URL",
      "https://web2elementor.com/html-to-elementor/"
    ),
  },

  timeouts: {
    loginMs: 60_000,
    createProjectMs: 120_000,
    modelSelectSettleMs: 5_000,
    websiteImportMs: 60_000,
    imageUploadMs: 30_000,
    clipboardMs: 15_000,
    figmaCopyToastMs: 45_000,
    figmaPasteMs: 90_000,
    elementorLoginMs: 60_000,
    elementorConvertMs: 90_000,
    elementorDownloadMs: 30_000,
    driveContentMs: 45_000,
    aiRequestMs: 120_000,
    aiActionMs: 60_000,
    aiLoopMs: 20 * 60_000,
    aiMaxSteps: 80,
    generateByLevel: {
      Low: 4 * 60_000,
      Medium: 7 * 60_000,
      High: 10 * 60_000,
    } as Record<ProjectLevel, number>,
  },

  retries: {
    login: 3,
    upload: 3,
    generate: 1,
    clipboard: 3,
    googleSheet: 3,
    email: 2,
    ai: 2,
  },

  retryDelayMs: 5_000,

  modelByLevel: {
    High: "Glide Pro",
    Medium: "Glide",
    Low: "Fast",
  } as Record<ProjectLevel, string>,

  email: {
    adminEmail: optionalEnv("ADMIN_EMAIL", "emad_1382@yahoo.com"),
  },

  ai: {
    gapGptBaseUrl: optionalEnv("AI_BASE_URL", "https://api.gapgpt.app/v1"),
    provider: optionalEnv("AI_PROVIDER", "openai-compatible"),
    model: optionalEnv("AI_MODEL", "gpt-4o-mini"),
    temperature: Number(optionalEnv("AI_TEMPERATURE", "0")),
    maxOutputTokens: Number(optionalEnv("AI_MAX_OUTPUT_TOKENS", "5000")),
  },

  maxRunDurationMs: 25 * 60_000,

  secrets: {
    /** Kept for backward compatibility; phase 1 now reads the account email from the sheet. */
    get uxEmail() {
      return optionalEnv("UX_EMAIL", "");
    },
    /** Shared fixed password for all UXPilot accounts in the sheet. */
    get uxSharedPassword() {
      return optionalEnv("UXPILOT_SHARED_PASSWORD", process.env.UX_PASSWORD ?? "");
    },
    /** Shared fixed password for all Elementor-converter accounts in the sheet. */
    get elementorSharedPassword() {
      return optionalEnv("ELEMENTOR_SHARED_PASSWORD", process.env.ELEMENTOR_PASSWORD ?? process.env.UX_PASSWORD ?? "");
    },
    get googleServiceAccountJson() {
      return requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
    },
    get googleSheetId() {
      return requireEnv("GOOGLE_SHEET_ID");
    },
    get resendApiKey() {
      return requireEnv("RESEND_API_KEY");
    },
    get githubRunId() {
      return optionalEnv("GITHUB_RUN_ID", "local");
    },
  },
} as const;

export type AppConfig = typeof config;
