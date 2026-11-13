/**
 * Zen mode is session state, not a setting: it is never saved, so the app always starts with
 * its chrome showing. One small store per workbench.
 */
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Workbench } from "./workbench";

interface ZenState {
  zen: boolean;
}

const stores = new WeakMap<Workbench, StoreApi<ZenState>>();

export function zenStore(workbench: Workbench): StoreApi<ZenState> {
  let store = stores.get(workbench);
  if (!store) {
    store = createStore<ZenState>()(() => ({ zen: false }));
    stores.set(workbench, store);
  }
  return store;
}

export function isZenMode(workbench: Workbench): boolean {
  return zenStore(workbench).getState().zen;
}

export function setZenMode(workbench: Workbench, zen: boolean): void {
  zenStore(workbench).setState({ zen });
}

/** Whether zen mode is on; re-renders when it changes. */
export function useZenMode(workbench: Workbench): boolean {
  return useStore(zenStore(workbench), (s) => s.zen);
}
