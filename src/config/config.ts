import path from "path";
import dotenv from "dotenv";
import { ProjectLevel } from "../types";

dotenv.config();

/** Reads a required environment variable or throws a clear, actionable error. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable "${name}". Set it in .env (local) or GitHub Secrets (CI).`
    );
  }
  return value;
}

/** Reads an optional environment variable, falling back to a default. */
function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

const ROOT_DIR = path.resolve(__dirname, "..", "..");

export const config = {
  /** Absolute paths for every folder the app writes to. */
  paths: {
    root: ROOT_DIR,
    downloads: path.join(ROOT_DIR, "downloads"),
    screenshots: path.join(ROOT_DIR, "screenshots"),
    logs: path.join(ROOT_DIR, "logs"),
    logFile: path.join(ROOT_DIR, "logs", "log.txt"),
  },

  /** External URLs. Only Figma/Elementor targets are env-driven; UXPilot's are fixed product URLs. */
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

  /** All timeouts in milliseconds. Nothing in the codebase should hardcode a timeout outside this object. */
  timeouts: {
    /** Max time to wait for the UXPilot login page round trip. */
    loginMs: 60_000,
    /** Max time to wait for a newly created project file to open. */
    createProjectMs: 120_000,
    /** Settle time after selecting a generation model. */
    modelSelectSettleMs: 5_000,
    /** Max time to wait for a reference website import to finish. */
    websiteImportMs: 60_000,
    /** Max time to wait for a single image upload to finish. */
    imageUploadMs: 30_000,
    /** Max time to wait for the clipboard to contain the exported HTML. */
    clipboardMs: 15_000,
    /** Max time to wait for the "Design copied! Paste in Figma" toast. */
    figmaCopyToastMs: 30_000,
    /** Max time to wait after pasting into Figma for the new frame to appear. */
    figmaPasteMs: 60_000,
    /** Max time to wait for the Web2Elementor HTML -> JSON conversion. */
    elementorConvertMs: 90_000,
    /** Max time to wait for the Elementor JSON file download to complete. */
    elementorDownloadMs: 30_000,
    /** Generate timeouts, keyed by Required Project Level. */
    generateByLevel: {
      Low: 4 * 60_000,
      Medium: 7 * 60_000,
      High: 10 * 60_000,
    } as Record<ProjectLevel, number>,
  },

  /**
   * Retry counts = number of ADDITIONAL attempts after the first failure.
   * e.g. retries.login = 3 means up to 4 total attempts.
   */
  retries: {
    login: 3,
    upload: 3,
    generate: 1,
    clipboard: 3,
    googleSheet: 3,
    email: 2,
  },

  /** Delay between retry attempts, in milliseconds. */
  retryDelayMs: 5_000,

  /** UXPilot generation model per Required Project Level. */
  modelByLevel: {
    High: "Glide Pro",
    Medium: "Glide",
    Low: "Fast",
  } as Record<ProjectLevel, string>,

  /** Email recipients that always receive a copy, in addition to the project's User Email. */
  email: {
    adminEmail: optionalEnv("ADMIN_EMAIL", "emad_1382@yahoo.com"),
  },

  /**
   * How long a project run is allowed to run before its own process should give up
   * and let the error-handling path take over (safety net under the GitHub Actions
   * job timeout).
   */
  maxRunDurationMs: 25 * 60_000,

  /** Lazily-validated secrets. Call the getter, don't read process.env directly elsewhere. */
  secrets: {
    get uxEmail() {
      return requireEnv("UX_EMAIL");
    },
    get uxPassword() {
      return requireEnv("UX_PASSWORD");
    },
    get googleServiceAccountJson() {
      return requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
    },
    get googleSheetId() {
      return requireEnv("GOOGLE_SHEET_ID");
    },
    get gmailEmail() {
      return requireEnv("GMAIL_EMAIL");
    },
    get gmailAppPassword() {
      return requireEnv("GMAIL_APP_PASSWORD");
    },
    get githubRunId() {
      return optionalEnv("GITHUB_RUN_ID", "local");
    },
  },
} as const;

export type AppConfig = typeof config;
