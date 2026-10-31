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
      // GitLab's own file checkboxes are untouched; the second hunk's two blocks get one each
      await expect(page.getByLabel("Viewed", { exact: true })).toHaveCount(7);

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

for (const renderer of ["vue", "rapid"] as const) {
  test(`marks are kept for the blocks a new push did not change (${renderer})`, async ({ page, gitlab }) => {
    gitlab.diffsOptions = { renderer };
    await page.goto(CHANGES);
    const checks = page.locator(".mrflow-hunk-control input[type=checkbox]");
    const labels = page.locator(".mrflow-hunk-control label");
    await expect(checks).toHaveCount(3);
    await labels.nth(0).click();
    await expect(page.locator(".mrflow-hunk-progress").first()).toHaveText("1/2 hunks");
    await expect(page.locator(".mrflow-hunk-tree-progress").first()).toHaveText("1/2");
    await labels.nth(1).click();
    // Every hunk of the file viewed: GitLab's own checkbox follows
    await expect(page.locator(".mrflow-hunk-progress").first()).toHaveText("2/2 hunks");
    await expect(page.getByLabel("Viewed", { exact: true }).nth(0)).toBeChecked();

    await page.reload();
    await expect(checks).toHaveCount(3);
    await expect(checks.nth(0)).toBeChecked();
    await expect(checks.nth(1)).toBeChecked();

    // A new push changes a line of the second hunk only
    gitlab.diffs = SAMPLE_DIFF.map((file, i) =>
      i === 0
        ? {
            ...file,
            hunks: file.hunks.map((hunk, j) =>
              j === 1
                ? { ...hunk, lines: hunk.lines.map((line) => line.replace("{ animate }", "{ animate: true }")) }
                : hunk,
            ),
          }
        : file,
    );
    await page.reload();
    await expect(checks).toHaveCount(3);
    await expect(checks.nth(0)).toBeChecked();
    await expect(checks.nth(1)).not.toBeChecked();
    await expect(page.locator(".mrflow-hunk-progress").first()).toHaveText("1/2 hunks");
  });
}

test("viewed hunks collapse, the Changes tab counts the rest, and Shift+] goes to the next one", async ({
  page,
  gitlab,
}) => {
  // Enough hunks to scroll through
  gitlab.diffs = Array.from({ length: 6 }, (_, i) => ({
    path: `src/file${i}.ts`,
    hunks: [
      {
        header: `@@ -1,30 +1,31 @@ file ${i}`,
        lines: [...Array.from({ length: 30 }, (_, j) => ` line ${j}`), `+added in file ${i}`],
      },
    ],
  }));
  gitlab.diffsOptions = { renderer: "rapid" };
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(CHANGES);
  const left = page.locator(".mrflow-hunks-left");
  await expect(left).toHaveText("6 left");

  // Viewed: the lines go, the header stays with a button to show them again
  const file0 = page.locator("[data-testid='rd-diff-file']").nth(0);
  await file0.locator(".mrflow-hunk-control label").click();
  await expect(left).toHaveText("5 left");
  await expect(file0.locator("tr[data-hunk-lines]").first()).toBeHidden();
  await file0.getByRole("button", { name: "Show lines" }).click();
  await expect(file0.locator("tr[data-hunk-lines]").first()).toBeVisible();

  // Shift+] skips the viewed hunk and brings the next one to the middle of the window
  await page.keyboard.press("Shift+BracketRight");
  const header = page.locator("[data-testid='rd-diff-file']").nth(1).locator("tr[data-hunk-header]").first();
  await expect
    .poll(async () => {
      const box = await header.boundingBox();
      return box ? Math.abs(box.y + box.height / 2 - 300) < 40 : false;
    })
    .toBe(true);
});

for (const renderer of ["vue", "rapid"] as const) {
  test(`a block of a large hunk is viewed and collapsed on its own (${renderer})`, async ({ page, gitlab }) => {
    gitlab.diffsOptions = { renderer, view: "inline" };
    await page.goto(CHANGES);
    // The second hunk of src/board.ts has two blocks
    const blocks = page.locator(".mrflow-block-control input");
    await expect(blocks).toHaveCount(2);
    const firstLine = page.locator("[data-mrflow-block-start]").first();
    await expect(firstLine).toBeVisible();

    // The box is drawn by the label's ::before, which Playwright does not count as visible
    await blocks.first().check({ force: true });
    await expect(firstLine).toBeHidden();
    const row = page.locator(".mrflow-block-placeholder");
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Show lines" })).toHaveText("3 lines");
    // The hunk is half viewed
    await expect(page.locator(".mrflow-hunk-control input").nth(1)).not.toBeChecked();
    expect(
      await page
        .locator(".mrflow-hunk-control input")
        .nth(1)
        .evaluate((el) => (el as HTMLInputElement).indeterminate),
    ).toBe(true);

    await page.reload();
    await expect(page.locator(".mrflow-block-placeholder")).toBeVisible();
    await page.getByRole("button", { name: "Show lines" }).click();
    await expect(page.locator("[data-mrflow-block-start]").first()).toBeVisible();
  });
}

test("the first block of a file's top hunk collapses once, and its mark survives switching to side by side", async ({
  page,
  gitlab,
}) => {
  gitlab.diffs = [
    {
      path: "example/host/app.cpp",
      hunks: [
        {
          lines: [
            '-#include "state/istate.hpp"',
            '+#include "factory.hpp"',
            '+#include "state/astate.hpp"',
            ' #include "states.hpp"',
            "+#include <cassert>",
            " #include <thread>",
          ],
        },
      ],
    },
  ];
  gitlab.diffsOptions = { renderer: "rapid", view: "inline" };
  await page.goto(CHANGES);
  await page.locator(".mrflow-block-control input").first().check({ force: true });
  await expect(page.locator(".mrflow-block-placeholder")).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(page.locator(".mrflow-hunk-header")).toHaveCount(1);

  gitlab.diffsOptions = { renderer: "rapid", view: "parallel" };
  await page.reload();
  await expect(page.locator(".mrflow-block-placeholder")).toHaveCount(1);
  await expect(page.locator(".mrflow-hunk-header")).toHaveCount(1);
  await expect(page.locator(".mrflow-block-control input").nth(1)).not.toBeChecked();
});
