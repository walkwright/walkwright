import type { Locator, Page } from "@playwright/test";

export async function visibleWithin(
  locator: Locator,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export async function pollUntil(
  page: Page,
  ready: () => Promise<boolean>,
  options: { timeoutMs?: number; refresh?: () => Promise<void> } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await ready()) {
      return true;
    }

    if (Date.now() >= deadline) {
      return false;
    }

    await page.waitForTimeout(10_000);
    await (options.refresh?.() ?? page.reload());
    await page.waitForTimeout(1_000);
  }
}

export async function revealVirtualizedRow(
  page: Page,
  options: { scrollOver: Locator; target: Locator; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  await options.scrollOver.hover();

  for (;;) {
    if ((await options.target.count()) > 0) {
      break;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `the row did not appear within ${timeoutMs}ms of scrolling`,
      );
    }

    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(250);
  }

  await options.target.first().scrollIntoViewIfNeeded();
}
