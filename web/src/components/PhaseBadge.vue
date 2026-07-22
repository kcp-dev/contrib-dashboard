<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ phase?: string }>();

const cfg = computed(() => {
  switch (props.phase) {
    case "Ready":
      return { cls: "ok",      icon: "check",   label: "Ready"        };
    case "Bound":
      return { cls: "ok",      icon: "check",   label: "Bound"        };
    case "Binding":
      return { cls: "pending", icon: "clock",   label: "Binding"      };
    case "Initializing":
      return { cls: "pending", icon: "clock",   label: "Initializing" };
    case "Scheduling":
      return { cls: "pending", icon: "clock",   label: "Scheduling"   };
    case "PendingClaims":
      return { cls: "pending", icon: "clock",   label: "Pending claims" };
    case "Terminating":
    case "Deleting":
      return { cls: "warn",    icon: "x",       label: props.phase    };
    case "Unavailable":
    case "NotReady":
      return { cls: "warn",    icon: "x",       label: "Not ready"    };
    case "NoIdentity":
      return { cls: "warn",    icon: "x",       label: "No identity"  };
    case "Unknown":
    default:
      return { cls: "muted",   icon: "dash",    label: props.phase || "Unknown" };
  }
});
</script>

<template>
  <span class="badge" :class="cfg.cls">
    <!-- check -->
    <svg v-if="cfg.icon === 'check'" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 8l4 4 8-8"/>
    </svg>
    <!-- clock -->
    <svg v-else-if="cfg.icon === 'clock'" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <circle cx="8" cy="8" r="6.5"/>
      <path d="M8 4.5V8l2.5 1.5"/>
    </svg>
    <!-- x -->
    <svg v-else-if="cfg.icon === 'x'" width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round">
      <path d="M2 2l12 12M14 2L2 14"/>
    </svg>
    <!-- dash -->
    <svg v-else width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round">
      <path d="M3 8h10"/>
    </svg>
    {{ cfg.label }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.2rem 0.6rem 0.2rem 0.45rem;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  border: 1px solid transparent;
  white-space: nowrap;
  line-height: 1;
}
.badge svg { flex: none; }

.ok      { background: #f0fdf4; color: #15803d; border-color: #86efac; }
.pending { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
.warn    { background: #fef2f2; color: #dc2626; border-color: #fca5a5; }
.muted   { background: #f8fafc; color: #64748b; border-color: #e2e8f0; }
</style>
