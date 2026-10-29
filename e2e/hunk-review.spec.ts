import { SAMPLE_DIFF } from "../src/test/diffs-markup";
import { expect, test } from "./fixtures";

const CHANGES = "https://gitlab.com/group/project/-/merge_requests/1/diffs";

test.beforeEach(({ gitlab }) => {
  gitlab.mrs = new Map([[1, { iid: 1 }]]);
  gitlab.diffs = SAMPLE_DIFF;
});

for (const renderer of ["vue", "rapid"] as const) {
  for (const view of ["inline", "parallel"] as const) {
    test(`every hunk gets a Viewed checkbox (${renderer}, ${view})`, async ({ page, gitlab }) => {
      gitlab.diffsOptions = { renderer, view, lazy: true };
      await page.goto(CHANGES);
      const checks = page.locator(".mrflow-hunk-control input[type=checkbox]");
      await expect(checks).toHaveCount(3);
      // GitLab's own file checkboxes are untouched
      await expect(page.getByLabel("Viewed", { exact: true })).toHaveCount(5);

      await page.locator(".mrflow-hunk-control label").nth(1).click();
      await expect(checks.nth(1)).toBeChecked();
      await expect(checks.nth(0)).not.toBeChecked();
    });
  }
}

test("hunk review can be turned off", async ({ page, setStorage, gitlab }) => {
  gitlab.diffsOptions = { renderer: "rapid" };
  await setStorage({ settings: { version: 2, hunkReview: false } });
  await page.goto(CHANGES);
  await expect(page.locator("[data-testid='rd-diff-file']")).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(page.locator(".mrflow-hunk-control")).toHaveCount(0);
});
