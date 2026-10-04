// Contains exactly the five PRD submission checks against the production app; browser-only observations never weaken the cross-origin runtime boundary.
import { test, expect } from "@playwright/test";
import { occurrence, openBoard, pointAt, previewFrame, reports, selectPrimary, setMenu, showPreview } from "./helpers";

/** Disabled controls remain inspectable while Select input never activates or focuses the page. */
test("disabled submit can be hovered and selected without page action", async ({ page }) => {
  await openBoard(page);
  await showPreview(page, "scr-02");
  const frame = await previewFrame(page, "scr-02");
  const submit = frame.locator('button[disabled]');
  const instance = await page.getByTestId("preview-scr-02").getAttribute("data-instance-id");
  const url = frame.url();
  await pointAt(page, submit, false);
  await expect(page.getByTestId("hover-label")).toHaveText("Create account");
  await pointAt(page, submit);
  await expect(page.getByTestId("selection-label")).toHaveText("Create account");
  await expect(page.getByTestId("board")).toHaveAttribute("data-selected-count", "1");
  await expect(page.getByTestId("live-tag")).toHaveText("button");
  await expect(submit).toBeDisabled();
  expect(frame.url()).toBe(url);
  expect(await page.getByTestId("preview-scr-02").getAttribute("data-instance-id")).toBe(instance);
  /** Observes page focus without reaching into the closed neutral agent surface. */
  function activeTag() { return document.activeElement?.tagName; }
  expect(await frame.evaluate(activeTag)).not.toBe("BUTTON");
  await pointAt(page, frame.locator('input[type="email"]'));
  expect(await frame.evaluate(activeTag)).not.toBe("INPUT");
  await pointAt(page, frame.locator('input[type="checkbox"]'));
  await expect(frame.locator('input[type="checkbox"]')).not.toBeChecked();
  await pointAt(page, frame.locator('a[data-key="signup-login-link"]'));
  expect(frame.url()).toBe(url);
  expect(await reports(page)).toBe(4);
});

/** Keyed and un-keyed feed selections must retain their logical element through five actual DOM rebuilds, never a sibling. */
test("feed selection never jumps across at least five natural rebuilds", async ({ page }) => {
  await openBoard(page);
  await showPreview(page, "scr-04");
  const frame = await previewFrame(page, "scr-04");
  /** Reads the newest logical item to observe a natural rebuild, never to match selected identities by position. */
  function newestText() { return frame.locator("li .text").first().innerText(); }
  const before = await newestText();
  await expect.poll(newestText, { timeout: 5_000 }).not.toBe(before);
  const key = await frame.locator("li[data-key]").first().getAttribute("data-key");
  const keyed = frame.locator(`li[data-key="${key}"]`);
  const keyedText = await keyed.locator(".text").innerText();
  const unkeyedText = await frame.locator("li:not([data-key]) .text").first().innerText();
  const unkeyed = frame.locator("li:not([data-key])").filter({ hasText: unkeyedText });
  await pointAt(page, keyed, true, false, true);
  await expect(page.getByTestId("board")).toHaveAttribute("data-selected-count", "1");
  const keyedId = JSON.parse((await page.getByTestId("board").getAttribute("data-selected-ids"))!)[0] as string;
  await pointAt(page, unkeyed, true, true, true);
  await expect(page.getByTestId("board")).toHaveAttribute("data-selected-count", "2");
  const ids = JSON.parse((await page.getByTestId("board").getAttribute("data-selected-ids"))!) as string[];
  let marker = await newestText();
  for (let tick = 0; tick < 5; tick++) {
    await expect.poll(newestText, { timeout: 5_000 }).not.toBe(marker);
    marker = await newestText();
    await expect(page.getByTestId("board")).toHaveAttribute("data-selected-ids", JSON.stringify(ids));
    await expect(page.getByTestId("board")).toHaveAttribute("data-selection-missing", "false");
    const logicalRows = [frame.locator(`li[data-key="${key}"]`), frame.locator("li:not([data-key])").filter({ hasText: unkeyedText })];
    for (let index = 0; index < ids.length; index++) {
      const row = logicalRows[index];
      await expect.poll(
        /** Compares each stable host identity to the current rebuilt logical row, not its old DOM node or index. */
        async () => {
          const expected = await row.boundingBox();
          const actual = await page.locator(`[data-testid="selection-outline"][data-element-id="${ids[index]}"] [data-testid="selection-border"]`).boundingBox();
          if (!expected || !actual) return Infinity;
          return Math.max(Math.abs(expected.x - actual.x), Math.abs(expected.y - actual.y), Math.abs(expected.width - actual.width), Math.abs(expected.height - actual.height));
        },
      ).toBeLessThan(0.2);
    }
    await expect(logicalRows[0].locator(".text")).toHaveText(keyedText);
  }
  expect(ids[0]).toBe(keyedId);
  await expect(page.getByTestId("inspector-count")).toHaveText("2 elements");
  expect(await reports(page)).toBe(4);
});

/** Selecting a never-loaded deep leaf reveals every ancestor and brings its highlighted row into the panel viewport. */
test("deep leaf selection expands all ancestors and highlights its Layers row", async ({ page }) => {
  await openBoard(page);
  await expect(page.getByTestId("layers-empty")).toHaveText("Click something in a preview");
  await showPreview(page, "scr-05");
  const frame = await previewFrame(page, "scr-05");
  await pointAt(page, frame.locator('[data-key="setting-30-1"]'));
  const selected = page.locator(".layers-row.is-selected");
  await expect(selected.locator(".layers-name")).toHaveText("Setting 30.1", { timeout: 15_000 });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  expect(await page.locator('.layers-row[aria-expanded="true"]').count()).toBeGreaterThanOrEqual(30);
  const box = await selected.boundingBox();
  const panel = await page.getByTestId("layers").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(panel!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);
  await expect(page.getByTestId("live-name")).toHaveText("Setting 30.1");
  await selected.locator(".layers-name").focus();
  await page.keyboard.press("ArrowDown");
  await expect(selected.locator(".layers-name")).toHaveText("Setting 30.2");
  await expect(page.getByTestId("live-name")).toHaveText("Setting 30.2");
  await expect(page.getByTestId("board")).toHaveAttribute("data-selected-count", "1");
  await page.keyboard.press("ArrowUp");
  await expect(selected.locator(".layers-name")).toHaveText("Setting 30.1");
  await expect(page.getByTestId("live-name")).toHaveText("Setting 30.1");
  await page.getByRole("button", { name: "Setting 30.3", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("inspector-count")).toHaveText("2 elements");
  await page.keyboard.press("ArrowUp");
  await expect(selected.locator(".layers-name")).toHaveText("Setting 30.2");
  await expect(page.getByTestId("live-name")).toHaveText("Setting 30.2");
  await expect(page.getByTestId("board")).toHaveAttribute("data-selected-count", "1");
  expect(await reports(page)).toBe(4);
});

/** Genuine Interact navigation replaces only that document, clears its selection/tree and reconnects Select without a board reload. */
test("Interact navigation clears the preview selection and old Layers without reloading the board", async ({ page }) => {
  await openBoard(page);
  await showPreview(page, "scr-02");
  const frame = await previewFrame(page, "scr-02");
  const login = frame.locator('[data-key="signup-login-link"]');
  await pointAt(page, login);
  await expect(page.locator(".layers-row.is-selected .layers-name")).toHaveText("a");
  const ids = await page.getByTestId("board").getAttribute("data-selected-ids");
  const instance = await page.getByTestId("preview-scr-02").getAttribute("data-instance-id");
  const sibling = await page.getByTestId("preview-scr-01").getAttribute("data-instance-id");
  const x = await page.getByTestId("board").getAttribute("data-x");
  const y = await page.getByTestId("board").getAttribute("data-y");
  await page.getByTestId("interact-mode").click();
  await pointAt(page, login);
  /** Reads this preview's current authenticated document identity after navigation. */
  function documentInstance() { return page.getByTestId("preview-scr-02").getAttribute("data-instance-id"); }
  /** Resolves the current frame again because navigation may replace the tooling handle. */
  async function documentUrl() { return (await previewFrame(page, "scr-02")).url(); }
  await expect.poll(documentInstance).not.toBe(instance);
  await expect.poll(documentUrl).toContain("/page-1.html");
  await expect(page.getByTestId("board")).toHaveAttribute("data-selected-count", "0");
  await expect(page.getByTestId("board")).toHaveAttribute("data-selection-missing", "false");
  await expect(page.locator(".layers-row.is-selected")).toHaveCount(0);
  await expect(page.getByTestId("layers-tree")).toContainText("Top nav");
  await expect(page.getByTestId("layers-tree")).not.toContainText("form");
  expect(await page.getByTestId("preview-scr-01").getAttribute("data-instance-id")).toBe(sibling);
  await expect(page.getByTestId("board")).toHaveAttribute("data-x", x!);
  await expect(page.getByTestId("board")).toHaveAttribute("data-y", y!);
  await expect(page.locator('[data-connection="ready"]')).toHaveCount(24);
  await page.getByTestId("select-mode").click();
  await pointAt(page, (await previewFrame(page, "scr-02")).locator('[data-key="cta-primary"]'));
  await expect(page.getByTestId("details-component")).toHaveText("Button");
  await expect(page.getByTestId("board")).not.toHaveAttribute("data-selected-ids", ids!);
  expect(await reports(page)).toBe(4);
});

/** Exercises every fatal region's exact-once reporting, failed Retry generations, recovery and silent cancelled/gone completions. */
test("regional failures report exactly once and cancelled requests report nothing", async ({ page }) => {
  await openBoard(page);
  await selectPrimary(page);
  const cases = [
    ["details-bad-json", "details", "details / scr-01 / cta-primary", "details-retry-fail"],
    ["layers-row-timeout", "layers-row", "layers-row / scr-01", "layers-row-retry-fail"],
    ["layers-render", "layers", "layers / scr-01", "layers-retry-fail"],
    ["inspector-render", "inspector", "inspector / scr-01", "inspector-retry-fail"],
    ["preview-no-connect", "preview-scr-01", "preview / scr-01", "preview-retry-fail"],
    ["board-global", "board", "board / board", "board-retry-fail"],
  ] as const;
  for (const [trigger, region, context, arm] of cases) {
    await setMenu(page, true);
    const count = await reports(page);
    await page.getByTestId(`dev-${trigger}`).click();
    const error = region === "layers-row" ? page.locator(".layers-tree .region-error") : page.getByTestId(`${region}-error`);
    await expect(error).toBeVisible({ timeout: 13_000 });
    await expect(page.locator(".region-error")).toHaveCount(1);
    await occurrence(page, context, count + 1);
    if (region !== "board") await expect(page.locator('[data-connection="ready"]')).toHaveCount(region === "preview-scr-01" ? 23 : 24);
    if (["details", "layers-row", "layers"].includes(region)) await expect(page.getByTestId("live-name")).toHaveText("Get started");
    const retry = error.getByRole("button", { name: "Retry", exact: true });
    await page.getByTestId(`dev-${arm}`).click();
    await retry.click();
    await expect(error).toBeVisible({ timeout: 13_000 });
    await occurrence(page, context, count + 2);
    await retry.click();
    await expect(page.locator(".region-error")).toHaveCount(0);
    await expect(page.locator('[data-connection="ready"]')).toHaveCount(24, { timeout: 20_000 });
    if (region === "board") await expect(page.locator(".page-error")).toHaveCount(4, { timeout: 12_000 });
    /** Includes each reloaded Docs document's expected rejection while excluding any duplicate failure reports. */
    function reportTotal() { return reports(page); }
    await expect.poll(reportTotal).toBe(count + (region === "board" ? 6 : 2));
    await selectPrimary(page);
  }
  for (const trigger of ["details-late-response", "details-late-error", "details-gone-response", "details-gone-error"]) {
    await selectPrimary(page);
    await setMenu(page, true);
    const count = await reports(page);
    await page.getByTestId(`dev-${trigger}`).click();
    if (trigger.includes("-gone-")) await expect(page.getByTestId("board")).toHaveAttribute("data-selected-count", "0");
    else await expect(page.getByTestId("details-component")).toHaveText("Button");
    // The deliberately unabortable dev completion has a 900ms deadline; observe beyond its delivery, not merely the immediate cancellation.
    await page.waitForTimeout(1200);
    expect(await reports(page)).toBe(count);
    await expect(page.locator(".region-error")).toHaveCount(0);
  }
});
