import {
  createPersistentProvision,
  createProvision,
} from "walkwright/provisioner";
import { z } from "zod";

import { app } from "./pom.ts";

export interface ItemParams {
  name: string;
  kind: "gadget" | "consumable" | "tool";
}

export interface ProvisionedItem {
  id: string;
  name: string;
}

export interface NoteParams {
  itemId: string;
  text: string;
}

export const item = createProvision(
  "item",
  async (page, input: ItemParams | undefined): Promise<ProvisionedItem> => {
    const params = input ?? { name: "Shop stool", kind: "tool" };

    const list = app.pages.itemsPage(page);
    await list.goto({});

    await list.elements.newItemDialog.open();
    await list.elements.newItemDialog.create(params);

    const detail = await list.openItem(params.name);
    const { id } = detail.params();

    return { id, name: params.name };
  },
  async (page, item): Promise<void> => {
    const list = app.pages.itemsPage(page);
    await list.goto({});
    await list.deleteButtonFor(item.name).click();

    await list.elements.deleteItemDialog.waitFor();
    await list.elements.deleteItemDialog.confirm();
  },
);

export const note = createProvision(
  "note",
  async (page, input: NoteParams | undefined, use): Promise<NoteParams> => {
    const note = input ?? {
      itemId: (await use(item)).id,
      text: "left by the walk",
    };

    const notes = app.pages.itemNotesPage(page);
    await notes.goto({ id: note.itemId });
    await notes.elements.editor.add(note.text);

    return note;
  },
  async (page, note): Promise<void> => {
    const notes = app.pages.itemNotesPage(page);
    await notes.goto({ id: note.itemId });
    await notes.elements.editor.remove(note.text);
  },
);

const walkAccount = z.object({ email: z.string(), password: z.string() });

export type WalkAccount = z.infer<typeof walkAccount>;

export const account = createPersistentProvision(
  "account",
  walkAccount,
  async (_page, input: WalkAccount | undefined): Promise<WalkAccount> =>
    await Promise.resolve(
      input ?? {
        email: "walker@example.test",
        password: "walk-around-the-shop",
      },
    ),
);
