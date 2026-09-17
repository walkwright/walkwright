import { walkTest as test } from "./fixtures.ts";

test("settings", async ({ pages, record }) => {
  await pages.settingsPage.goto({});
  const settings = await record(pages.settingsPage);

  await settings.saveProfile("Wanda Walker");
  await record(pages.settingsPage, "saved");

  await settings.elements.resetDataDialog.open();
  await record("confirm-reset", settings.elements.resetDataDialog);
});
