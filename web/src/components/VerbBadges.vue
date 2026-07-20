<script setup lang="ts">
// Renders RBAC verbs as small colour-coded badges: reads (get/list/watch),
// writes (create/update/patch), deletes, and wildcard.
import { computed } from "vue";

const props = defineProps<{ verbs?: string[] }>();

const READ = new Set(["get", "list", "watch"]);
const WRITE = new Set(["create", "update", "patch"]);
const DEL = new Set(["delete", "deletecollection"]);

function kind(v: string): string {
  if (v === "*") return "all";
  if (READ.has(v)) return "read";
  if (WRITE.has(v)) return "write";
  if (DEL.has(v)) return "del";
  return "other";
}

// Preserve a sensible order regardless of source ordering.
const ORDER = [
  "get",
  "list",
  "watch",
  "create",
  "update",
  "patch",
  "delete",
  "deletecollection",
  "*",
];
const ordered = computed(() =>
  [...(props.verbs ?? [])].sort(
    (a, b) => (ORDER.indexOf(a) + 100) % 200 - ((ORDER.indexOf(b) + 100) % 200),
  ),
);
</script>

<template>
  <span class="verbs">
    <span v-for="v in ordered" :key="v" class="verb" :class="kind(v)">{{ v }}</span>
    <span v-if="!ordered.length" class="none">—</span>
  </span>
</template>

<style scoped>
.verbs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.verb {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.08rem 0.4rem;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  border: 1px solid transparent;
  line-height: 1.4;
}
.read {
  background: #e8f0fe;
  color: #1a56c4;
  border-color: #cddffb;
}
.write {
  background: #e9f7ef;
  color: #1e7e46;
  border-color: #c3e9d3;
}
.del {
  background: #fdecea;
  color: #c0392b;
  border-color: #f5c6c2;
}
.all {
  background: #f3e8fd;
  color: #7b2ec4;
  border-color: #e2ccf7;
}
.other {
  background: #eceff1;
  color: #546e7a;
  border-color: #cfd8dc;
}
.none {
  color: #b0bec5;
}
</style>
