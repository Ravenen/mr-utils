import { expect, test } from "./fixtures";

const MR = "https://gitlab.com/group/project/-/merge_requests/1";

test.beforeEach(({ gitlab }) => {
  gitlab.mrs = new Map([[1, { iid: 1 }]]);
});

test("the checklist hides Approve and Merge until every check is ticked", async ({ page }) => {
  await page.goto(MR);
  const approve = page.getByTestId("approve-button");
  const merge = page.locator(".mr-widget-body-ready-merge");
  await expect(page.locator(".mrflow-checks input[type=checkbox]")).toHaveCount(2);
  await expect(approve).toBeHidden();
  await expect(merge).toBeHidden();

  await page.getByLabel("Is documentation updated?").check();
  await expect(approve).toBeHidden();
  await page.getByLabel("Is merge target right?").check();
  await expect(approve).toBeVisible();
  await expect(merge).toBeVisible();

  // Ticks are kept for the MR
  await page.reload();
  await expect(page.getByLabel("Is merge target right?")).toBeChecked();
  await expect(approve).toBeVisible();
});

test("without an approve button the checklist still guards Merge and leaves the widget's own buttons", async ({
  page,
  gitlab,
}) => {
  gitlab.canApprove = false;
  await page.goto(MR);
  const merge = page.locator(".mr-widget-body-ready-merge");
  await expect(page.locator(".media-body .mrflow-checks")).toBeVisible();
  await expect(merge).toBeHidden();
  await expect(page.getByTestId("widget-toggle")).toBeVisible();

  await page.getByLabel("Is documentation updated?").check();
  await page.getByLabel("Is merge target right?").check();
  await expect(merge).toBeVisible();
});

test("the checklist can be turned off", async ({ page, setStorage }) => {
  await setStorage({ settings: { version: 2, approvalGuard: false } });
  await page.goto(MR);
  await expect(page.getByTestId("approve-button")).toBeVisible();
  await expect(page.locator(".mrflow-checks")).toHaveCount(0);
});
