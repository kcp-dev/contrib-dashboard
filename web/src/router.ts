import { createRouter, createWebHistory } from "vue-router";
import APIExportsView from "./views/APIExportsView.vue";
import APIBindingsView from "./views/APIBindingsView.vue";
import ExploreView from "./views/ExploreView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/explore" },
    // Legacy path; workspace create/list now lives in the sidebar.
    { path: "/workspaces", redirect: "/explore" },
    { path: "/explore", name: "explore", component: ExploreView },
    { path: "/apiexports", name: "apiexports", component: APIExportsView },
    { path: "/apibindings", name: "apibindings", component: APIBindingsView },
  ],
});
