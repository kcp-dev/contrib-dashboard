<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import yaml from "js-yaml";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import {
  discoverResources,
  listObjects,
  type APIResourceInfo,
  type GenericObject,
  type ResourceOrigin,
} from "../api/discovery";
import { ApiError } from "../api/client";

const wsStore = useWorkspaceStore();
const { current } = storeToRefs(wsStore);

const resources = ref<APIResourceInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const filter = ref("");
const ORIGINS: ResourceOrigin[] = ["native", "kcp", "crd", "apibinding"];
const activeOrigins = ref<Set<ResourceOrigin>>(new Set(ORIGINS));

const selected = ref<APIResourceInfo | null>(null);
const objects = ref<GenericObject[]>([]);
const objLoading = ref(false);
const objError = ref<string | null>(null);

const detail = ref<GenericObject | null>(null);

async function loadTypes() {
  loading.value = true;
  error.value = null;
  selected.value = null;
  objects.value = [];
  try {
    resources.value = await discoverResources(current.value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    resources.value = [];
  } finally {
    loading.value = false;
  }
}

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return resources.value.filter((r) => {
    if (!activeOrigins.value.has(r.origin)) return false;
    if (!q) return true;
    return (
      r.kind.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.group.toLowerCase().includes(q)
    );
  });
});

function toggleOrigin(o: ResourceOrigin) {
  const s = new Set(activeOrigins.value);
  if (s.has(o)) s.delete(o);
  else s.add(o);
  activeOrigins.value = s;
}

async function select(res: APIResourceInfo) {
  selected.value = res;
  objLoading.value = true;
  objError.value = null;
  objects.value = [];
  try {
    const list = await listObjects(current.value, res);
    objects.value = list.items ?? [];
  } catch (e) {
    objError.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    objLoading.value = false;
  }
}

function age(ts?: string): string {
  if (!ts) return "";
  const d = Date.now() - new Date(ts).getTime();
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const format = ref<"yaml" | "json">("yaml");

const detailText = computed(() => {
  if (!detail.value) return "";
  if (format.value === "json") return JSON.stringify(detail.value, null, 2);
  try {
    return yaml.dump(detail.value, { noRefs: true, sortKeys: false, lineWidth: -1 });
  } catch {
    return JSON.stringify(detail.value, null, 2);
  }
});

function copyDetail() {
  navigator.clipboard?.writeText(detailText.value).catch(() => {});
}

onMounted(loadTypes);
watch(current, loadTypes);
</script>

<template>
  <section>
    <div class="head">
      <h2>Explore <span class="ws">in {{ current }}</span></h2>
      <button @click="loadTypes" :disabled="loading">Refresh</button>
    </div>

    <div class="filters">
      <input v-model="filter" class="search" placeholder="filter types…" />
      <div class="chips">
        <button
          v-for="o in ORIGINS"
          :key="o"
          class="chip"
          :class="[o, { off: !activeOrigins.has(o) }]"
          @click="toggleOrigin(o)"
        >
          {{ o }}
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Discovering resource types…</p>

    <div v-else class="explorer">
      <!-- resource types -->
      <div class="types">
        <div
          v-for="r in filtered"
          :key="r.groupVersion + '/' + r.name"
          class="type"
          :class="{ active: selected === r }"
          @click="select(r)"
        >
          <span class="badge" :class="r.origin">{{ r.origin }}</span>
          <div class="type-main">
            <span class="kind">{{ r.kind }}</span>
            <span class="gv">{{ r.group || "core" }}/{{ r.version }}</span>
          </div>
          <span class="scope" :title="r.namespaced ? 'namespaced' : 'cluster'">{{
            r.namespaced ? "ns" : "cl"
          }}</span>
        </div>
        <p v-if="!filtered.length" class="muted pad">no matching types</p>
      </div>

      <!-- objects of the selected type -->
      <div class="objects">
        <p v-if="!selected" class="muted pad">
          Select a resource type to list its objects.
        </p>
        <template v-else>
          <div class="obj-head">
            <strong>{{ selected.kind }}</strong>
            <span class="muted">{{ objects.length }} object(s)</span>
          </div>
          <p v-if="objError" class="error">{{ objError }}</p>
          <p v-if="objLoading" class="muted pad">Loading…</p>
          <table v-else-if="objects.length" class="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th v-if="selected.namespaced">Namespace</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="o in objects"
                :key="(o.metadata.namespace || '') + '/' + o.metadata.name"
                @click="detail = o"
              >
                <td class="link">{{ o.metadata.name }}</td>
                <td v-if="selected.namespaced">{{ o.metadata.namespace || "—" }}</td>
                <td>{{ age(o.metadata.creationTimestamp) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="!objError" class="muted pad">no objects</p>
        </template>
      </div>
    </div>

    <!-- object detail drawer -->
    <div v-if="detail" class="drawer-backdrop" @click.self="detail = null">
      <div class="drawer">
        <div class="drawer-head">
          <div>
            <strong>{{ detail.kind || selected?.kind }}</strong>
            <span class="muted"> / {{ detail.metadata.name }}</span>
          </div>
          <div class="drawer-actions">
            <div class="fmt">
              <button :class="{ on: format === 'yaml' }" @click="format = 'yaml'">
                YAML
              </button>
              <button :class="{ on: format === 'json' }" @click="format = 'json'">
                JSON
              </button>
            </div>
            <button @click="copyDetail" title="copy">⧉ copy</button>
            <button @click="detail = null" title="close">✕</button>
          </div>
        </div>
        <pre class="json">{{ detailText }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
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
.filters {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.8rem;
  flex-wrap: wrap;
}
.search {
  padding: 0.4rem 0.6rem;
  border: 1px solid #cfd8dc;
  border-radius: 6px;
  min-width: 220px;
}
.chips {
  display: flex;
  gap: 0.35rem;
}
.chip {
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
  cursor: pointer;
}
.chip.off {
  opacity: 0.4;
}

/* origin colours (shared by chips + badges) */
.native {
  background: #e8f0fe;
  color: #1a56c4;
  border-color: #cddffb;
}
.kcp {
  background: #f3e8fd;
  color: #7b2ec4;
  border-color: #e2ccf7;
}
/* "kcp" is a brand name — always lowercase, never KCP/Kcp. */
.badge.kcp,
.chip.kcp {
  text-transform: none;
}
.crd {
  background: #e9f7ef;
  color: #1e7e46;
  border-color: #c3e9d3;
}
.apibinding {
  background: #fff4e5;
  color: #a15c00;
  border-color: #f5dcb3;
}

.explorer {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.types {
  width: 320px;
  flex: none;
  border: 1px solid #eceff1;
  border-radius: 8px;
  max-height: 70vh;
  overflow-y: auto;
  background: #fff;
}
.type {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid #f2f4f5;
  cursor: pointer;
}
.type:last-child {
  border-bottom: none;
}
.type:hover {
  background: #fafbfc;
}
.type.active {
  background: #e8f0fe;
}
.badge {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  border: 1px solid transparent;
  text-transform: uppercase;
  flex: none;
  width: 68px;
  text-align: center;
}
.type-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.kind {
  font-weight: 600;
  font-size: 0.88rem;
}
.gv {
  font-size: 0.72rem;
  color: #90a4ae;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scope {
  font-size: 0.7rem;
  color: #78909c;
  border: 1px solid #eceff1;
  border-radius: 4px;
  padding: 0 0.3rem;
}
.objects {
  flex: 1;
  min-width: 0;
  border: 1px solid #eceff1;
  border-radius: 8px;
  background: #fff;
  min-height: 200px;
}
.obj-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid #eceff1;
}
.grid {
  width: 100%;
  border-collapse: collapse;
}
.grid th,
.grid td {
  text-align: left;
  padding: 0.45rem 0.8rem;
  border-bottom: 1px solid #f2f4f5;
  font-size: 0.85rem;
}
.grid th {
  color: #607d8b;
  font-weight: 600;
}
.grid tbody tr {
  cursor: pointer;
}
.grid tbody tr:hover {
  background: #fafbfc;
}
.link {
  color: #1565c0;
  font-weight: 600;
}
.pad {
  padding: 1rem;
}
.muted {
  color: #78909c;
}
.error {
  color: #b71c1c;
  background: #fdecea;
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
}

/* drawer */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}
.drawer {
  width: min(680px, 90vw);
  background: #fff;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid #eceff1;
}
.drawer-actions {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.drawer-actions button {
  font-size: 0.8rem;
  padding: 0.3rem 0.6rem;
}
.fmt {
  display: inline-flex;
  border: 1px solid #cfd8dc;
  border-radius: 6px;
  overflow: hidden;
  margin-right: 0.3rem;
}
.fmt button {
  border: none;
  border-radius: 0;
  background: #fff;
  color: #607d8b;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.3rem 0.6rem;
}
.fmt button.on {
  background: #1565c0;
  color: #fff;
}
.json {
  margin: 0;
  padding: 1rem;
  overflow: auto;
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  background: #fbfcfd;
  color: #263238;
}
</style>
