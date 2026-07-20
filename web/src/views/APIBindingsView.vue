<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import {
  listAPIBindings,
  deleteAPIBinding,
  createAPIBinding,
  getAPIExport,
} from "../api/apis";
import type {
  APIBinding,
  AcceptablePermissionClaim,
  PermissionClaim,
} from "../types/apis";
import { ApiError } from "../api/client";
import PhaseBadge from "../components/PhaseBadge.vue";
import VerbBadges from "../components/VerbBadges.vue";
import CopyField from "../components/CopyField.vue";

const wsStore = useWorkspaceStore();
const { current } = storeToRefs(wsStore);

const items = ref<APIBinding[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const expanded = ref<string | null>(null);

// create form state
const showCreate = ref(false);
const bName = ref("");
const exPath = ref("");
const exName = ref("");
const loadedClaims = ref<{ claim: PermissionClaim; accept: boolean }[]>([]);
const claimsLoaded = ref(false);
const busy = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const list = await listAPIBindings(current.value);
    items.value = list.items ?? [];
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function toggle(name: string) {
  expanded.value = expanded.value === name ? null : name;
}

async function remove(b: APIBinding) {
  if (!confirm(`Delete APIBinding "${b.metadata.name}"?`)) return;
  try {
    await deleteAPIBinding(current.value, b.metadata.name);
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  }
}

// Fetch the referenced export (at exPath) to surface its permission claims for
// accept/reject before binding.
async function loadClaims() {
  if (!exName.value) return;
  busy.value = true;
  error.value = null;
  try {
    const ex = await getAPIExport(exPath.value || current.value, exName.value);
    loadedClaims.value = (ex.spec.permissionClaims ?? []).map((c) => ({
      claim: c,
      accept: true,
    }));
    claimsLoaded.value = true;
    if (!bName.value) bName.value = exName.value;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function create() {
  if (!bName.value || !exName.value) return;
  busy.value = true;
  error.value = null;
  try {
    const claims: AcceptablePermissionClaim[] = loadedClaims.value.map((c) => ({
      ...c.claim,
      state: c.accept ? "Accepted" : "Rejected",
      selector: { matchAll: true },
    }));
    await createAPIBinding(
      current.value,
      bName.value,
      { path: exPath.value || undefined, name: exName.value },
      claims,
    );
    resetForm();
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function resetForm() {
  showCreate.value = false;
  bName.value = "";
  exPath.value = "";
  exName.value = "";
  loadedClaims.value = [];
  claimsLoaded.value = false;
}

function exportRefLabel(b: APIBinding): string {
  const e = b.spec.reference.export;
  if (!e) return "—";
  return e.path ? `${e.path} / ${e.name}` : e.name;
}

const gr = (group?: string, resource?: string) =>
  group ? `${resource}.${group}` : (resource ?? "");

onMounted(load);
watch(current, () => {
  resetForm();
  expanded.value = null;
  load();
});
</script>

<template>
  <section>
    <div class="head">
      <h2>APIBindings <span class="ws">in {{ current }}</span></h2>
      <div>
        <button @click="showCreate = !showCreate">
          {{ showCreate ? "Cancel" : "New binding" }}
        </button>
        <button @click="load" :disabled="loading">Refresh</button>
      </div>
    </div>

    <div v-if="showCreate" class="createbox">
      <div class="crow">
        <input
          v-model="exPath"
          placeholder="export workspace path (e.g. root:providers)"
        />
        <input v-model="exName" placeholder="export name" />
        <button @click="loadClaims" :disabled="busy || !exName">
          Load claims
        </button>
      </div>
      <div class="crow" v-if="claimsLoaded">
        <input v-model="bName" placeholder="binding name" />
      </div>

      <div v-if="claimsLoaded && loadedClaims.length" class="claims">
        <label>Accept permission claims</label>
        <div class="claimlist">
          <div v-for="(c, i) in loadedClaims" :key="i" class="claim editable">
            <label class="chk">
              <input type="checkbox" v-model="c.accept" />
              <span class="cres">{{ gr(c.claim.group, c.claim.resource) }}</span>
            </label>
            <VerbBadges :verbs="c.claim.verbs" />
            <span class="state" :class="c.accept ? 'accepted' : 'rejected'">{{
              c.accept ? "Accepted" : "Rejected"
            }}</span>
          </div>
        </div>
      </div>
      <p v-else-if="claimsLoaded" class="muted">
        Export declares no permission claims.
      </p>

      <div class="crow" v-if="claimsLoaded">
        <button class="primary" @click="create" :disabled="busy || !bName">
          {{ busy ? "Creating…" : "Create binding" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="!items.length && !error" class="muted">
      No APIBindings in <code>{{ current }}</code>.
    </p>

    <ul class="list" v-if="items.length">
      <li v-for="b in items" :key="b.metadata.name" class="row">
        <div class="summary" @click="toggle(b.metadata.name)">
          <span class="expand">{{
            expanded === b.metadata.name ? "▾" : "▸"
          }}</span>
          <strong class="name">{{ b.metadata.name }}</strong>
          <PhaseBadge :phase="b.status?.phase || 'Unknown'" />
          <span class="meta arrow">→ {{ exportRefLabel(b) }}</span>
          <span class="meta">{{
            b.status?.boundResources?.length || 0
          }} bound</span>
          <button class="danger" @click.stop="remove(b)">Delete</button>
        </div>

        <div class="detail" v-if="expanded === b.metadata.name">
          <div class="fld">
            <label>Export</label>
            <CopyField :value="exportRefLabel(b)" />
          </div>

          <div class="fld">
            <label
              >Bound resources
              <span class="count">{{
                b.status?.boundResources?.length || 0
              }}</span></label
            >
            <ul class="reslist" v-if="b.status?.boundResources?.length">
              <li v-for="r in b.status.boundResources" :key="r.group + r.resource">
                <span class="rname">{{ r.resource }}</span
                ><span v-if="r.group" class="rgroup">.{{ r.group }}</span>
              </li>
            </ul>
            <p v-else class="muted small">none bound yet</p>
          </div>

          <div class="fld" v-if="b.spec.permissionClaims?.length">
            <label
              >Permission claims
              <span class="count">{{
                b.spec.permissionClaims.length
              }}</span></label
            >
            <div class="claimlist">
              <div v-for="(c, i) in b.spec.permissionClaims" :key="i" class="claim">
                <span class="cres">{{ gr(c.group, c.resource) }}</span>
                <VerbBadges :verbs="c.verbs" />
                <span
                  class="state"
                  :class="c.state === 'Accepted' ? 'accepted' : 'rejected'"
                  >{{ c.state }}</span
                >
              </div>
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
  margin-left: 0.4rem;
}
.primary {
  background: #1565c0;
  color: #fff;
  border-color: #1565c0;
}
.danger {
  color: #b71c1c;
  border-color: #f5c6c2;
  margin-left: auto;
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
}

/* create box */
.createbox {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fafafa;
}
.crow {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}
input {
  padding: 0.4rem 0.6rem;
  border: 1px solid #cfd8dc;
  border-radius: 6px;
  min-width: 220px;
}
.claims {
  margin: 0.5rem 0;
}

/* list */
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
.arrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
  gap: 0.75rem;
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
  word-break: break-all;
  flex: 1;
  min-width: 0;
}
.chk {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  color: inherit;
  margin: 0;
}
.state {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.08rem 0.45rem;
  border-radius: 4px;
  flex: none;
}
.state.accepted {
  background: #e9f7ef;
  color: #1e7e46;
}
.state.rejected {
  background: #fdecea;
  color: #c0392b;
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
