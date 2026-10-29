import { LIST, boardLoaded, expect, test } from "./fixtures";

test.beforeEach(({ gitlab }) => {
  gitlab.mrs = new Map([
    [1, { iid: 1, approvedByMe: true }],
    [2, { iid: 2 }],
  ]);
});

test("the popup saves settings and open GitLab tabs follow without a reload", async ({
  context,
  page,
  extensionId,
}) => {
  await page.goto(LIST);
  await boardLoaded(page);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const board = popup.getByRole("switch", { name: "Kanban board" });
  await expect(board).toHaveAttribute("aria-checked", "true");
  await board.click();
  await expect(board).toHaveAttribute("aria-checked", "false");

  // The list tab drops the board and decorates the native list instead
  await expect(page.locator("[data-mrflow-board]")).toHaveCount(0);
  await expect(page.locator(".mrflow-board-header")).toHaveCount(0);
  await expect(page.locator("li.merge-request").first()).toHaveAttribute("data-mrflow-approved", "");

  // ...and it is still off after a reload
  await page.reload();
  await expect(page.locator(".mrflow-approvals-badge").first()).toBeVisible();
  await expect(page.locator("[data-mrflow-board]")).toHaveCount(0);
});

test("1.5 settings are migrated and shown on the options page", async ({ context, extensionId, setStorage }) => {
  await setStorage({ approvalsNeeded: 2, kanbanView: false, boardLoading: "progressive" });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(options.getByLabel("Number of approvals")).toHaveValue("2");
  await expect(options.getByLabel("Always the number below")).toBeChecked();
  await expect(options.getByRole("switch", { name: "Kanban board" })).toHaveAttribute("aria-checked", "false");
  await expect(options.getByLabel("Board updates")).toHaveValue("progressive");
  const stored = await options.evaluate(() => chrome.storage.sync.get(null));
  expect(Object.keys(stored)).toEqual(["settings"]);
});

test("the approvals number from the options page drives the badges", async ({ context, page, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("Always the number below").check();
  await options.getByLabel("Number of approvals").fill("1");

  await page.goto(LIST);
  await boardLoaded(page);
  await expect(page.locator(".mrflow-approvals-badge").first()).toHaveText("1/1");
});
