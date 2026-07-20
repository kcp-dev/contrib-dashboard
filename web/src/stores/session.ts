import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api/client";

export interface SessionInfo {
  authMode: "none" | "oidc";
  authenticated: boolean;
  user: { username: string; groups: string[]; email?: string } | null;
  note?: string;
}

export const useSessionStore = defineStore("session", () => {
  const info = ref<SessionInfo | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      info.value = await api.get<SessionInfo>("/api/session");
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  // Full-page redirect into the BFF's OIDC login (leaves the SPA origin).
  function login() {
    window.location.href = "/auth/login";
  }

  async function logout() {
    await api.post("/auth/logout", {});
    await load();
  }

  return { info, loading, error, load, login, logout };
});
