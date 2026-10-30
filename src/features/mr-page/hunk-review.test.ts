// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { diffFiles } from "@/core/gitlab/dom";
import type { MrNode } from "@/core/gitlab/queries";
import { hunkMarksKey, saveHunkMarks } from "@/core/storage/hunk-marks";
import {
  diffFilesMarkup,
  diffTreeMarkup,
  SAMPLE_DIFF,
  type DiffFileSpec,
  type DiffsOptions,
} from "@/test/diffs-markup";
import { fakeApi, featureContext, node, styledElements } from "@/test/fixtures";
import { hunkReviewFeature } from "./hunk-review";
import type { MrPageRoute } from "./seen-state";

const MR = "/g/p/-/merge_requests/1/diffs";
const KEY = hunkMarksKey("g/p", "1");
// After the observer's pass, which is scheduled when the mutations are delivered
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const settle = async () => {
  for (let i = 0; i < 3; i++) await frame();
};
const controls = () => [...document.querySelectorAll<HTMLInputElement>(".mrflow-hunk-control input[type=checkbox]")];
const ticked = () => controls().map((input) => input.checked);
const fileViewed = (index: number) => diffFiles()[index]?.viewed as HTMLInputElement;
const progress = () => [...document.querySelectorAll(".mrflow-hunk-progress")].map((el) => el.textContent);
const treeProgress = () => [...document.querySelectorAll(".mrflow-hunk-tree-progress")].map((el) => el.textContent);
const stored = async () =>
  Object.keys(((await browser.storage.local.get(KEY))[KEY] as { marks?: object })?.marks ?? {});

function render(files: DiffFileSpec[] = SAMPLE_DIFF, options: DiffsOptions = {}) {
  document.body.innerHTML = diffTreeMarkup(files) + diffFilesMarkup(files, options);
}

const mounted: (() => void)[] = [];
async function mount(settings = {}, mr: Partial<MrNode> = {}) {
  const { ctx, unmount } = featureContext<MrPageRoute>(MR, fakeApi({ 1: node(1, mr) }), settings);
  mounted.push(unmount);
  await hunkReviewFeature.mount(ctx);
  return unmount;
}

// The sample after a new push: the first hunk moved down and got other context, the second changed
const PUSHED: DiffFileSpec[] = [
  {
    path: "src/board.ts",
    hunks: [
      {
        header: "@@ -3,4 +3,4 @@",
        lines: [
          " // a new comment above",
          "-import { old } from './old';",
          "+import { spinner } from './spinner';",
          " ",
        ],
      },
      {
        header: "@@ -22,6 +22,8 @@ export function board()",
        lines: ["-  render(columns);", "+  render(columns, { animate: true });", "+  observe(columns);", "+  // done"],
      },
    ],
  },
  SAMPLE_DIFF[1] as DiffFileSpec,
];

describe("hunk review", () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => {
    mounted.splice(0).forEach((unmount) => unmount());
    document.body.innerHTML = "";
  });

  for (const renderer of ["vue", "rapid"] as const) {
    for (const view of ["inline", "parallel"] as const) {
      it(`puts a Viewed checkbox on every hunk (${renderer}, ${view})`, async () => {
        render(SAMPLE_DIFF, { renderer, view });
        await mount();
        expect(controls()).toHaveLength(3);

        // The top hunk gets a header row of ours, of the renderer's kind; the others use GitLab's "@@" row
        const [top, second] = diffFiles()[0]?.hunks ?? [];
        const ours = top?.rows[0]?.previousElementSibling;
        expect(ours?.classList.contains("mrflow-hunk-header")).toBe(true);
        expect(ours?.tagName).toBe(renderer === "rapid" ? "TR" : "DIV");
        expect(second?.header?.querySelector(".mrflow-hunk-control")).not.toBeNull();
      });
    }
  }

  it("keeps the marks of the blocks a new push did not change", async () => {
    render();
    await mount();
    controls()[0]?.click();
    controls()[1]?.click();
    controls()[2]?.click();
    expect(await stored()).toHaveLength(4);

    mounted.splice(0).forEach((unmount) => unmount());
    render(PUSHED);
    await mount();
    // The first hunk only moved; the second has one changed block of its two
    expect(ticked()).toEqual([true, false, true]);
  });

  it("keeps the marks across the inline and side-by-side views and both renderers", async () => {
    render(SAMPLE_DIFF, { renderer: "vue", view: "inline" });
    await mount();
    controls()[1]?.click();
    mounted.splice(0).forEach((unmount) => unmount());

    render(SAMPLE_DIFF, { renderer: "rapid", view: "parallel" });
    await mount();
    expect(ticked()).toEqual([false, true, false]);
  });

  it("marks the hunk's rows and follows files GitLab renders again", async () => {
    document.body.innerHTML = `<div id="list"></div>`;
    const list = document.getElementById("list") as HTMLElement;
    await mount();
    list.innerHTML = diffFilesMarkup(SAMPLE_DIFF.slice(0, 1));
    await settle();
    controls()[1]?.click();
    expect(diffFiles()[0]?.hunks[1]?.rows.every((row) => row.hasAttribute("data-mrflow-hunk-viewed"))).toBe(true);

    // Scrolled away and back: GitLab renders the file again
    list.innerHTML = diffFilesMarkup(SAMPLE_DIFF);
    await settle();
    expect(ticked()).toEqual([false, true, false]);
  });

  it("treats hunks merged by expanding the lines between them as viewed only when all their blocks are", async () => {
    render();
    await mount();
    controls()[1]?.click();
    const merged: DiffFileSpec = {
      path: "src/board.ts",
      hunks: [
        { lines: [...(SAMPLE_DIFF[0]?.hunks[0]?.lines ?? []), " ...", ...(SAMPLE_DIFF[0]?.hunks[1]?.lines ?? [])] },
      ],
    };
    render([merged]);
    await settle();
    expect(ticked()).toEqual([false]);
    controls()[0]?.click();
    render(SAMPLE_DIFF);
    await settle();
    expect(ticked()).toEqual([true, true, false]);
  });

  it("shows the progress in the file header and the file tree", async () => {
    render();
    await mount();
    expect(progress()).toEqual(["0/2 hunks", "0/1 hunks"]);
    expect(treeProgress()).toEqual(["0/2", "0/1"]);
    controls()[0]?.click();
    expect(progress()).toEqual(["1/2 hunks", "0/1 hunks"]);
    expect(treeProgress()).toEqual(["1/2", "0/1"]);
    const badge = document.querySelector(".mrflow-hunk-progress");
    expect(badge?.classList.contains("badge-neutral")).toBe(true);
    // Next to GitLab's checkbox
    expect(badge?.nextElementSibling?.querySelector("input")).toBe(fileViewed(0));
  });

  for (const renderer of ["vue", "rapid"] as const) {
    it(`ticks GitLab's Viewed checkbox of a file when all its hunks are viewed, and clears them when it is unticked (${renderer})`, async () => {
      render(SAMPLE_DIFF, { renderer });
      await mount();
      controls()[0]?.click();
      expect(fileViewed(0).checked).toBe(false);
      controls()[1]?.click();
      expect(fileViewed(0).checked).toBe(true);
      expect(document.querySelector(".mrflow-hunk-progress")?.classList.contains("badge-success")).toBe(true);
      expect(document.querySelector(".mrflow-hunk-tree-progress")?.hasAttribute("data-mrflow-done")).toBe(true);

      fileViewed(0).click();
      expect(ticked()).toEqual([false, false, false]);
      expect(await stored()).toEqual([]);
    });
  }

  it("marks every hunk of a file when its Viewed checkbox is ticked", async () => {
    render();
    await mount();
    fileViewed(1).click();
    expect(ticked()).toEqual([false, false, true]);
  });

  it("clears the hunks of a file unticked while collapsed once GitLab shows them again", async () => {
    render();
    await mount();
    fileViewed(0).click();
    // GitLab collapses a viewed file: its lines go away
    const content = diffFiles()[0]?.root.querySelector(".diff-content") as HTMLElement;
    const lines = content.innerHTML;
    content.innerHTML = "";
    await settle();
    fileViewed(0).click();
    content.innerHTML = lines;
    await settle();
    expect(ticked()).toEqual([false, false, false]);
  });

  it("counts blocks ticked before a file was renamed", async () => {
    render();
    await mount();
    controls()[2]?.click();
    mounted.splice(0).forEach((unmount) => unmount());

    render([{ ...(SAMPLE_DIFF[1] as DiffFileSpec), path: "docs/README.md", oldPath: "README.md" }], {
      renderer: "rapid",
    });
    await mount();
    expect(ticked()).toEqual([true]);
  });

  it("follows marks changed in another tab", async () => {
    render();
    await mount();
    controls()[2]?.click();
    const [id] = await stored();
    await saveHunkMarks(KEY, {});
    await settle();
    expect(ticked()).toEqual([false, false, false]);
    await saveHunkMarks(KEY, { [id as string]: 1 });
    expect(ticked()).toEqual([false, false, true]);
  });

  it("drops the marks of a merged MR", async () => {
    await saveHunkMarks(KEY, { a: 1 });
    render();
    await mount({}, { state: "merged" });
    await settle();
    controls()[0]?.click();
    await settle();
    expect(await browser.storage.local.get(null)).toEqual({});
    // Still works on the page
    expect(ticked()[0]).toBe(true);
  });

  it("stays out when turned off in the settings", async () => {
    render();
    await mount({ hunkReview: false });
    expect(controls()).toHaveLength(0);
  });

  it("sets no inline styles and leaves nothing behind on unmount", async () => {
    for (const renderer of ["vue", "rapid"] as const) {
      render(SAMPLE_DIFF, { renderer });
      const before = document.body.innerHTML;
      const unmount = await mount();
      controls()[0]?.click();
      expect(styledElements()).toEqual([]);
      unmount();
      await settle();
      expect(document.body.innerHTML).toBe(before);
    }
  });
});
