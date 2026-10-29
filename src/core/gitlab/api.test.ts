// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createGitLabApi, type GitLabApi } from "./api";

// fetch that answers only when told to
function controlledFetch() {
  const calls: { body: string; headers: Headers; resolve: (response: Response) => void }[] = [];
  const fetchMock = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ body: String(init.body), headers: new Headers(init.headers), resolve });
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const query = (n: number) => `query Q${n} { x }`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let gitlabApi: GitLabApi;
beforeEach(() => {
  gitlabApi = createGitLabApi({ origin: "https://gitlab.com", getCsrfToken: () => "token" });
});

describe("gitlabApi.graphql", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it("shares an identical request between callers", async () => {
    const { calls, fetchMock } = controlledFetch();
    const a = gitlabApi.graphql(query(1), {}, new AbortController().signal);
    const b = gitlabApi.graphql(query(1), {}, new AbortController().signal);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://gitlab.com/api/graphql");
    expect(calls[0]?.headers.get("X-CSRF-Token")).toBe("token");
    calls[0]?.resolve(json({ ok: 1 }));
    await expect(a).resolves.toEqual({ ok: 1 });
    await expect(b).resolves.toEqual({ ok: 1 });
  });

  it("rejects an aborted caller without failing the others", async () => {
    const { calls } = controlledFetch();
    const aborted = new AbortController();
    const a = gitlabApi.graphql(query(2), {}, aborted.signal);
    const b = gitlabApi.graphql(query(2), {}, new AbortController().signal);
    await settle();
    aborted.abort();
    await expect(a).rejects.toThrow();
    calls[0]?.resolve(json({ ok: 2 }));
    await expect(b).resolves.toEqual({ ok: 2 });
  });

  it("drops a queued request once all its callers are gone, but lets a sent one finish for new callers", async () => {
    const { calls, fetchMock } = controlledFetch();
    // Six requests take every slot
    const busy = new AbortController();
    const running = [3, 4, 5, 6, 7, 8].map((n) => gitlabApi.graphql(query(n), {}, busy.signal));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const queuedCaller = new AbortController();
    const queued = gitlabApi.graphql(query(9), {}, queuedCaller.signal);
    queuedCaller.abort();
    await expect(queued).rejects.toThrow();

    // Callers of the running requests go away (a superseded run); the requests stay shared
    busy.abort();
    await Promise.allSettled(running);
    const rejoined = gitlabApi.graphql(query(3), {}, new AbortController().signal);
    calls.forEach((call, i) => call.resolve(json({ n: i })));
    await expect(rejoined).resolves.toEqual({ n: 0 });

    // The dropped request was never sent
    await settle();
    expect(calls.map((call) => JSON.parse(call.body).query)).not.toContain(query(9));
  });
});

describe("gitlabApi.fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a 429 with a short Retry-After and fails fast on a long one", async () => {
    vi.useFakeTimers();
    const responses = [
      new Response(null, { status: 429, headers: { "retry-after": "1" } }),
      new Response("{}", { status: 200 }),
      new Response(null, { status: 429, headers: { "retry-after": "3600" } }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() as Response);
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    const retried = gitlabApi.fetch("/api/v4/user", { signal });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(retried).resolves.toHaveProperty("status", 200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const error = await gitlabApi.fetch("/api/v4/user", { signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, retryAfter: 3600 });
  });
});
