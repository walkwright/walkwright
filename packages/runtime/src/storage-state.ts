import type { BrowserContext, BrowserContextOptions } from "@playwright/test";

import type { StoreScope } from "./paths.js";
import { createStore } from "./store.js";

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type StorageStateCookie = StorageState["cookies"][number];

export type StorageStateOption = NonNullable<
  BrowserContextOptions["storageState"]
>;

export interface StorageStateStoreOptions {
  scope?: StoreScope;
  cookies?: (cookie: StorageStateCookie) => boolean;
}

export interface StorageStateStore {
  readonly path: string;
  exists: () => boolean;
  save: (context: BrowserContext) => Promise<void>;
  restore: (context: BrowserContext) => Promise<void>;
  clear: () => void;
}

export const emptyStorageState: StorageStateOption = {
  cookies: [],
  origins: [],
};

export function createStorageStateStore(
  name: string,
  { scope = "worker", cookies }: StorageStateStoreOptions = {},
): StorageStateStore {
  const store = createStore<StorageState>(name, { scope });

  return {
    get path(): string {
      return store.path;
    },

    exists: store.exists,

    save: async (context): Promise<void> => {
      const state = await context.storageState();

      store.persist(
        cookies === undefined
          ? state
          : { cookies: state.cookies.filter(cookies), origins: [] },
      );
    },

    restore: async (context): Promise<void> => {
      const state = store.read();

      if (state !== undefined && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
      }
    },

    clear: store.clear,
  };
}

export function storageStateOf(
  ...stores: StorageStateStore[]
): StorageStateOption {
  return stores.find((store) => store.exists())?.path ?? emptyStorageState;
}
