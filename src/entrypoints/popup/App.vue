<script setup lang="ts">
import { computed } from "vue";
import { browser } from "wxt/browser";
import GlToggle from "@/components/GlToggle.vue";
import { useSettings } from "@/components/useSettings";

// A short panel: the features on or off; everything else is on the options page
const { settings, update } = useSettings();
const kanbanView = computed({
  get: () => settings.value?.kanbanView ?? false,
  set: (value: boolean) => void update({ kanbanView: value }),
});
const approvalGuard = computed({
  get: () => settings.value?.approvalGuard ?? false,
  set: (value: boolean) => void update({ approvalGuard: value }),
});
const hunkReview = computed({
  get: () => settings.value?.hunkReview ?? false,
  set: (value: boolean) => void update({ hunkReview: value }),
});

function openOptions() {
  void browser.runtime.openOptionsPage();
  window.close();
}
</script>

<template>
  <main class="mrflow-popup">
    <h2>MRFlow</h2>
    <template v-if="settings">
      <GlToggle v-model="kanbanView" label="Kanban board" help="On the merge request list" />
      <GlToggle v-model="approvalGuard" label="Approval checklist" help="On the merge request page" />
      <GlToggle v-model="hunkReview" label="Hunk review" help="On the Changes tab" />
    </template>
    <div class="mrflow-popup-footer">
      <button type="button" class="gl-button gl-button-link" @click="openOptions">All settings</button>
    </div>
  </main>
</template>
