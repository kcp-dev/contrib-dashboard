import { ref } from "vue";

export type PollState = "idle" | "polling" | "timeout";

interface PollOptions {
  interval?: number;  // ms between attempts (default 1500)
  timeout?: number;   // ms before giving up (default 15000)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function usePoller<T>(
  fetch: () => Promise<T>,
  done: (result: T) => boolean,
  opts: PollOptions = {},
) {
  const interval = opts.interval ?? 1500;
  const timeout  = opts.timeout  ?? 15_000;

  const state = ref<PollState>("idle");
  let active = false;

  function stop() { active = false; }
  function reset() { active = false; state.value = "idle"; }

  /** Runs the polling loop to completion — resolves when done, timed out, or stopped. */
  async function poll(): Promise<void> {
    active = true;
    state.value = "polling";
    const deadline = Date.now() + timeout;

    while (active) {
      try {
        const result = await fetch();
        if (done(result)) {
          state.value = "idle";
          active = false;
          return;
        }
      } catch { /* keep trying on fetch errors */ }

      if (Date.now() >= deadline) {
        state.value = "timeout";
        active = false;
        return;
      }

      await sleep(interval);
    }
    // Stopped externally — treat as idle
    if (state.value === "polling") state.value = "idle";
  }

  return { state, poll, reset, stop };
}
