import { walkTest as test } from "./fixtures.ts";

test("items", async ({ pages, record, provision }) => {
  const empty = await record(pages.itemsPage, {}, "empty");
  await empty.elements.newItemDialog.open();
  await record(empty.elements.newItemDialog);

  const grinder = await provision.item({
    name: "Coffee grinder",
    kind: "gadget",
  });
  await provision.item({ name: "Field notebook", kind: "consumable" });

  const list = await record(pages.itemsPage, {}, "filled");
  await list.deleteButtonFor("Field notebook").click();
  await record("delete-item", list.elements.deleteItemDialog);

  const detail = await record(await list.openItem("Coffee grinder"));
  await detail.elements.back.waitFor();

  await record(pages.itemNotesPage, { id: grinder.id }, "empty");
  await provision.note({ itemId: grinder.id, text: "needs a new burr" });
  await record(pages.itemNotesPage, { id: grinder.id }, "filled", {
    viewport: { height: 900 },
  });
  await record(pages.itemHistoryPage, { id: grinder.id });
});
