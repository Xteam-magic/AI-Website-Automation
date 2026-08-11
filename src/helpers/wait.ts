/** Sleeps for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollOptions {
  /** Total time to keep polling before giving up, in milliseconds. */
  timeoutMs: number;
  /** Time to wait between checks, in milliseconds. */
  intervalMs?: number;
  /** Optional label used only for the timeout error message. */
  label?: string;
}

/**
 * Polls `check` until it resolves to true, or throws once `timeoutMs` elapses.
 * Used everywhere instead of a blind fixed sleep, per the project rule that
 * every wait must be tied to an actual condition (an element appearing, a
 * status changing, etc.) rather than a guessed delay.
 */
export async function waitUntil(
  check: () => Promise<boolean> | boolean,
  options: PollOptions
): Promise<void> {
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + options.timeoutMs;

  // Try immediately first, then poll.
  while (Date.now() <= deadline) {
    if (await check()) {
      return;
    }
    await sleep(intervalMs);
  }

  const label = options.label ? ` (${options.label})` : "";
  throw new Error(`Timed out after ${options.timeoutMs}ms waiting for condition${label}`);
}

/**
 * Races an arbitrary async operation against a timeout, throwing a labeled
 * error if the timeout wins. Useful for wrapping Playwright calls that don't
 * take their own timeout parameter.
 */
export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms (${label})`)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
