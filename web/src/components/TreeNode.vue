<script setup lang="ts">
import { computed, inject } from "vue";
import { TreeHandlersKey, type TreeNodeData } from "./tree";

const props = defineProps<{ node: TreeNodeData; depth: number }>();

const handlers = inject(TreeHandlersKey)!;

const selected = computed(() => handlers.currentPath() === props.node.path);

// Show a chevron while children are unknown (not yet loaded) or known to exist.
const showChevron = computed(
  () => props.node.hasChildren || !props.node.loaded,
);

const phaseClass = computed(() => {
  switch (props.node.phase) {
    case "Ready":
      return "ok";
    case "Initializing":
    case "Scheduling":
      return "pending";
    case "Terminating":
    case "Deleting":
    case "Unavailable":
      return "warn";
    default:
      return "";
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
      <button
        v-if="showChevron"
        class="chev"
        :class="{ open: node.expanded }"
        @click.stop="handlers.toggle(node)"
        :title="node.expanded ? 'collapse' : 'expand'"
      >
        <span v-if="node.loading" class="spin">↻</span>
        <span v-else>▸</span>
      </button>
      <span v-else class="chev-spacer"></span>

      <span class="label">{{ node.name }}</span>
      <span
        v-if="phaseClass"
        class="dot"
        :class="phaseClass"
        :title="node.phase"
      ></span>
      <button
        v-if="depth > 0"
        class="del"
        title="delete workspace"
        @click.stop="handlers.remove(node)"
      >
        ×
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
  gap: 0.35rem;
  padding: 0.28rem 0.5rem;
  cursor: pointer;
  border-radius: 6px;
  font-size: 0.88rem;
  color: #cfd8dc;
  user-select: none;
}
.row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.row.selected {
  background: #1565c0;
  color: #fff;
}
.chev {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  width: 14px;
  font-size: 0.7rem;
  line-height: 1;
  transition: transform 0.12s ease;
  transform: rotate(0deg);
}
.chev.open {
  transform: rotate(90deg);
}
.chev-spacer {
  display: inline-block;
  width: 14px;
}
.spin {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.del {
  background: none;
  border: none;
  color: inherit;
  opacity: 0;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.15rem;
  flex: none;
}
.row:hover .del {
  opacity: 0.55;
}
.del:hover {
  opacity: 1 !important;
  color: #ef5350;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.dot.ok {
  background: #4caf50;
}
.dot.pending {
  background: #ffb300;
}
.dot.warn {
  background: #ef5350;
}
</style>
