import { createRouter, createWebHistory } from "vue-router";
import APIExportsView from "./views/APIExportsView.vue";
import APIBindingsView from "./views/APIBindingsView.vue";
import ExploreView from "./views/ExploreView.vue";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", redirect: "/explore" },
    { path: "/workspaces", redirect: "/explore" },
    { path: "/explore", name: "explore", component: ExploreView },
    { path: "/apiexports", name: "apiexports", component: APIExportsView },
    { path: "/apibindings", name: "apibindings", component: APIBindingsView },
  ],
});
