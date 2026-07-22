<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ verbs?: string[] }>();
const READ  = new Set(["get", "list", "watch"]);
const WRITE = new Set(["create", "update", "patch"]);
const DEL   = new Set(["delete", "deletecollection"]);
function kind(v: string) {
  if (v === "*")      return "all";
  if (READ.has(v))    return "read";
  if (WRITE.has(v))   return "write";
  if (DEL.has(v))     return "del";
  return "other";
}
const ORDER = ["get","list","watch","create","update","patch","delete","deletecollection","*"];
const ordered = computed(() =>
  [...(props.verbs ?? [])].sort((a, b) => (ORDER.indexOf(a)+100)%200 - ((ORDER.indexOf(b)+100)%200))
);
</script>

<template>
  <span class="verbs">
    <span v-for="v in ordered" :key="v" class="verb" :class="kind(v)">{{ v }}</span>
    <span v-if="!ordered.length" class="none">—</span>
  </span>
</template>

<style scoped>
.verbs { display: inline-flex; flex-wrap: wrap; gap: 0.2rem; }
.verb {
  font-size: 0.65rem; font-weight: 700;
  padding: 0.1rem 0.38rem;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  border: 1px solid transparent;
  letter-spacing: 0.02em;
  text-transform: lowercase;
}
.read  { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.write { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.del   { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.all   { background: #faf5ff; color: #7c3aed; border-color: #ddd6fe; }
.other { background: #f8fafc; color: #64748b; border-color: #e2e8f0; }
.none  { color: #cbd5e1; font-size: 0.75rem; }
</style>
