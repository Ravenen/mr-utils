// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { diffFilesMarkup, SAMPLE_DIFF } from "@/test/diffs-markup";
import { mrList, mrPage } from "@/test/fixtures";
import {
  approvalsWidget,
  diffFiles,
  type DiffFile,
  iconSpriteUrl,
  isRevokeApprovalButton,
  itemCommentsBadge,
  itemControls,
  mergeRequestItemPath,
  mergeRequestItems,
  mergeSection,
} from "./dom";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MR list", () => {
  it("finds the items and their parts", () => {
    document.body.innerHTML = mrList(2);
    const items = mergeRequestItems();
    expect(items).toHaveLength(2);
    expect(mergeRequestItemPath(items[0] as Element)).toBe("/g/p/-/merge_requests/1");
    const controls = itemControls(items[0] as Element) as Element;
    expect(itemCommentsBadge(controls)?.dataset.testid).toBe("issuable-comments");
    expect(iconSpriteUrl()).toBe("/assets/icons-abc.svg");
  });

  it("finds the comments badge in the older markup", () => {
    document.body.innerHTML = mrList(1, { legacyComments: true });
    const controls = itemControls(mergeRequestItems()[0] as Element) as Element;
    expect(itemCommentsBadge(controls)?.parentElement).toBe(controls);
  });

  it("looks for items inside the given root", () => {
    document.body.innerHTML = `${mrList(2)}<div id="other">${mrList(1)}</div>`;
    expect(mergeRequestItems()).toHaveLength(3);
    expect(mergeRequestItems(document.getElementById("other") as HTMLElement)).toHaveLength(1);
  });
});

describe("MR page", () => {
  it("finds the approvals widget's content, its approve button and the merge section", () => {
    document.body.innerHTML = mrPage();
    const widget = approvalsWidget();
    expect(widget?.button?.textContent).toBe("Approve");
    expect(widget?.content.parentElement?.classList.contains("media-body")).toBe(true);
    expect(mergeSection()?.querySelector("[data-testid='mr-widget-content']")).not.toBeNull();
  });

  it("finds the widget without an approve button, and never takes its collapse button", () => {
    document.body.innerHTML = mrPage({ canApprove: false });
    const widget = approvalsWidget();
    expect(widget?.button).toBeNull();
    expect(widget?.content.parentElement?.classList.contains("media-body")).toBe(true);
  });

  it("waits while the approvals widget is loading", () => {
    document.body.innerHTML = mrPage({ loading: true });
    expect(approvalsWidget()).toBeNull();
    document.body.innerHTML = `<div class="js-mr-approvals">Checking approval status <button>Expand</button></div>`;
    expect(approvalsWidget()).toBeNull();
  });

  it("tells Approve from Revoke approval without reading the text", () => {
    document.body.innerHTML = mrPage({ revoke: true });
    const button = approvalsWidget()?.button as Element;
    button.textContent = "Скасувати схвалення";
    expect(isRevokeApprovalButton(button)).toBe(true);
    document.body.innerHTML = mrPage();
    expect(isRevokeApprovalButton(approvalsWidget()?.button as Element)).toBe(false);
  });

  it("falls back to the older markup", () => {
    document.body.innerHTML = mrPage({ legacy: true, revoke: true });
    const widget = approvalsWidget();
    expect(isRevokeApprovalButton(widget?.button as Element)).toBe(true);
    expect(widget?.content.classList.contains("state-container")).toBe(true);
  });
});

describe("MR changes", () => {
  const blocks = (file: DiffFile) =>
    file.hunks.map((hunk) => hunk.blocks.map((b) => b.map((l) => l.change[0] + l.text)));
  const SAMPLE_BLOCKS = [
    [["rimport { old } from './old';", "aimport { spinner } from './spinner';"]],
    [["r  render(columns);", "a  render(columns, { animate });", "a  observe(columns);"], ["a  // done"]],
  ];

  for (const renderer of ["vue", "rapid"] as const) {
    for (const view of ["inline", "parallel"] as const) {
      it(`reads files, hunks and changed lines (${renderer}, ${view})`, () => {
        document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF, { renderer, view });
        const files = diffFiles();
        expect(files.map((file) => file.path)).toEqual(["src/board.ts", "README.md"]);
        const [board] = files as [DiffFile];
        expect(board.hunks).toHaveLength(2);
        // The top hunk has no header row; the next one starts at its "@@" row
        expect(board.hunks[0]?.header).toBeNull();
        expect(board.hunks[1]?.header?.textContent).toContain("@@ -20,6 +20,8 @@");
        expect(blocks(board)).toEqual(SAMPLE_BLOCKS);
        expect(board.hunks[0]?.rows).toHaveLength(view === "inline" ? 4 : 3);
        expect(board.viewed?.type).toBe("checkbox");
      });
    }
  }

  it("skips the last header, which only expands the rest of the file", () => {
    document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF, { renderer: "rapid" });
    expect(diffFiles()[1]?.hunks).toHaveLength(1);
  });

  it("takes the old path of a renamed file in Rapid Diffs", () => {
    document.body.innerHTML = diffFilesMarkup([{ ...SAMPLE_DIFF[1]!, path: "docs/README.md", oldPath: "README.md" }], {
      renderer: "rapid",
    });
    expect(diffFiles()[0]).toMatchObject({ path: "docs/README.md", oldPath: "README.md" });
  });

  it("has no Viewed checkbox when reviews are off", () => {
    document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF, { reviews: false });
    expect(diffFiles()[0]?.viewed).toBeNull();
  });

  it("finds the Viewed checkbox when its test id is on the wrapper", () => {
    document.body.innerHTML = diffFilesMarkup(SAMPLE_DIFF);
    const input = document.querySelector("[data-testid='fileReviewCheckbox']") as HTMLElement;
    input.removeAttribute("data-testid");
    input.parentElement?.setAttribute("data-testid", "fileReviewCheckbox");
    expect(diffFiles()[0]?.viewed).toBe(input);
  });

  it("reads lines of the older table markup", () => {
    document.body.innerHTML = `<div class="diff-file file-holder" data-path="a.rb"><div class="diff-content"><table><tbody>
      <tr class="line_holder match"><td class="line_content match">@@ -1 +1 @@</td></tr>
      <tr class="line_holder"><td class="line_content old">a = 1</td></tr>
      <tr class="line_holder"><td class="line_content new">a = 2</td></tr>
      <tr class="notes_holder"><td class="notes-content old">A comment</td></tr>
      <tr class="line_holder"><td class="line_content">b = 1</td></tr>
    </tbody></table></div></div>`;
    expect(blocks(diffFiles()[0] as DiffFile)).toEqual([[["ra = 1", "aa = 2"]]]);
  });
});
