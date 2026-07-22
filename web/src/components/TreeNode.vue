<script setup lang="ts">
import { computed, inject } from "vue";
import { TreeHandlersKey, type TreeNodeData } from "./tree";

const props = defineProps<{ node: TreeNodeData; depth: number }>();

const handlers = inject(TreeHandlersKey)!;

const selected = computed(() => handlers.currentPath() === props.node.path);

// - loading: show spinner-chevron
// - loaded + hasChildren: show chevron (accurate)
// - not yet loaded + not loading: hide chevron (probe hasn't run yet or failed,
//   but showing a dead chevron on a leaf is worse than missing one on a rare
//   race — the user can always expand the parent to re-probe)
const showChevron = computed(
  () => props.node.loading || props.node.hasChildren,
);

const phaseClass = computed(() => {
  switch (props.node.phase) {
    case "Ready":      return "ok";
    case "Initializing":
    case "Scheduling": return "pending";
    case "Terminating":
    case "Deleting":
    case "Unavailable": return "warn";
    default:           return "";
  }
});
</script>

<template>
  <div class="node">
    <div
      class="row"
      :class="{ selected }"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="handlers.select(node.path)"
    >
      <!-- Chevron button — only when children are known to exist or loading -->
      <button
        v-if="showChevron"
        class="chev"
        :class="{ open: node.expanded }"
        @click.stop="handlers.toggle(node)"
        :title="node.expanded ? 'Collapse' : 'Expand'"
      >
        <!-- Loading spinner -->
        <svg v-if="node.loading" class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <!-- Chevron arrow -->
        <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 3l6 5-6 5"/>
        </svg>
      </button>
      <span v-else class="chev-spacer"></span>

      <span class="label">{{ node.name }}</span>
      <span v-if="phaseClass" class="dot" :class="phaseClass" :title="node.phase"></span>
      <button v-if="depth > 0" class="del" title="Delete workspace" @click.stop="handlers.remove(node)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>

    <div v-if="node.expanded" class="children">
      <TreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.5rem;
  cursor: pointer;
  border-radius: 6px;
  font-size: 0.855rem;
  color: #94a3b8;
  user-select: none;
  transition: background 0.1s, color 0.1s;
}
.row:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
}
.row.selected {
  background: rgba(99, 102, 241, 0.22);
  color: #c7d2fe;
}

/* Chevron button */
.chev {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  transition: transform 0.15s ease;
  transform: rotate(0deg);
}
.chev.open {
  transform: rotate(90deg);
}
.chev-spacer {
  display: inline-block;
  width: 16px;
  flex: none;
}

/* Spinner on the chevron position */
.spin {
  animation: spin 0.7s linear infinite;
  transform-origin: center;
  transform-box: fill-box;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

/* Delete button — appears on hover */
.del {
  background: none;
  border: none;
  color: inherit;
  opacity: 0;
  cursor: pointer;
  padding: 0.1rem;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  transition: opacity 0.1s, color 0.1s;
}
.row:hover .del {
  opacity: 0.45;
}
.del:hover {
  opacity: 1 !important;
  color: #f87171;
}

/* Phase dot */
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.dot.ok      { background: #4ade80; }
.dot.pending { background: #fbbf24; }
.dot.warn    { background: #f87171; }
</style>
