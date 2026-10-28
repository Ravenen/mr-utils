import { sleep } from "@/utils/async";

const MAX_CONCURRENT_REQUESTS = 6;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_S = 10;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
    readonly retryAfter: number | null = null,
  ) {
    super(`GitLab API ${status}: ${path}`);
  }
}

export interface GitLabApi {
  fetch(path: string, init: RequestInit & { signal: AbortSignal }): Promise<Response>;
  graphql<T>(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<T>;
}

// Concurrency limit shared by every feature on the page
let activeRequests = 0;
const requestQueue: (() => void)[] = [];

function acquireRequestSlot(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const grant = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    // Leave the queue without taking a slot
    const onAbort = () => {
      requestQueue.splice(requestQueue.indexOf(grant), 1);
      reject(signal.reason);
    };
    requestQueue.push(grant);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function releaseRequestSlot() {
  const next = requestQueue.shift();
  if (next) next();
  else activeRequests--;
}

// Request the GitLab API with a concurrency limit. A 429 is retried only when GitLab asks
// for a short wait; a long Retry-After (gitlab.com can answer with ~1 hour) fails fast.
// onStart is called once the request leaves the queue.
async function apiFetch(
  path: string,
  { signal, onStart, ...init }: RequestInit & { signal: AbortSignal; onStart?: () => void },
): Promise<Response> {
  await acquireRequestSlot(signal);
  onStart?.();
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${location.origin}${path}`, { credentials: "same-origin", ...init, signal });
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("retry-after") ?? "", 10);
        const waitS = Number.isFinite(retryAfter) ? retryAfter : 2 ** attempt;
        if (attempt < MAX_RETRIES && waitS <= MAX_RETRY_AFTER_S) {
          await sleep(waitS * 1000, signal);
          continue;
        }
        throw new ApiError(429, path, Number.isFinite(retryAfter) ? retryAfter : null);
      }
      if (!response.ok) throw new ApiError(response.status, path);
      return response;
    }
  } finally {
    releaseRequestSlot();
  }
}

// Identical GraphQL requests in flight are shared, e.g. between a run superseded by GitLab's
// "?sort=...&state=opened" redirect and the run that replaces it. A request whose callers have all
// gone away is dropped while it still waits in the queue; once sent, it completes so that a new
// caller can still pick it up.
interface SharedRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  callers: number;
  started: boolean;
}
const inflightGraphql = new Map<string, SharedRequest>();

function startGraphql(body: string): SharedRequest {
  const shared: SharedRequest = {
    promise: Promise.resolve(),
    controller: new AbortController(),
    callers: 0,
    started: false,
  };
  shared.promise = (async () => {
    // GitLab treats a POST without the CSRF token as anonymous
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
    const response = await apiFetch("/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
      body,
      signal: shared.controller.signal,
      onStart: () => (shared.started = true),
    });
    const result = await response.json();
    if (result.errors?.length && !result.data) throw new Error(`GitLab GraphQL: ${result.errors[0].message}`);
    return result.data;
  })();
  shared.promise
    .finally(() => {
      if (inflightGraphql.get(body) === shared) inflightGraphql.delete(body);
    })
    .catch(() => {});
  inflightGraphql.set(body, shared);
  return shared;
}

function graphql<T>(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const body = JSON.stringify({ query, variables });
  const shared = inflightGraphql.get(body) ?? startGraphql(body);
  shared.callers++;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      shared.callers--;
      if (shared.callers === 0 && !shared.started) {
        inflightGraphql.delete(body);
        shared.controller.abort(signal.reason);
      }
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    shared.promise.then(
      (data) => {
        signal.removeEventListener("abort", onAbort);
        resolve(data as T);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export const gitlabApi: GitLabApi = { fetch: apiFetch, graphql };

// Current user ID, cached for the tab session; null when it cannot be loaded
export async function getCurrentUserId(signal: AbortSignal): Promise<number | null> {
  const cacheKey = "mr-utils/current-user-id";
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return parseInt(cached, 10);
  try {
    const userData = await (await apiFetch("/api/v4/user", { signal })).json();
    sessionStorage.setItem(cacheKey, String(userData.id));
    return userData.id;
  } catch {
    return null;
  }
}
