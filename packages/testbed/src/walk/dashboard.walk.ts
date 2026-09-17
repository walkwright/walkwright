import { walkTest as test } from "./fixtures.ts";

test("dashboard", async ({ pages, record, provision }) => {
  await provision.note();

  const dashboard = await record(pages.dashboardPage, {}, "stocked");

  const stat = await dashboard.elements.card("items in stock").readStat();
  if (stat === "0") {
    throw new Error("the shared item should be counted on the dashboard");
  }

  await record(undefined, { group: ["chrome"], page: "topbar" });

  await dashboard.elements.topbar.elements.moreMenu.open();
  await record("more-menu", dashboard.elements.topbar.elements.moreMenu);

  await dashboard.elements.topbar.goTo("items");
  await pages.itemsPage.waitFor();
  await record("via-topbar");

  await dashboard.elements.topbar.elements.moreMenu.choose("Settings");
  await pages.settingsPage.waitFor();

  await dashboard.signOut();
  await pages.loginPage.waitFor();
  await record(pages.loginPage, "signed-out");

  await pages.loginPage.signIn(await provision.account());
});
