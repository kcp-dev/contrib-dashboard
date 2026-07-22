<script setup lang="ts">
import { onMounted, computed } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "./stores/session";
import { useWorkspaceStore } from "./stores/workspace";
import WorkspaceTree from "./components/WorkspaceTree.vue";

const session = useSessionStore();
const { info, loading } = storeToRefs(session);

const wsStore = useWorkspaceStore();
const { current } = storeToRefs(wsStore);

// In oidc mode, block the app until the user has signed in.
const needsLogin = computed(
  () => info.value?.authMode === "oidc" && !info.value.authenticated,
);
const isOidc = computed(() => info.value?.authMode === "oidc");

onMounted(session.load);
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <img class="logo" src="/kcp-icon.svg" alt="kcp" />
        <span class="brandtext"><b>kcp</b> dashboard</span>
      </div>
      <div class="identity" v-if="info">
        <span v-if="info.authMode === 'none'" class="mode-none">
          no-oidc &middot; {{ info.user?.username }}
        </span>
        <span v-else class="mode-oidc">
          {{ info.authenticated ? info.user?.username : "not signed in" }}
        </span>
        <button
          v-if="isOidc && info.authenticated"
          class="logout"
          @click="session.logout"
        >
          Sign out
        </button>
      </div>
    </header>

    <!-- OIDC login gate -->
    <div v-if="needsLogin" class="login">
      <div class="card">
        <h1>kcp dashboard</h1>
        <p class="muted">Sign in with your identity provider to continue.</p>
        <button class="primary" @click="session.login">Sign in</button>
      </div>
    </div>

    <div v-else-if="!loading || info" class="layout">
      <WorkspaceTree />

      <div class="panel">
        <nav class="tabs">
          <div class="tablinks">
            <RouterLink to="/explore">Explore</RouterLink>
            <RouterLink to="/apiexports">APIExports</RouterLink>
            <RouterLink to="/apibindings">APIBindings</RouterLink>
          </div>
          <div class="wsctx" title="active workspace context">
            <span class="wsctx-label">workspace</span>
            <code>{{ current }}</code>
          </div>
        </nav>

        <main class="content">
          <RouterView />
        </main>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #263238;
}
body {
  margin: 0;
  background: #f5f7f8;
  /* Prevent the whole page from scrolling — each panel scrolls independently */
  overflow: hidden;
  height: 100vh;
}
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.9rem 1.5rem;
  background: #263238;
  color: #fff;
  height: 56px;
  box-sizing: border-box;
  flex: none;
}
.layout {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: stretch;
  overflow: hidden;
}
.panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.logo {
  height: 28px;
  width: auto;
  display: block;
}
.brandtext {
  font-size: 1.15rem;
  color: #90a4ae;
  letter-spacing: 0.01em;
}
.brandtext b {
  color: #fff;
  font-weight: 700;
}
.identity {
  font-size: 0.85rem;
}
.mode-none {
  color: #ffcc80;
}
.identity {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.logout {
  background: transparent;
  color: #cfd8dc;
  border: 1px solid #546e7a;
  border-radius: 6px;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  font-size: 0.75rem;
}
.logout:hover {
  color: #fff;
  border-color: #90a4ae;
}
.login {
  display: flex;
  justify-content: center;
  padding: 4rem 1.5rem;
}
.login .card {
  background: #fff;
  border: 1px solid #eceff1;
  border-radius: 12px;
  padding: 2.5rem 3rem;
  text-align: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.login h1 {
  margin: 0 0 0.5rem;
}
.login .muted {
  color: #78909c;
  margin-bottom: 1.5rem;
}
.login .primary {
  background: #1565c0;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 0.6rem 1.8rem;
  font-size: 1rem;
  cursor: pointer;
}
.tabs {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.5rem;
  background: #fff;
  border-bottom: 1px solid #eceff1;
  flex: none;
}
.tablinks {
  display: flex;
  gap: 1rem;
}
.tabs a {
  text-decoration: none;
  color: #546e7a;
  font-weight: 600;
}
.tabs a.router-link-active {
  color: #1565c0;
}
.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
}
.wsctx {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}
.wsctx-label {
  color: #90a4ae;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.7rem;
}
.wsctx code {
  background: #eceff1;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}
</style>
