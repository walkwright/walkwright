import { session, walkSetup as setup } from "./fixtures.ts";

setup("walk account", async ({ page, pages, record, provision }) => {
  const login = await record(pages.loginPage, {});
  await login.signIn(await provision.account());

  await pages.dashboardPage.waitFor();
  await record(pages.dashboardPage);

  await session.save(page.context());
});
