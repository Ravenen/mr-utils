import { test as base, chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { MockGitLab } from "./gitlab";

// The extension APIs as seen from the extension's own pages
declare global {
  const chrome: {
    management: { getAll(): Promise<{ id: string }[]> };
    storage: { sync: { set(items: object): Promise<void>; get(keys: null): Promise<Record<string, unknown>> } };
  };
}

const EXTENSION = path.resolve(import.meta.dirname, "../.output/chrome-mv3");

export const LIST = "https://gitlab.com/group/project/-/merge_requests";

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  gitlab: MockGitLab;
  page: Page;
  // Puts settings into storage.sync before the first page loads
  setStorage: (items: Record<string, unknown>) => Promise<void>;
}

// Every test gets a fresh browser profile with the built extension (run `pnpm build` first) and a mock GitLab
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto("chrome://extensions");
    const id = await page.evaluate(async () => (await chrome.management.getAll())[0]?.id ?? "");
    await page.close();
    await use(id);
  },
  gitlab: async ({ context }, use) => {
    const gitlab = new MockGitLab();
    await gitlab.attach(context);
    await use(gitlab);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
  setStorage: async ({ context, extensionId }, use) => {
    await use(async (items) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.evaluate((data) => chrome.storage.sync.set(data), items);
      await page.close();
    });
  },
});

export { expect };

// Titles of the items in each board column, in order
export async function boardColumns(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const columns: Record<string, string[]> = { review: [], pending: [], approved: [] };
    document.querySelectorAll<HTMLElement>("[data-mrflow-board] > [data-mrflow-column]").forEach((item) => {
      const title = item.querySelector("[data-testid='issuable-title-link']")?.textContent ?? "";
      columns[item.dataset.mrflowColumn as string]?.push(title);
    });
    return columns;
  });
}

// Waits until the board has finished loading (no spinner in the column headers)
export async function boardLoaded(page: Page): Promise<void> {
  await expect(page.locator(".mrflow-board-header")).toBeVisible();
  await expect(page.locator(".mrflow-loading")).toHaveCount(0);
}
