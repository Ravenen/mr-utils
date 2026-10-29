import { LIST, boardColumns, boardLoaded, expect, test } from "./fixtures";

test.beforeEach(({ gitlab }) => {
  gitlab.mrs = new Map(
    [
      { iid: 1, approvedByMe: true },
      { iid: 2, myOpenThreads: 1 },
      { iid: 3, draft: true },
      { iid: 4, conflicts: true, otherComments: 2 },
      { iid: 5 },
    ].map((mr) => [mr.iid, mr]),
  );
});

test("GitLab's ?sort= redirect leaves one board with every item placed once", async ({ page, gitlab }) => {
  gitlab.redirectList = true;
  await page.goto(LIST);
  await expect(page).toHaveURL(/sort=created_date&state=opened/);
  await boardLoaded(page);

  await expect(page.locator(".mrflow-board-header")).toHaveCount(1);
  await expect(page.locator("[data-mrflow-board]")).toHaveCount(1);
  await expect(page.locator("[data-mrflow-board] [data-mrflow-board]")).toHaveCount(0);
  await expect(page.locator("li.merge-request")).toHaveCount(5);
  await expect(page.locator("li.merge-request:not([data-mrflow-column])")).toHaveCount(0);
  expect(await boardColumns(page)).toEqual({
    review: ["Draft: Refactor the approvals widget", "Bump dependency versions", "Update the merge request docs"],
    pending: ["Add dark mode to the settings page"],
    approved: ["Fix flaky pipeline in the deploy stage"],
  });
});

test("first visit loads comments once; a repeat visit makes one cheap query", async ({ page, gitlab }) => {
  await page.goto(LIST);
  await boardLoaded(page);
  expect(gitlab.count("MRFlowMergeRequests")).toBe(1);
  // Comments only for MRs that have some, in batches of 5
  expect(gitlab.count("MRFlowMergeRequestsNotes")).toBe(1);
  const first = await boardColumns(page);
  await expect(page.locator(".mrflow-column-header[data-column='pending'] .mrflow-column-count")).toHaveText(" (1)");

  gitlab.operations.length = 0;
  await page.reload();
  await boardLoaded(page);
  expect(gitlab.operations.map((op) => op.name)).toEqual(["MRFlowMergeRequests"]);
  expect(await boardColumns(page)).toEqual(first);
});

test("decorates items with badges and banners, without inline styles", async ({ page }) => {
  await page.goto(LIST);
  await boardLoaded(page);
  const conflicts = page.locator("li.merge-request", { hasText: "Bump dependency versions" });
  await expect(conflicts.locator(".mrflow-banner-action")).toHaveText("CONFLICTS");
  // No threads: the native comments count stays
  await expect(conflicts.locator("[data-testid='issuable-comments']")).toBeVisible();
  const pending = page.locator("li.merge-request", { hasText: "Add dark mode" });
  // Threads: our badges replace it
  await expect(pending.locator("[data-testid='issuable-comments']")).toBeHidden();
  await expect(pending.locator(".mrflow-badges .badge")).toHaveText(["0/1", "0/1"]);
  await expect(page.locator("li.merge-request", { hasText: "Draft:" })).toHaveAttribute("data-mrflow-draft", "");
  await expect(page.locator("[style]")).toHaveCount(0);
});

test("a long rate limit keeps the cards in place and shows an alert", async ({ page, gitlab }) => {
  await page.goto(LIST);
  await boardLoaded(page);
  const before = await boardColumns(page);

  gitlab.rateLimitedFor = 3600;
  gitlab.mrs.set(5, { iid: 5, approvedByMe: true, updatedAt: "2026-10-02T00:00:00Z" });
  await page.reload();
  await expect(page.locator(".mrflow-alert")).toContainText("rate limit reached, try again in ~60 min");
  await boardLoaded(page);
  expect(await boardColumns(page)).toEqual(before);
  // Failed fast: no retries of a long Retry-After
  expect(gitlab.operations.filter((op) => op.name === "MRFlowMergeRequests")).toHaveLength(2);
});

test("follows comment pagination", async ({ page, gitlab }) => {
  gitlab.notesPageSize = 2;
  gitlab.mrs = new Map([[1, { iid: 1, myOpenThreads: 3 }]]);
  await page.goto(LIST);
  await boardLoaded(page);
  expect(gitlab.count("MRFlowMergeRequestNotesPage")).toBe(2);
  expect((await boardColumns(page)).pending).toEqual(["Fix flaky pipeline in the deploy stage"]);
  await expect(page.locator(".mrflow-badges .badge").nth(1)).toHaveText("0/3");
});

test.describe("card animations", () => {
  // Records every moment an item was marked as travelling between columns
  async function watchMoves(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      const moves: string[] = [];
      (window as unknown as { moves: string[] }).moves = moves;
      new MutationObserver((records) =>
        records.forEach((record) => {
          const el = record.target as HTMLElement;
          if (el.hasAttribute("data-mrflow-moving")) moves.push(el.id);
        }),
      ).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-mrflow-moving"] });
    });
  }

  test("run and finish when a card changes columns", async ({ page, gitlab }) => {
    await page.goto(LIST);
    await boardLoaded(page);
    gitlab.mrs.set(5, { iid: 5, approvedByMe: true, updatedAt: "2026-10-02T00:00:00Z" });
    await watchMoves(page);
    await page.reload();
    await boardLoaded(page);

    expect((await boardColumns(page)).approved).toContain("Update the merge request docs");
    expect(await page.evaluate(() => (window as unknown as { moves: string[] }).moves)).toContain("issuable_5");
    await expect(page.locator("[data-mrflow-moving]")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test("do not run when turned off", async ({ page, gitlab, setStorage }) => {
    await setStorage({ settings: { version: 2, animateCards: false } });
    await page.goto(LIST);
    await boardLoaded(page);
    gitlab.mrs.set(5, { iid: 5, approvedByMe: true, updatedAt: "2026-10-02T00:00:00Z" });
    await watchMoves(page);
    await page.reload();
    await boardLoaded(page);

    expect((await boardColumns(page)).approved).toContain("Update the merge request docs");
    expect(await page.evaluate(() => (window as unknown as { moves: string[] }).moves)).toEqual([]);
  });
});
