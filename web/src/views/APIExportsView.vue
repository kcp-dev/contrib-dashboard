<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import { listAPIExports, listEndpointSlices } from "../api/apis";
import type { APIExport, APIExportEndpointSlice } from "../types/apis";
import { isReady } from "../types/apis";
import { ApiError } from "../api/client";
import PhaseBadge from "../components/PhaseBadge.vue";
import VerbBadges from "../components/VerbBadges.vue";
import CopyField from "../components/CopyField.vue";

const wsStore = useWorkspaceStore();
const { current } = storeToRefs(wsStore);

const exports = ref<APIExport[]>([]);
const slices = ref<APIExportEndpointSlice[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const expanded = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [ex, sl] = await Promise.all([
      listAPIExports(current.value),
      listEndpointSlices(current.value).catch(
        () => ({ items: [] as APIExportEndpointSlice[] }),
      ),
    ]);
    exports.value = ex.items ?? [];
    slices.value = (sl as { items: APIExportEndpointSlice[] }).items ?? [];
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    exports.value = [];
  } finally {
    loading.value = false;
  }
}

function toggle(name: string) {
  expanded.value = expanded.value === name ? null : name;
}

// Resources as {name, group}, normalizing v1alpha2 (spec.resources) and
// v1alpha1 (spec.latestResourceSchemas: "<version>.<resource>.<group>").
function resourceRefs(ex: APIExport): { name: string; group: string }[] {
  if (ex.spec.resources?.length) {
    return ex.spec.resources.map((r) => ({ name: r.name, group: r.group }));
  }
  return (ex.spec.latestResourceSchemas ?? []).map((s) => {
    const parts = s.split(".");
    return { name: parts[1] ?? s, group: parts.slice(2).join(".") };
  });
}

function urlsFor(name: string): string[] {
  return slices.value
    .filter((s) => s.spec.export?.name === name)
    .flatMap((s) => s.status?.endpoints?.map((e) => e.url) ?? []);
}

const phaseOf = (ex: APIExport) =>
  isReady(ex.status?.conditions) ? "Ready" : "NotReady";

const wsLabel = computed(() => current.value);

onMounted(load);
watch(current, load);
</script>

<template>
  <section>
    <div class="head">
      <h2>APIExports <span class="ws">in {{ wsLabel }}</span></h2>
      <button @click="load" :disabled="loading">Refresh</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="!exports.length && !error" class="muted">
      No APIExports in <code>{{ wsLabel }}</code>.
    </p>

    <ul class="list" v-if="exports.length">
      <li v-for="ex in exports" :key="ex.metadata.name" class="row">
        <div class="summary" @click="toggle(ex.metadata.name)">
          <span class="expand">{{
            expanded === ex.metadata.name ? "▾" : "▸"
          }}</span>
          <strong class="name">{{ ex.metadata.name }}</strong>
          <PhaseBadge :phase="phaseOf(ex)" />
          <span class="meta">{{ resourceRefs(ex).length }} resources</span>
          <span class="meta">{{
            ex.spec.permissionClaims?.length || 0
          }} claims</span>
        </div>

        <div class="detail" v-if="expanded === ex.metadata.name">
          <div class="fld">
            <label>Identity</label>
            <CopyField :value="ex.status?.identityHash || '—'" />
          </div>

          <div class="fld">
            <label>Resources <span class="count">{{ resourceRefs(ex).length }}</span></label>
            <ul class="reslist">
              <li v-for="r in resourceRefs(ex)" :key="r.name + r.group">
                <span class="rname">{{ r.name }}</span
                ><span v-if="r.group" class="rgroup">.{{ r.group }}</span>
              </li>
              <li v-if="!resourceRefs(ex).length" class="muted">none</li>
            </ul>
          </div>

          <div class="fld" v-if="ex.spec.permissionClaims?.length">
            <label
              >Permission claims
              <span class="count">{{ ex.spec.permissionClaims.length }}</span></label
            >
            <div class="claimlist">
              <div
                v-for="(c, i) in ex.spec.permissionClaims"
                :key="i"
                class="claim"
              >
                <span class="cres">
                  <span class="rname">{{ c.resource }}</span
                  ><span v-if="c.group" class="rgroup">.{{ c.group }}</span>
                </span>
                <VerbBadges :verbs="c.verbs" />
              </div>
            </div>
          </div>

          <div class="fld">
            <label>Virtual workspace URLs</label>
            <div class="urllist">
              <CopyField
                v-for="u in urlsFor(ex.metadata.name)"
                :key="u"
                :value="u"
                :href="u"
              />
              <p v-if="!urlsFor(ex.metadata.name).length" class="muted small">
                no endpoint slice URLs yet
              </p>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
h2 {
  margin: 0;
  font-size: 1.2rem;
}
.ws {
  color: #90a4ae;
  font-weight: 400;
  font-size: 0.9rem;
}
button {
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid #cfd8dc;
  padding: 0.4rem 0.8rem;
  background: #fafafa;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.row {
  border: 1px solid #eceff1;
  border-radius: 8px;
  margin-bottom: 0.5rem;
  background: #fff;
  overflow: hidden;
}
.summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
  cursor: pointer;
}
.summary:hover {
  background: #fafbfc;
}
.expand {
  color: #90a4ae;
  width: 1rem;
}
.name {
  font-size: 0.95rem;
}
.meta {
  color: #78909c;
  font-size: 0.8rem;
}

/* detail */
.detail {
  padding: 0.4rem 1rem 1rem 2.1rem;
  border-top: 1px solid #f0f0f0;
  background: #fcfdfd;
}
.fld {
  margin: 1rem 0 0;
}
label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #90a4ae;
  font-weight: 700;
  margin-bottom: 0.4rem;
}
.count {
  background: #eceff1;
  color: #607d8b;
  border-radius: 999px;
  padding: 0 0.4rem;
  font-size: 0.7rem;
  letter-spacing: 0;
}

/* resources */
.reslist {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.reslist li {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
}
.rname {
  color: #263238;
  font-weight: 600;
}
.rgroup {
  color: #90a4ae;
}

/* claims */
.claimlist {
  border: 1px solid #eceff1;
  border-radius: 8px;
  overflow: hidden;
}
.claim {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.45rem 0.7rem;
  border-bottom: 1px solid #f2f4f5;
}
.claim:last-child {
  border-bottom: none;
}
.claim:nth-child(even) {
  background: #fafbfc;
}
.cres {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
  min-width: 0;
  word-break: break-all;
}

/* urls */
.urllist {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.error {
  color: #b71c1c;
  background: #fdecea;
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
}
.muted {
  color: #78909c;
}
.small {
  font-size: 0.82rem;
  margin: 0;
}
code {
  background: #f5f7f8;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  font-size: 0.85rem;
}
</style>
