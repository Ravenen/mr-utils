import { onScopeDispose, ref, type Ref } from "vue";
import { loadSettings, saveSettings, watchSettings, type Settings } from "@/core/settings";

// Settings as reactive state: loaded once, saved on every change, and refreshed when another page
// (the popup, another options tab, an import) changes them
export function useSettings(): {
  settings: Ref<Settings | null>;
  update: (changes: Partial<Settings>) => Promise<void>;
} {
  const settings = ref<Settings | null>(null);
  const controller = new AbortController();
  onScopeDispose(() => controller.abort());

  void loadSettings().then((loaded) => {
    settings.value = loaded;
  });
  watchSettings((changed) => {
    settings.value = changed;
  }, controller.signal);

  const update = async (changes: Partial<Settings>) => {
    settings.value = await saveSettings(changes);
  };
  return { settings, update };
}
