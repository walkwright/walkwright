import type { Locator, Page } from "@playwright/test";
import {
  button,
  css,
  label,
  link,
  list,
  listitem,
  text,
  textbox,
} from "walkwright/locator";
import type { ElementMap } from "walkwright/pom";
import {
  defineApp,
  defineComponent,
  defineDialog,
  definePage,
  waitForHydration,
} from "walkwright/pom";

import {
  emptyState,
  itemRow,
  noteEditor,
  overviewCard,
  pageChrome,
  topbar,
} from "./components.ts";

declare module "walkwright/pom" {
  interface Register {
    app: typeof app;
  }
}

async function appReady(page: Page): Promise<void> {
  await waitForHydration(page);
  await page.locator("p.loading").waitFor({ state: "hidden" });
}

const newItemDialog = defineDialog({
  name: "New item",
  elements: {
    nameTextbox: textbox("Name"),
    kind: label("Kind"),
    createButton: button("Create"),
  },
  actions: {
    async create(item: {
      name: string;
      kind: "gadget" | "consumable" | "tool";
    }): Promise<void> {
      await this.elements.nameTextbox.fill(item.name);
      await this.elements.kind.selectOption(item.kind);
      await this.elements.createButton.click();
      await this.root.waitFor({ state: "hidden" });
    },
  },
});

const confirmDialog = defineDialog(
  (def: { name: string | RegExp; label: string; confirmLabel: string }) => ({
    role: "alertdialog" as const,
    name: def.name,
    recorder: { label: def.label },
    close: { button: button("Cancel") },
    elements: {
      confirmButton: button(def.confirmLabel),
    },
    actions: {
      async confirm(): Promise<void> {
        await this.elements.confirmButton.click();
        await this.root.waitFor({ state: "hidden" });
      },
    },
  }),
);

const deleteItemDialog = confirmDialog({
  name: /^Delete .+\?$/,
  label: "Delete item",
  confirmLabel: "Delete",
});

const resetDataDialog = confirmDialog({
  name: "Reset data",
  label: "Reset data",
  confirmLabel: "Reset",
});

const loginPage = definePage({
  path: "/login",
  name: "login",
  ready: { selector: "form" },
  header: "Sign in",
  elements: {
    email: label("Email"),
    password: label("Password"),
    submit: button("Sign in"),
  },
  actions: {
    async signIn(account: { email: string; password: string }): Promise<void> {
      await this.elements.email.fill(account.email);
      await this.elements.password.fill(account.password);
      await this.elements.submit.click();
    },
  },
});

const dashboardPage = definePage({
  path: "/",
  name: "dashboard",
  header: "Dashboard",
  include: [pageChrome],
  elements: {
    overview: list("Overview"),
    card: overviewCard,
  },
  capture: {
    rules: [
      { element: "overview", match: /^\d+$/, text: "42" },
    ],
  },
});

const itemsPath = "/items";
const topbarChrome = defineComponent({ elements: { topbar } });

const itemChrome = defineComponent({
  elements: {
    back: link("Back to items"),
    sectionTab: link,
  },
});

const itemsAreaPage = definePage.preset({
  path: itemsPath,
  include: [topbarChrome],
  recorder: { group: ["items"] },
});

const itemAreaPage = itemsAreaPage.preset({
  path: "/:id",
  include: [itemChrome],
});

const itemPage = itemAreaPage({
  path: "",
  name: "item",
  header: "Details",
  elements: {
    details: css("dl"),
  },
});

const itemTabPage = itemAreaPage(
  (def: {
    name: string;
    path: "/notes" | "/history";
    header: "Notes" | "History";
  }) => ({
    name: def.name,
    path: def.path,
    header: def.header,
    elements: {
      entries: list(def.header),
      editor: noteEditor,
      empty: emptyState,
    },
    actions: {
      async readEntries(): Promise<string[]> {
        const texts = await this.elements.entries
          .getByRole("listitem")
          .allTextContents();

        if (texts.length === 0) {
          throw new Error(`the ${def.name} tab has no entries`);
        }

        return texts;
      },
    },
  }),
);

const itemNotesPage = itemTabPage({
  name: "notes",
  path: "/notes",
  header: "Notes",
});

const itemHistoryPage = itemTabPage({
  name: "history",
  path: "/history",
  header: "History",
});

const itemsPage = itemsAreaPage({
  path: "",
  name: "items",
  header: "Items",
  elements: {
    newItem: button("New item"),
    list: list("Items"),
    empty: emptyState,
    row: (name: string) => itemRow(listitem().filter({ hasText: name })),
    newItemDialog: {
      overlay: newItemDialog,
      async open(): Promise<void> {
        await this.elements.newItem.click();
        await this.elements.newItemDialog.waitFor();
      },
    },
    deleteItemDialog,
  },
  anchor: list("Items").or(text(/^No .+ yet\.$/)),
  actions: {
    deleteButtonFor(name: string): Locator {
      return this.elements.row(name).elements.deleteButton;
    },
    async openItem(name: string) {
      await this.elements.row(name).elements.titleLink.click();
      const detail = this.pages.itemPage;
      await detail.waitFor();
      return detail;
    },
  },
});

const profileForm = {
  displayName: textbox("Display name"),
  theme: label("Theme"),
  save: button("Save"),
} satisfies ElementMap;

const settingsPage = definePage({
  path: "/settings",
  name: "settings",
  header: "Settings",
  include: [pageChrome],
  elements: {
    ...profileForm,
    reset: button("Reset data"),
    resetDataDialog: {
      overlay: resetDataDialog,
      async open(): Promise<void> {
        await this.elements.reset.click();
        await this.elements.resetDataDialog.waitFor();
      },
    },
  },
  actions: {
    async saveProfile(displayName: string): Promise<void> {
      await this.elements.displayName.fill(displayName);
      await this.elements.save.click();
    },
  },
});

export const app = defineApp({
  ready: appReady,
  pages: {
    loginPage,
    dashboardPage,
    itemsPage,
    itemPage,
    itemNotesPage,
    itemHistoryPage,
    settingsPage,
  },
  capture: {
    rules: [{ match: /\bi\d+\b/g, text: "<id>" }],
  },
});
