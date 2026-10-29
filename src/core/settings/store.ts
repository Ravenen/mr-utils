import { browser } from "wxt/browser";
import { LEGACY_KEYS, migrateSettings, normalizeSettings, type Settings } from "./schema";

const KEY = "settings";

// Settings from storage.sync, migrated from 1.x on first read
export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(null);
  const { settings, migrated } = migrateSettings(stored);
  if (migrated) {
    await browser.storage.sync.set({ [KEY]: settings });
    await browser.storage.sync.remove(LEGACY_KEYS);
  }
  return settings;
}

export async function saveSettings(changes: Partial<Settings>): Promise<Settings> {
  const settings = normalizeSettings({ ...(await loadSettings()), ...changes });
  await browser.storage.sync.set({ [KEY]: settings });
  return settings;
}

// Calls onChange with the new settings whenever they change (in any tab, the popup or the options page)
export function watchSettings(onChange: (settings: Settings) => void, signal: AbortSignal): void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "sync" && KEY in changes) onChange(normalizeSettings(changes[KEY]?.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  signal.addEventListener("abort", () => browser.storage.onChanged.removeListener(listener), { once: true });
}

export function exportSettings(settings: Settings): string {
  return JSON.stringify({ mrflow: settings }, null, 2);
}

// Settings from an exported file (or a bare settings object); throws when it is not JSON
export function parseImportedSettings(json: string): Settings {
  const parsed = JSON.parse(json) as { mrflow?: unknown };
  return normalizeSettings(parsed && typeof parsed === "object" && "mrflow" in parsed ? parsed.mrflow : parsed);
}
