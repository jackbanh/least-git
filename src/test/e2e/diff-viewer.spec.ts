import { test, expect } from "@playwright/test";

// Pre-seed the Zustand persisted store so the app auto-opens the mock repo
// on load (same as after a real user session). Without this the tab list is
// empty and no commit rows appear.
async function openMockRepo(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("least-git-tabs", JSON.stringify({
      state: {
        tabs: [{ id: "/mock/least-git", path: "/mock/least-git", name: "least-git", selectedOid: null, listKey: 0, statusKey: 0 }],
        activeTabId: "/mock/least-git",
      },
      version: 0,
    }));
  });
  await page.goto("/");
  // Wait for a real commit OID to appear (not just the "Loading…" placeholder row).
  await page.waitForSelector(".commit-row [class*='oid'], .commit-row [class*='short']", { timeout: 15_000 });
}

test.describe("diff viewer horizontal scroll backgrounds", () => {
  test("table fills scroll area in commit diff so backgrounds cover full width", async ({ page }) => {
    await openMockRepo(page);

    // Click the first real commit (skip "Uncommitted changes" at index 0).
    await page.locator(".commit-row").nth(1).click();

    // Wait for the commit detail file list to appear.
    const fileRow = page.locator(".file-row").first();
    await fileRow.waitFor({ timeout: 12_000 });
    await fileRow.click();

    await page.locator("table.diff").first().waitFor({ timeout: 8_000 });

    const { tableWidth, scrollWidth } = await page.evaluate(() => {
      const scroll = document.querySelector(".diff-scroll")!;
      const tbl = scroll.querySelector("table.diff")!;
      return {
        tableWidth: (tbl as HTMLElement).offsetWidth,
        scrollWidth: scroll.scrollWidth,
      };
    });

    expect(tableWidth).toBe(scrollWidth);
  });

  test("table fills scroll area in working tree diff so backgrounds cover full width", async ({ page }) => {
    await openMockRepo(page);

    // "Uncommitted changes" is always the first row.
    await page.locator(".commit-row").first().click();

    const fileRow = page.locator(".file-row").first();
    await fileRow.waitFor({ timeout: 12_000 });
    await fileRow.click();

    await page.locator("table.diff").first().waitFor({ timeout: 8_000 });

    const { tableWidth, scrollWidth } = await page.evaluate(() => {
      const scroll = document.querySelector(".diff-scroll")!;
      const tbl = scroll.querySelector("table.diff")!;
      return {
        tableWidth: (tbl as HTMLElement).offsetWidth,
        scrollWidth: scroll.scrollWidth,
      };
    });

    expect(tableWidth).toBe(scrollWidth);
  });
});
