import { menu } from "walkwright/aria";
import type { LazyLocator } from "walkwright/locator";
import {
  banner,
  button,
  css,
  link,
  list,
  listitem,
  main,
  navigation,
  role,
  text,
  textbox,
} from "walkwright/locator";
import { defineComponent } from "walkwright/pom";

export const emptyState = text(/^No .+ yet\.$/);

const moreMenu = menu("More");

export const topbar = defineComponent({
  root: banner(),
  elements: {
    nav: defineComponent({
      root: navigation(),
      elements: { link },
    }),
    signOutButton: button("sign out"),
    moreButton: button("More"),
    moreMenu: {
      overlay: moreMenu,
      async open(): Promise<void> {
        await this.elements.moreButton.click();
        await this.elements.moreMenu.waitFor();
      },
    },
  },
  actions: {
    async goTo(target: string): Promise<void> {
      await this.elements.nav.elements.link(target).click();
    },
  },
});

export const pageChrome = defineComponent({
  elements: { topbar },
  actions: {
    async signOut(): Promise<void> {
      await this.elements.topbar.elements.signOutButton.click();
    },
  },
});

export const itemRow = defineComponent({
  elements: {
    titleLink: role("link"),
    kindTag: css(".kind"),
    deleteButton: button("Delete"),
  },
  actions: {
    async remove(): Promise<void> {
      await this.elements.deleteButton.click();
    },
  },
});

export const overviewCard = defineComponent((title: string) => ({
  root: listitem().filter({ hasText: title }),
  elements: {
    stat: css(".stat"),
    cardLink: role("link"),
  },
  capture: {
    rules: [{ element: "stat", text: "42" }],
  },
  actions: {
    async readStat(): Promise<string> {
      const value = await this.elements.stat.textContent();

      if (value === null) {
        throw new Error(`the "${title}" card has no stat`);
      }

      return value;
    },
  },
}));

export const noteEditor = defineComponent({
  root: main(),
  elements: {
    noteTextbox: textbox("Note"),
    addButton: button("Add note"),
    notes: list("Notes"),
    noteRow: (text: string): LazyLocator =>
      listitem().filter({ hasText: text }),
  },
  actions: {
    async add(text: string): Promise<void> {
      await this.elements.noteTextbox.fill(text);
      await this.elements.addButton.click();
      await this.elements.noteRow(text).waitFor();
    },
    async remove(text: string): Promise<void> {
      await this.elements
        .noteRow(text)
        .getByRole("button", { name: "Delete" })
        .click();
      await this.elements.noteRow(text).waitFor({ state: "hidden" });
    },
  },
});
