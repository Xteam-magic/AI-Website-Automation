import { logger } from "../logger/logger";
import { sleep } from "./wait";
import { config } from "../config/config";

export interface RetryOptions {
  /** Number of ADDITIONAL attempts after the first failure (matches config.retries.*). */
  retries: number;
  /** Delay between attempts, in milliseconds. Defaults to config.retryDelayMs. */
  delayMs?: number;
  /** Label used in log lines, e.g. "UXPilot Login". */
  label: string;
}

/**
 * Runs `operation`, retrying on failure up to `options.retries` additional
 * times. Rethrows the last error if every attempt fails, so the caller's own
 * error-handling path (screenshot -> log -> email -> status update -> stop)
 * always runs on final failure.
 */
export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const totalAttempts = options.retries + 1;
  const delayMs = options.delayMs ?? config.retryDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) {
        logger.info(`[Retry] "${options.label}" succeeded on attempt ${attempt}/${totalAttempts}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < totalAttempts) {
        logger.warn(`[Retry] "${options.label}" failed on attempt ${attempt}/${totalAttempts}: ${message}. Retrying in ${delayMs}ms.`);
        await sleep(delayMs);
      } else {
        logger.error(`[Retry] "${options.label}" failed on final attempt ${attempt}/${totalAttempts}`, err);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
