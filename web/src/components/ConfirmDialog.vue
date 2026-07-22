<script setup lang="ts">
defineProps<{
  title: string;
  message?: string;
  confirmLabel?: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div class="cd-backdrop" @click.self="emit('cancel')">
      <div class="cd-box" role="alertdialog" aria-modal="true">
        <div class="cd-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div class="cd-content">
          <p class="cd-title">{{ title }}</p>
          <p v-if="message" class="cd-message">{{ message }}</p>
        </div>
        <div class="cd-actions">
          <button class="cd-cancel" @click="emit('cancel')" :disabled="busy">Cancel</button>
          <button class="cd-confirm" @click="emit('confirm')" :disabled="busy">
            <svg v-if="busy" class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            {{ confirmLabel ?? 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cd-backdrop {
  position: fixed; inset: 0; z-index: 500;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
}
.cd-box {
  background: #fff; border-radius: 12px;
  width: 100%; max-width: 380px;
  padding: 1.5rem 1.5rem 1.25rem;
  display: flex; flex-direction: column; gap: 1rem;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 8px 24px -4px rgba(0,0,0,0.14);
}
.cd-icon {
  width: 40px; height: 40px; border-radius: 10px; flex: none;
  background: #fef2f2; color: #dc2626;
  display: flex; align-items: center; justify-content: center;
}
.cd-content { display: flex; flex-direction: column; gap: 0.3rem; }
.cd-title   { margin: 0; font-size: 0.92rem; font-weight: 700; color: #0f172a; }
.cd-message { margin: 0; font-size: 0.8rem; color: #64748b; line-height: 1.5; }
.cd-actions {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  padding-top: 0.25rem;
}
.cd-cancel, .cd-confirm {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-family: inherit; font-size: 0.8rem; font-weight: 600;
  padding: 0.42rem 0.9rem; border-radius: 7px; cursor: pointer;
  transition: background 0.1s, border-color 0.1s, opacity 0.1s;
}
.cd-cancel {
  background: #fff; color: #475569; border: 1px solid #e2e8f0;
}
.cd-cancel:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.cd-confirm {
  background: #dc2626; color: #fff; border: 1px solid #dc2626;
  box-shadow: 0 1px 3px rgba(220,38,38,0.2);
}
.cd-confirm:hover:not(:disabled) { background: #b91c1c; }
.cd-cancel:disabled, .cd-confirm:disabled { opacity: 0.5; cursor: default; }

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; transform-box: fill-box; transform-origin: center; }
</style>
