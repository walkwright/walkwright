import { hideStyle } from "walkwright/browser";
import {
  createStorageStateStore,
  emptyStorageState,
  storageStateOf,
} from "walkwright/storage-state";

import { app } from "./pom.ts";
import { account, item, note } from "./provision.ts";

export const session = createStorageStateStore("session", {
  scope: "project",
});

const hidden = hideStyle([".build-stamp"]);

const recording = app.fixture([item, note, account]).extend({
  context: async ({ context }, use) => {
    if (hidden !== undefined) {
      await context.addInitScript({ content: hidden });
    }

    await use(context);
  },
});

export const walkSetup = recording.extend({
  storageState: emptyStorageState,
});

export const walkTest = recording.extend({
  storageState: storageStateOf(session),
});
