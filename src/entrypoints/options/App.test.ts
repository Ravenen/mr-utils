// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_SETTINGS, loadSettings } from "@/core/settings";
import App from "./App.vue";

async function mountApp() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

const toggle = (wrapper: Awaited<ReturnType<typeof mountApp>>, label: string) =>
  wrapper.findAll("button[role=switch]").find((button) => {
    const labelId = button.attributes("aria-labelledby");
    return wrapper.find(`#${labelId}`).text() === label;
  });

describe("options page", () => {
  beforeEach(() => fakeBrowser.reset());

  it("shows a 1.5 user's settings after migrating them", async () => {
    await browser.storage.sync.set({ approvalsNeeded: 4, kanbanView: false });
    const wrapper = await mountApp();
    expect((wrapper.find("#approvals-needed").element as HTMLInputElement).value).toBe("4");
    expect(wrapper.find("input[value=setting]").element).toHaveProperty("checked", true);
    expect(toggle(wrapper, "Kanban board")?.attributes("aria-checked")).toBe("false");
  });

  it("saves every change right away", async () => {
    const wrapper = await mountApp();
    await toggle(wrapper, "Approval checklist")?.trigger("click");
    await wrapper.find("#board-loading").setValue("progressive");
    await wrapper.find("#approvals-needed").setValue("2");
    await wrapper.find("input[value=setting]").setValue(true);
    await flushPromises();
    expect(await loadSettings()).toMatchObject({
      approvalGuard: false,
      boardLoading: "progressive",
      approvalsNeeded: 2,
      approvalsSource: "setting",
    });
  });

  it("does not save an invalid number of approvals", async () => {
    const wrapper = await mountApp();
    await wrapper.find("#approvals-needed").setValue("0");
    await flushPromises();
    expect(wrapper.find("#approvals-needed").attributes("aria-invalid")).toBe("true");
    expect((await loadSettings()).approvalsNeeded).toBe(DEFAULT_SETTINGS.approvalsNeeded);
  });

  it("follows changes made elsewhere", async () => {
    const wrapper = await mountApp();
    await browser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, animateCards: false } });
    await flushPromises();
    expect(toggle(wrapper, "Animate cards moving between columns")?.attributes("aria-checked")).toBe("false");
  });

  it("imports a settings file and rejects anything else", async () => {
    const wrapper = await mountApp();
    const input = wrapper.find("input[type=file]");
    const choose = async (name: string, content: string) => {
      Object.defineProperty(input.element, "files", { value: [new File([content], name)], configurable: true });
      await input.trigger("change");
      await flushPromises();
    };

    await choose("team.json", JSON.stringify({ mrflow: { ...DEFAULT_SETTINGS, kanbanView: false } }));
    expect((await loadSettings()).kanbanView).toBe(false);
    expect(wrapper.find("[role=status]").text()).toContain("Imported");

    await choose("notes.txt", "hello");
    expect(wrapper.find("[role=status]").classes()).toContain("gl-alert-danger");
    expect((await loadSettings()).kanbanView).toBe(false);
  });
});
