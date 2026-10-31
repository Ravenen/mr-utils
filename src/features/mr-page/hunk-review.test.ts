// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("collapsing viewed hunks", () => {
    const collapsed = (hunk: number) =>
      diffFiles()[0]?.hunks[hunk]?.rows.every((row) => row.hasAttribute("data-mrflow-hunk-collapsed"));
    const toggle = (index: number) => document.querySelectorAll<HTMLButtonElement>(".mrflow-hunk-toggle")[index];

    it("hides a viewed hunk's lines and comments, with a button in its header to show them", async () => {
      render();
      // A comment thread under a line of the second hunk
      const row = diffFiles()[0]?.hunks[1]?.rows[1] as HTMLElement;
      row.insertAdjacentHTML("afterend", `<div class="diff-tr notes_holder" id="thread">A comment</div>`);
      await mount();
      expect(toggle(1)?.hidden).toBe(true);
      controls()[1]?.click();
      expect(collapsed(1)).toBe(true);
      expect(collapsed(0)).toBe(false);
      expect(document.getElementById("thread")?.hasAttribute("data-mrflow-hunk-collapsed")).toBe(true);
      // The header stays, and so does the hunk's checkbox
      expect(diffFiles()[0]?.hunks[1]?.header?.hasAttribute("data-mrflow-hunk-collapsed")).toBe(false);
      expect(toggle(1)?.hidden).toBe(false);
      expect(toggle(1)?.getAttribute("aria-expanded")).toBe("false");
      expect(toggle(1)?.textContent).toBe("6 lines");

      toggle(1)?.click();
      expect(collapsed(1)).toBe(false);
      expect(toggle(1)?.getAttribute("aria-expanded")).toBe("true");
      expect(toggle(1)?.textContent).toBe("");
      toggle(1)?.click();
      expect(collapsed(1)).toBe(true);

      controls()[1]?.click();
      expect(collapsed(1)).toBe(false);
      expect(toggle(1)?.hidden).toBe(true);
    });

    it("collapses hunks viewed earlier when the page opens", async () => {
      render(SAMPLE_DIFF, { renderer: "rapid", view: "parallel" });
      await mount();
      controls()[0]?.click();
      mounted.splice(0).forEach((unmount) => unmount());
      render(SAMPLE_DIFF, { renderer: "rapid", view: "parallel" });
      await mount();
      expect(collapsed(0)).toBe(true);
    });

    it("can be turned off", async () => {
      render();
      await mount({ hunkCollapseViewed: false });
      controls()[1]?.click();
      expect(collapsed(1)).toBe(false);
      expect(toggle(0)).toBeUndefined();
    });
  });

  it("counts the hunks left on the Changes tab", async () => {
    render();
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<ul><li class="diffs-tab js-diffs-tab" data-testid="diffs-tab"><a data-action="diffs">Changes <span class="gl-badge badge badge-pill badge-neutral">2</span></a></li></ul>`,
    );
    await mount();
    const left = () => document.querySelector(".mrflow-hunks-left");
    expect(left()?.textContent).toBe("3 left");
    controls()[0]?.click();
    expect(left()?.textContent).toBe("2 left");
    controls()[1]?.click();
    controls()[2]?.click();
    expect(left()?.textContent).toBe("all viewed");
    expect(left()?.classList.contains("badge-success")).toBe(true);
  });

  describe("keyboard shortcuts", () => {
    const scrolled: Element[] = [];
    beforeEach(() => {
      scrolled.length = 0;
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this);
      };
      Element.prototype.animate = vi.fn() as unknown as Element["animate"];
      window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    });

    // Lays the hunk headers out 300px apart, the first one at `from`, in a 600px window
    function layout(from: number) {
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
      document.querySelectorAll(".mrflow-hunk-control").forEach((control, i) => {
        (control.parentElement as HTMLElement).getBoundingClientRect = () => ({ top: from + i * 300 }) as DOMRect;
      });
    }
    const press = (code: string, init: KeyboardEventInit = { shiftKey: true }, target: EventTarget = document.body) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, ...init }));
    const headers = () => [...document.querySelectorAll(".mrflow-hunk-control")].map((c) => c.parentElement);

    it("Shift+] and Shift+[ go to the next and previous hunk not viewed", async () => {
      render();
      await mount();
      controls()[1]?.click();
      // Headers at 100, 400, 700: the window's middle is 300
      layout(100);
      press("BracketRight");
      // The second hunk is viewed: on to the third
      expect(scrolled).toEqual([headers()[2]]);
      press("BracketLeft");
      expect(scrolled.at(-1)).toBe(headers()[0]);
    });

    it("leaves ] and [ to GitLab, and typing alone", async () => {
      render();
      document.body.insertAdjacentHTML("beforeend", `<textarea id="note"></textarea>`);
      await mount();
      layout(100);
      press("BracketRight", {});
      press("BracketRight", { shiftKey: true, ctrlKey: true });
      press("BracketRight", { shiftKey: true }, document.getElementById("note") as HTMLElement);
      expect(scrolled).toEqual([]);
    });

    it("can be turned off", async () => {
      render();
      await mount({ hunkHotkeys: false });
      layout(100);
      press("BracketRight");
      expect(scrolled).toEqual([]);
    });
  });

  describe("blocks of changed lines", () => {
    const blockBoxes = () => [...document.querySelectorAll<HTMLInputElement>(".mrflow-block-control input")];
    const placeholders = () => [...document.querySelectorAll<HTMLElement>(".mrflow-block-placeholder")];
    const secondHunk = () => diffFiles()[0]?.hunks[1] as ReturnType<typeof diffFiles>[number]["hunks"][number];
    const blockCollapsed = (block: number) =>
      secondHunk().blockRows[block]?.every((row) => row.hasAttribute("data-mrflow-block-collapsed"));

    for (const renderer of ["vue", "rapid"] as const) {
      for (const view of ["inline", "parallel"] as const) {
        it(`puts a checkbox on the first line of each block of a hunk with several (${renderer}, ${view})`, async () => {
          render(SAMPLE_DIFF, { renderer, view });
          await mount();
          // Only the second hunk of src/board.ts has two blocks
          expect(blockBoxes()).toHaveLength(2);
          const hunk = secondHunk();
          expect(hunk.blockRows[0]?.[0]?.querySelector(".mrflow-block-control")).not.toBeNull();
          expect(hunk.blockRows[1]?.[0]?.querySelector(".mrflow-block-control")).not.toBeNull();
          expect(blockBoxes()[0]?.getAttribute("aria-label")).toBe("Viewed");
        });
      }
    }

    it("collapses a viewed block to a row of ours, and half ticks its hunk", async () => {
      render();
      await mount();
      blockBoxes()[0]?.click();
      expect(blockCollapsed(0)).toBe(true);
      expect(blockCollapsed(1)).toBe(false);
      const [row] = placeholders();
      expect(row?.nextElementSibling).toBe(secondHunk().blockRows[0]?.[0]);
      expect(row?.querySelector(".gl-button-text")?.textContent).toBe("3 lines");
      expect(controls()[1]?.indeterminate).toBe(true);
      expect(controls()[1]?.checked).toBe(false);
      expect(progress()[0]).toBe("0/2 hunks");

      // The other block too: the hunk is viewed and collapses as a whole
      blockBoxes()[1]?.click();
      expect(controls()[1]?.checked).toBe(true);
      expect(controls()[1]?.indeterminate).toBe(false);
      expect(placeholders()).toHaveLength(0);
      expect(secondHunk().rows.every((r) => r.hasAttribute("data-mrflow-hunk-collapsed"))).toBe(true);
    });

    it("shows a collapsed block again, and unticks it from its row", async () => {
      render(SAMPLE_DIFF, { renderer: "rapid", view: "parallel" });
      await mount();
      blockBoxes()[0]?.click();
      expect(placeholders()[0]?.tagName).toBe("TR");
      placeholders()[0]?.querySelector<HTMLButtonElement>(".mrflow-hunk-toggle")?.click();
      expect(blockCollapsed(0)).toBe(false);
      expect(placeholders()).toHaveLength(0);
      expect(blockBoxes()[0]?.checked).toBe(true);

      blockBoxes()[0]?.click();
      blockBoxes()[0]?.click();
      expect(blockCollapsed(0)).toBe(true);
      placeholders()[0]?.querySelector<HTMLInputElement>("input")?.click();
      expect(blockCollapsed(0)).toBe(false);
      expect(await stored()).toEqual([]);
    });

    it("shows the blocks of a viewed hunk whose lines are shown", async () => {
      render();
      await mount();
      controls()[1]?.click();
      document.querySelectorAll<HTMLButtonElement>(".mrflow-hunk-control .mrflow-hunk-toggle")[1]?.click();
      expect(blockCollapsed(0)).toBe(false);
      expect(blockCollapsed(1)).toBe(false);
      expect(placeholders()).toHaveLength(0);
      expect(blockBoxes().map((box) => box.checked)).toEqual([true, true]);
    });

    it("keeps a block's mark after a push that changed the other block of its hunk", async () => {
      render();
      await mount();
      blockBoxes()[1]?.click();
      mounted.splice(0).forEach((unmount) => unmount());
      // The push changes a line of the first block only
      render(
        SAMPLE_DIFF.map((file, i) =>
          i === 0
            ? {
                ...file,
                hunks: file.hunks.map((hunk) => ({
                  ...hunk,
                  lines: hunk.lines.map((line) => line.replace("{ animate }", "{ animate: true }")),
                })),
              }
            : file,
        ),
      );
      await mount();
      expect(blockBoxes().map((box) => box.checked)).toEqual([false, true]);
    });

    it("can be turned off", async () => {
      render();
      await mount({ hunkBlockReview: false });
      expect(blockBoxes()).toHaveLength(0);
    });

    it("Shift+] goes through a hunk block by block", async () => {
      render();
      await mount();
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this);
      };
      Element.prototype.animate = vi.fn() as unknown as Element["animate"];
      window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;
      const scrolled: Element[] = [];
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
      // In page order: hunk 1 header, block 1 line, block 2 line, README's hunk header
      const targets = [
        controls()[0]?.parentElement,
        secondHunk().blockRows[0]?.[0],
        secondHunk().blockRows[1]?.[0],
        controls()[2]?.parentElement,
      ] as HTMLElement[];
      targets.forEach((el, i) => (el.getBoundingClientRect = () => ({ top: 100 + i * 300 }) as DOMRect));
      blockBoxes()[0]?.click();
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { code: "BracketRight", shiftKey: true, bubbles: true }),
      );
      // Block 1 is viewed: on to block 2
      expect(scrolled).toEqual([targets[2]]);
    });
  });
});
