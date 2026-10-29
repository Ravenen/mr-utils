<script setup lang="ts">
import { computed, ref } from "vue";
import GlToggle from "@/components/GlToggle.vue";
import { useSettings } from "@/components/useSettings";
import { exportSettings, parseImportedSettings, type Settings } from "@/core/settings";

const { settings, update } = useSettings();
const status = ref<{ kind: "success" | "danger"; text: string } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// v-model for one field: reads the settings, saves a change right away
function field<K extends keyof Settings>(key: K) {
  return computed({
    get: () => settings.value?.[key] as Settings[K],
    set: (value: Settings[K]) => void update({ [key]: value } as Partial<Settings>),
  });
}
const approvalsSource = field("approvalsSource");
const kanbanView = field("kanbanView");
const boardLoading = field("boardLoading");
const animateCards = field("animateCards");
const approvalGuard = field("approvalGuard");
const resetChecksOnNewCommits = field("resetChecksOnNewCommits");
const hunkReview = field("hunkReview");

const approvalsInvalid = ref(false);
function setApprovalsNeeded(event: Event) {
  const value = parseInt((event.target as HTMLInputElement).value, 10);
  approvalsInvalid.value = !(value >= 1);
  if (!approvalsInvalid.value) void update({ approvalsNeeded: value });
}

function exportFile() {
  if (!settings.value) return;
  const blob = new Blob([exportSettings(settings.value)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "mrflow-settings.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    await update(parseImportedSettings(await file.text()));
    status.value = { kind: "success", text: `Imported settings from ${file.name}.` };
  } catch {
    status.value = { kind: "danger", text: `${file.name} is not an MRFlow settings file.` };
  }
}
</script>

<template>
  <main class="mrflow-options">
    <header class="mrflow-options-header">
      <h1>MRFlow settings</h1>
      <p class="gl-text-subtle">Changes are saved right away and apply to open GitLab tabs.</p>
    </header>

    <template v-if="settings">
      <section class="gl-card" aria-labelledby="approvals-heading">
        <h2 id="approvals-heading">Approvals</h2>
        <div class="gl-form-group">
          <span class="gl-label">Required approvals</span>
          <div class="gl-radio-group" role="radiogroup">
            <label class="gl-radio-label">
              <input v-model="approvalsSource" class="gl-radio" type="radio" value="gitlab" />
              <span>
                From the project's approval rules
                <span class="gl-form-text">Uses the number below for projects without approval rules.</span>
              </span>
            </label>
            <label class="gl-radio-label">
              <input v-model="approvalsSource" class="gl-radio" type="radio" value="setting" />
              <span>Always the number below</span>
            </label>
          </div>
        </div>
        <div class="gl-form-group">
          <label for="approvals-needed">Number of approvals</label>
          <input
            id="approvals-needed"
            class="gl-form-input gl-form-input-sm"
            type="number"
            min="1"
            :value="settings.approvalsNeeded"
            :aria-invalid="approvalsInvalid"
            @input="setApprovalsNeeded"
          />
          <div v-if="approvalsInvalid" class="gl-form-text">Enter 1 or more.</div>
        </div>
      </section>

      <section class="gl-card" aria-labelledby="list-heading">
        <h2 id="list-heading">Merge request list</h2>
        <GlToggle
          v-model="kanbanView"
          label="Kanban board"
          help="To Review, Pending (you have unresolved threads) and Approved columns, for open merge requests."
        />
        <div class="gl-form-group">
          <label for="board-loading">Board updates</label>
          <select id="board-loading" v-model="boardLoading" class="gl-form-select" :disabled="!kanbanView">
            <option value="all">In waves, as each loading stage completes</option>
            <option value="progressive">Each card as soon as its details load</option>
          </select>
        </div>
        <GlToggle
          v-model="animateCards"
          label="Animate cards moving between columns"
          help="Also off when your system asks for reduced motion."
        />
      </section>

      <section class="gl-card" aria-labelledby="page-heading">
        <h2 id="page-heading">Merge request page</h2>
        <GlToggle
          v-model="approvalGuard"
          label="Approval checklist"
          help="Hides Approve and Merge until every check is ticked."
        />
        <GlToggle
          v-model="resetChecksOnNewCommits"
          label="Reset checks on new commits"
          help="Unticks the checklist when the source branch gets new commits."
        />
      </section>

      <section class="gl-card" aria-labelledby="changes-heading">
        <h2 id="changes-heading">Changes</h2>
        <GlToggle
          v-model="hunkReview"
          label="Hunk review"
          help="A Viewed checkbox on every hunk, not only on the whole file."
        />
      </section>

      <section class="gl-card" aria-labelledby="backup-heading">
        <h2 id="backup-heading">Backup</h2>
        <p class="gl-text-subtle">Move your settings to another browser or share them with your team.</p>
        <div class="mrflow-options-actions">
          <button type="button" class="gl-button" @click="exportFile">Export settings</button>
          <button type="button" class="gl-button" @click="fileInput?.click()">Import settings</button>
          <input
            ref="fileInput"
            class="gl-sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="Settings file"
            @change="importFile"
          />
        </div>
        <div v-if="status" :class="['gl-alert', 'mrflow-options-status', `gl-alert-${status.kind}`]" role="status">
          {{ status.text }}
        </div>
      </section>
    </template>
  </main>
</template>
