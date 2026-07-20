<script setup lang="ts">
// A monospace value (hash / URL) in a subtle box with a copy button and an
// optional external-link affordance.
import { ref } from "vue";

const props = defineProps<{ value: string; href?: string }>();
const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <div class="copyfield">
    <a v-if="href" class="val link" :href="href" target="_blank" rel="noopener">{{
      value
    }}</a>
    <span v-else class="val">{{ value }}</span>
    <button class="copy" :title="copied ? 'copied' : 'copy'" @click="copy">
      {{ copied ? "✓" : "⧉" }}
    </button>
  </div>
</template>

<style scoped>
.copyfield {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f7f9fa;
  border: 1px solid #eceff1;
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
}
.val {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  color: #37474f;
  word-break: break-all;
  flex: 1;
}
.link {
  color: #1565c0;
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.copy {
  flex: none;
  border: 1px solid #cfd8dc;
  background: #fff;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.1rem 0.4rem;
  color: #607d8b;
}
.copy:hover {
  color: #1565c0;
  border-color: #90caf9;
}
</style>
