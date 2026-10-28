export const WAIT_TIMEOUT_MS = 30 * 1000;

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// Resolves after ms; rejects with the abort reason when the signal fires first
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Poll until getter returns a value, the signal fires, or the timeout expires (null in the last two cases)
export async function waitFor<T>(
  getter: () => T | null | undefined,
  {
    timeout = WAIT_TIMEOUT_MS,
    interval = 100,
    signal,
  }: { timeout?: number; interval?: number; signal?: AbortSignal } = {},
): Promise<T | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (signal?.aborted) return null;
    const value = getter();
    if (value) return value;
    try {
      await sleep(interval, signal);
    } catch {
      return null;
    }
  }
  return null;
}
