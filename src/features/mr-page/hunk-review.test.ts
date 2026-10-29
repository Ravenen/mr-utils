// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { diffFiles } from "@/core/gitlab/dom";
import { diffFilesMarkup, SAMPLE_DIFF } from "@/test/diffs-markup";
import { fakeApi, featureContext, styledElements } from "@/test/fixtures";
import { hunkReviewFeature } from "./hunk-review";
import type { MrPageRoute } from "./seen-state";

const MR = "/g/p/-/merge_requests/1/diffs";
// After the observer's pass, which is scheduled when the mutations are delivered
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const controls = () => [...document.querySelectorAll<HTMLInputElement>(".mrflow-hunk-control input[type=checkbox]")];

const mounted: (() => void)[] = [];
function mount(settings = {}) {
  const { ctx, unmount } = featureContext<MrPageRoute>(MR, fakeApi({}), settings);
  void hunkReviewFeature.mount(ctx);
  mounted.push(unmount);
  return unmount;
}

describe("hunk review", () => {
  afterEach(() => {
    mounted.splice(0).forEach((unmount) => unmount());
    document.body.innerHTML = "";
  });

  for (const renderer of ["vue", "rapid"] as const) {
    for (const view of ["inline", "parallel"] as const) {
      it(`puts a Viewed checkbox on every hunk (${renderer}, ${view})`, () => {
        document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF, { renderer, view });
        const unmount = mount();
        expect(controls()).toHaveLength(3);

        // The top hunk gets a header row of ours, of the renderer's kind; the others use GitLab's "@@" row
        const [top, second] = diffFiles()[0]?.hunks ?? [];
        const ours = top?.rows[0]?.previousElementSibling;
        expect(ours?.classList.contains("mrflow-hunk-header")).toBe(true);
        expect(ours?.tagName).toBe(renderer === "rapid" ? "TR" : "DIV");
        expect(second?.header?.querySelector(".mrflow-hunk-control")).not.toBeNull();
        unmount();
      });
    }
  }

  it("marks the hunk's rows when ticked", () => {
    document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF);
    mount();
    controls()[1]?.click();
    const hunk = diffFiles()[0]?.hunks[1];
    expect(hunk?.rows.every((row) => row.hasAttribute("data-mrflow-hunk-viewed"))).toBe(true);
    expect(diffFiles()[0]?.hunks[0]?.rows[0]?.hasAttribute("data-mrflow-hunk-viewed")).toBe(false);
  });

  it("follows files GitLab adds or renders again, keeping what was ticked", async () => {
    document.body.innerHTML = `<div id="list"></div>`;
    const list = document.getElementById("list") as HTMLElement;
    mount();
    list.innerHTML = diffFilesMarkup(SAMPLE_DIFF.slice(0, 1));
    await frame();
    expect(controls()).toHaveLength(2);
    controls()[0]?.click();

    // Scrolled away and back: GitLab renders the file again
    list.innerHTML = diffFilesMarkup(SAMPLE_DIFF);
    await frame();
    expect(controls().map((input) => input.checked)).toEqual([true, false, false]);
  });

  it("stays out when turned off in the settings", () => {
    document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF);
    mount({ hunkReview: false });
    expect(controls()).toHaveLength(0);
  });

  it("sets no inline styles and leaves nothing behind on unmount", async () => {
    for (const renderer of ["vue", "rapid"] as const) {
      document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF, { renderer });
      const before = document.body.innerHTML;
      const unmount = mount();
      controls()[0]?.click();
      expect(styledElements()).toEqual([]);
      unmount();
      await frame();
      expect(document.body.innerHTML).toBe(before);
    }
  });
});
