import { describe, expect, it } from "vitest";
import { blockIds, hashText, type BlockLine } from "./hunks";

const added = (text: string): BlockLine => ({ change: "added", text });
const removed = (text: string): BlockLine => ({ change: "removed", text });

describe("hashText", () => {
  it("is stable and tells texts apart", () => {
    expect(hashText("a")).toBe(hashText("a"));
    expect(hashText("a")).not.toBe(hashText("b"));
    expect(hashText("")).toMatch(/^[0-9a-f]{14}$/);
  });
});

describe("blockIds", () => {
  const block = [removed("render(columns);"), added("render(columns, { animate });")];

  it("depends on the file and the lines, not on where the block is", () => {
    const [id] = blockIds("a.ts", [block]);
    expect(blockIds("a.ts", [[added("other")], block])[1]).toBe(id);
    expect(blockIds("b.ts", [block])[0]).not.toBe(id);
    expect(blockIds("a.ts", [[removed("render(columns);"), added("render(columns, {});")]])[0]).not.toBe(id);
  });

  it("tells an added line from a removed one", () => {
    expect(blockIds("a.ts", [[added("x")]])[0]).not.toBe(blockIds("a.ts", [[removed("x")]])[0]);
  });

  it("ignores trailing whitespace and line endings, but not indentation", () => {
    const [id] = blockIds("a.ts", [[added("  x")]]);
    expect(blockIds("a.ts", [[added("  x  \r")]])[0]).toBe(id);
    expect(blockIds("a.ts", [[added("x")]])[0]).not.toBe(id);
  });

  it("numbers repeated blocks of a file", () => {
    const [first, second, other, third] = blockIds("a.ts", [block, block, [added("y")], block]);
    expect(second).toBe(`${first}#2`);
    expect(third).toBe(`${first}#3`);
    expect(other).not.toContain("#");
  });
});
