<script setup lang="ts">
import { ref } from "vue";
const props = defineProps<{ value: string; href?: string }>();
const copied = ref(false);
async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch { /* unavailable */ }
}
</script>

<template>
  <div class="cf">
    <a v-if="href" class="val link" :href="href" target="_blank" rel="noopener">{{ value }}</a>
    <span v-else class="val">{{ value }}</span>
    <button class="btn" :class="{ ok: copied }" :title="copied ? 'Copied!' : 'Copy'" @click="copy">
      <!-- checkmark -->
      <svg v-if="copied" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 8l4 4 8-8"/>
      </svg>
      <!-- copy -->
      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.cf {
  display: flex; align-items: center; gap: 0.5rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  padding: 0.38rem 0.38rem 0.38rem 0.65rem;
  transition: border-color 0.12s;
}
.cf:hover { border-color: #cbd5e1; }
.val {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 0.78rem; color: #334155;
  word-break: break-all; flex: 1;
}
.link { color: #2563eb; text-decoration: none; }
.link:hover { text-decoration: underline; }
.btn {
  flex: none;
  width: 24px; height: 24px;
  border: 1px solid #e2e8f0;
  background: #fff; border-radius: 5px;
  cursor: pointer; color: #64748b;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.btn:hover { background: #f1f5f9; color: #1e293b; border-color: #cbd5e1; }
.btn.ok { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }
</style>
