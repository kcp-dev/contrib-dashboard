<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import { listAPIExports, listEndpointSlices } from "../api/apis";
import type { APIExport, APIExportEndpointSlice } from "../types/apis";
import { apiExportStatus } from "../types/apis";
import { ApiError } from "../api/client";
import PhaseBadge from "../components/PhaseBadge.vue";
import VerbBadges from "../components/VerbBadges.vue";
import CopyField from "../components/CopyField.vue";

const wsStore = useWorkspaceStore();
const { current } = storeToRefs(wsStore);

const exports = ref<APIExport[]>([]);
const slices  = ref<APIExportEndpointSlice[]>([]);
const loading = ref(false);
const error   = ref<string | null>(null);
const expanded = ref<string | null>(null);

async function load() {
  loading.value = true; error.value = null;
  try {
    const [ex, sl] = await Promise.all([
      listAPIExports(current.value),
      listEndpointSlices(current.value).catch(() => ({ items: [] as APIExportEndpointSlice[] })),
    ]);
    exports.value = ex.items ?? [];
    slices.value  = (sl as { items: APIExportEndpointSlice[] }).items ?? [];

  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    exports.value = [];
  } finally { loading.value = false; }
}

function toggle(name: string) {
  expanded.value = expanded.value === name ? null : name;
}

function resourceRefs(ex: APIExport) {
  if (ex.spec.resources?.length)
    return ex.spec.resources.map(r => ({ name: r.name, group: r.group }));
  return (ex.spec.latestResourceSchemas ?? []).map(s => {
    const p = s.split(".");
    return { name: p[1] ?? s, group: p.slice(2).join(".") };
  });
}

function urlsFor(ex: APIExport): string[] {
  // Prefer APIExportEndpointSlice URLs (current API); fall back to legacy
  // status.virtualWorkspaces field still present in older KCP versions.
  const sliceUrls = slices.value
    .filter(s => s.spec.export?.name === ex.metadata.name)
    .flatMap(s => s.status?.endpoints?.map(e => e.url) ?? []);
  if (sliceUrls.length) return sliceUrls;
  return ex.status?.virtualWorkspaces?.map(v => v.url) ?? [];
}

const statusOf = (ex: APIExport) => apiExportStatus(ex);

onMounted(load);
watch(current, () => { expanded.value = null; load(); });
</script>

<template>
  <div class="page">

    <!-- Page header -->
    <div class="page-head">
      <div>
        <h1 class="page-title">API Exports</h1>
        <p class="page-sub">Workspace <code class="ws-code">{{ current }}</code></p>
      </div>
      <button class="btn-refresh" @click="load" :disabled="loading">
        <svg :class="{ spin: loading }" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Refresh
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="alert-error">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="loading && !exports.length" class="loading-row">
      <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
      Loading…
    </div>

    <!-- Empty -->
    <div v-else-if="!exports.length && !error" class="empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".3">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      </svg>
      <p>No API exports in <strong>{{ current }}</strong></p>
    </div>

    <!-- List -->
    <div v-else class="card-list">
      <div v-for="ex in exports" :key="ex.metadata.name" class="card" :class="{ open: expanded === ex.metadata.name }">

        <!-- Summary row -->
        <div class="summary" @click="toggle(ex.metadata.name)">
          <button class="chevron" :class="{ open: expanded === ex.metadata.name }" tabindex="-1">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 3l6 5-6 5"/>
            </svg>
          </button>

          <span class="ex-name">{{ ex.metadata.name }}</span>
          <PhaseBadge :phase="statusOf(ex).phase" />

          <div class="summary-stats">
            <span class="stat">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              {{ resourceRefs(ex).length }} resource{{ resourceRefs(ex).length !== 1 ? 's' : '' }}
            </span>
            <span class="stat">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              {{ ex.spec.permissionClaims?.length || 0 }} claim{{ (ex.spec.permissionClaims?.length || 0) !== 1 ? 's' : '' }}
            </span>
          </div>
        </div>

        <!-- Detail panel -->
        <div v-if="expanded === ex.metadata.name" class="detail">

          <!-- Identity hash -->
          <section class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Identity hash
            </h4>
            <CopyField :value="ex.status?.identityHash || '—'" />
          </section>

          <!-- Resources -->
          <section class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              Resources
              <span class="pill">{{ resourceRefs(ex).length }}</span>
            </h4>
            <div v-if="resourceRefs(ex).length" class="res-grid">
              <div v-for="r in resourceRefs(ex)" :key="r.name + r.group" class="res-chip">
                <span class="res-name">{{ r.name }}</span><span v-if="r.group" class="res-group">.{{ r.group }}</span>
              </div>
            </div>
            <p v-else class="empty-inline">No resources declared</p>
          </section>

          <!-- Permission claims -->
          <section v-if="ex.spec.permissionClaims?.length" class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Permission claims
              <span class="pill">{{ ex.spec.permissionClaims.length }}</span>
            </h4>
            <div class="claim-table">
              <div class="claim-header">
                <span>Resource</span><span>Verbs</span>
              </div>
              <div v-for="(c, i) in ex.spec.permissionClaims" :key="i" class="claim-row">
                <span class="claim-res"><span class="res-name">{{ c.resource }}</span><span v-if="c.group" class="res-group">.{{ c.group }}</span></span>
                <VerbBadges :verbs="c.verbs" />
              </div>
            </div>
          </section>

          <!-- VW URLs -->
          <section class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              Virtual workspace URLs
            </h4>
            <div v-if="urlsFor(ex).length" class="url-list">
              <CopyField v-for="u in urlsFor(ex)" :key="u" :value="u" :href="u" />
            </div>
            <p v-else class="empty-inline">No endpoint slices yet</p>
          </section>

        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Page shell ── */
.page { display: flex; flex-direction: column; gap: 0; height: 100%; }

.page-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 1.25rem; gap: 1rem;
}
.page-title { margin: 0 0 0.2rem; font-size: 1.15rem; font-weight: 700; color: #0f172a; }
.page-sub   { margin: 0; font-size: 0.78rem; color: #94a3b8; }
.ws-code {
  font-family: ui-monospace, Menlo, monospace; font-size: 0.75rem;
  background: #f1f5f9; color: #475569; padding: 0.1rem 0.4rem; border-radius: 4px;
}

.btn-refresh {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-family: inherit; font-size: 0.8rem; font-weight: 600;
  padding: 0.42rem 0.85rem; border-radius: 7px;
  border: 1px solid #e2e8f0; background: #fff; color: #475569;
  cursor: pointer; white-space: nowrap; flex: none;
  transition: background 0.12s, border-color 0.12s;
}
.btn-refresh:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.btn-refresh:disabled { opacity: 0.5; cursor: default; }

/* ── States ── */
.alert-error {
  display: flex; align-items: flex-start; gap: 0.5rem;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  color: #dc2626; font-size: 0.82rem; padding: 0.7rem 0.85rem; margin-bottom: 1rem;
}
.alert-error svg { flex: none; margin-top: 1px; }
.loading-row {
  display: flex; align-items: center; gap: 0.5rem;
  color: #94a3b8; font-size: 0.85rem; padding: 2rem 0;
}
.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.75rem; padding: 4rem 1rem; color: #94a3b8; text-align: center;
}
.empty p { margin: 0; font-size: 0.88rem; }

/* ── Card list ── */
.card-list { display: flex; flex-direction: column; gap: 0.5rem; }
.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  transition: box-shadow 0.12s;
}
.card:hover { box-shadow: 0 1px 6px rgba(0,0,0,0.06); }
.card.open  { border-color: #c7d2fe; box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }

/* Summary row */
.summary {
  display: flex; align-items: center; gap: 0.7rem;
  padding: 0.75rem 1rem; cursor: pointer; user-select: none;
  transition: background 0.08s;
}
.summary:hover { background: #fafafa; }

.chevron {
  background: none; border: none; padding: 0; cursor: pointer;
  color: #94a3b8; display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 4px; flex: none;
  transition: transform 0.18s ease, color 0.12s, background 0.12s;
}
.chevron.open { transform: rotate(90deg); color: #6366f1; }
.summary:hover .chevron { color: #475569; background: #f1f5f9; }

.ex-name {
  font-size: 0.92rem; font-weight: 700; color: #0f172a;
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.summary-stats { display: flex; gap: 0.65rem; margin-left: auto; }
.stat {
  display: inline-flex; align-items: center; gap: 0.28rem;
  font-size: 0.72rem; color: #94a3b8; white-space: nowrap;
}

/* Detail */
.detail {
  border-top: 1px solid #f1f5f9;
  background: #fafbfc;
  padding: 0 1.25rem 1.25rem;
  display: flex; flex-direction: column; gap: 0;
}

/* Sections */
.section { padding-top: 1.1rem; }
.section + .section { border-top: 1px solid #f1f5f9; margin-top: 0.1rem; }

.section-title {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.07em; color: #94a3b8; margin: 0 0 0.65rem;
}
.section-title svg { flex: none; }

.pill {
  background: #e2e8f0; color: #64748b; border-radius: 999px;
  padding: 0 0.4rem; font-size: 0.65rem; letter-spacing: 0;
  font-weight: 700; margin-left: 0.15rem;
}

/* Resource chips */
.res-grid { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.res-chip {
  display: inline-flex; align-items: baseline;
  background: #f1f5f9; border: 1px solid #e2e8f0;
  border-radius: 6px; padding: 0.2rem 0.55rem;
  font-family: ui-monospace, Menlo, monospace; font-size: 0.75rem;
}
.res-name  { color: #1e293b; font-weight: 600; }
.res-group { color: #94a3b8; }

/* Claim table */
.claim-table {
  border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;
  font-size: 0.8rem;
}
.claim-header {
  display: grid; grid-template-columns: 1fr auto;
  padding: 0.4rem 0.85rem;
  background: #f8fafc;
  font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: #94a3b8;
  border-bottom: 1px solid #e2e8f0;
}
.claim-row {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center; gap: 1rem;
  padding: 0.5rem 0.85rem;
  border-bottom: 1px solid #f1f5f9;
}
.claim-row:last-child { border-bottom: none; }
.claim-row:nth-child(even) { background: #fafbfc; }
.claim-res {
  font-family: ui-monospace, Menlo, monospace; font-size: 0.78rem; min-width: 0;
}

/* URL list */
.url-list { display: flex; flex-direction: column; gap: 0.35rem; }

.empty-inline { margin: 0; font-size: 0.78rem; color: #94a3b8; font-style: italic; }

/* Spin */

/* ── Condition indicator dots ── */
.cond-row {
  display: flex; gap: 0.4rem; align-items: center; flex-wrap: nowrap;
}
.cond-dot {
  display: inline-flex; align-items: center; gap: 0.2rem;
  font-size: 0.65rem; font-weight: 700;
  padding: 0.15rem 0.45rem 0.15rem 0.3rem;
  border-radius: 999px; border: 1px solid transparent; white-space: nowrap;
}
.cond-dot.ok   { background: #f0fdf4; color: #15803d; border-color: #86efac; }
.cond-dot.warn { background: #fef2f2; color: #dc2626; border-color: #fca5a5; }

/* ── Condition health grid (binding detail) ── */
.health-grid { display: flex; flex-direction: column; gap: 0.3rem; }
.health-row {
  display: flex; align-items: flex-start; gap: 0.45rem;
  padding: 0.4rem 0.65rem; border-radius: 7px; font-size: 0.78rem;
}
.health-row svg { flex: none; margin-top: 1px; }
.health-row.ok   { background: #f0fdf4; color: #15803d; }
.health-row.warn { background: #fef2f2; color: #dc2626; }
.health-type { font-weight: 600; }
.health-msg  { color: inherit; opacity: 0.75; margin-left: 0.35rem; font-style: italic; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { display: inline-block; animation: spin 0.7s linear infinite; transform-box: fill-box; transform-origin: center; }
</style>
