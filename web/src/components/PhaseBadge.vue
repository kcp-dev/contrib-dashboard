<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ phase?: string }>();

const cls = computed(() => {
  switch (props.phase) {
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
      return "muted";
  }
});
</script>

<template>
  <span class="badge" :class="cls">{{ phase || "Unknown" }}</span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid transparent;
}
.ok {
  background: #e6f4ea;
  color: #1e7e34;
  border-color: #b7e0c4;
}
.pending {
  background: #fff8e1;
  color: #9a6b00;
  border-color: #f0dca0;
}
.warn {
  background: #fdecea;
  color: #b71c1c;
  border-color: #f5c6c2;
}
.muted {
  background: #eceff1;
  color: #546e7a;
  border-color: #cfd8dc;
}
</style>
