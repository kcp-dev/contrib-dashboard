import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";

async function boot() {
  if (import.meta.env.VITE_DEMO === "true") {
    const { worker } = await import("./mocks/browser");
    await worker.start({
      onUnhandledRequest: "bypass",
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    });
    console.info("[demo] MSW mock service worker active");
  }

  createApp(App).use(createPinia()).use(router).mount("#app");
}

boot();
