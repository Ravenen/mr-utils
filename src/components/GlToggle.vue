<script setup lang="ts">
// Pajamas toggle: a labelled switch with an optional help text
defineProps<{ label: string; help?: string }>();
const checked = defineModel<boolean>({ required: true });
const id = `mrflow-toggle-${Math.random().toString(36).slice(2)}`;
</script>

<template>
  <div class="gl-form-group gl-toggle-wrapper">
    <div>
      <label :id="id" class="gl-label">{{ label }}</label>
      <div v-if="help" class="gl-form-text">{{ help }}</div>
    </div>
    <button
      type="button"
      role="switch"
      class="gl-toggle"
      :aria-checked="checked"
      :aria-labelledby="id"
      @click="checked = !checked"
    ></button>
  </div>
</template>
