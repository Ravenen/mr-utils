// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { loadSettings } from "@/core/settings";
import App from "./App.vue";

describe("popup", () => {
  beforeEach(() => fakeBrowser.reset());

  it("turns the features on and off and links to the options page", async () => {
    const openOptionsPage = vi.spyOn(browser.runtime, "openOptionsPage").mockResolvedValue();
    vi.spyOn(window, "close").mockImplementation(() => {});
    const wrapper = mount(App);
    await flushPromises();

    const [board, guard] = wrapper.findAll("button[role=switch]");
    expect(board?.attributes("aria-checked")).toBe("true");
    await board?.trigger("click");
    await guard?.trigger("click");
    await flushPromises();
    expect(await loadSettings()).toMatchObject({ kanbanView: false, approvalGuard: false });

    await wrapper.find(".gl-button-link").trigger("click");
    expect(openOptionsPage).toHaveBeenCalled();
  });
});
