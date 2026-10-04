// Drives production UI with native input and reads browser-tooling diagnostics; never imports stores or changes application state directly.
import { expect, type Frame, type Locator, type Page } from "@playwright/test";

/** Starts the complete production board and settles the four intentional Docs errors before report baselines. */
export async function openBoard(page: Page) {
  await page.goto("/?dev");
  await expect(page.locator('[data-connection="ready"]')).toHaveCount(24, { timeout: 20_000 });
  await expect(page.locator(".page-error")).toHaveCount(4, { timeout: 12_000 });
  await expect(page.getByTestId("report-count")).toHaveText("4");
}

/** Resolves a cross-origin frame through privileged test tooling, using screen identity rather than its reused URL. */
export async function previewFrame(page: Page, screenId: string): Promise<Frame> {
  const handle = await page.getByTestId(`iframe-${screenId}`).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`Missing preview ${screenId}`);
  return frame;
}

/** Finds an actual empty board pixel so native wheel input pans instead of scrolling a page. */
export async function emptyPoint(page: Page) {
  return page.getByTestId("board").evaluate(
    /** Searches visible host pixels without inspecting any child document. */
    element => {
      const rect = element.getBoundingClientRect();
      for (let y = rect.top + 2; y < rect.bottom; y += 10) {
        for (let x = rect.left + 2; x < rect.right; x += 10) {
          const hit = document.elementFromPoint(x, y);
          if (hit === element || (hit instanceof HTMLElement && hit.dataset.testid === "board-world")) return { x, y };
        }
      }
      throw new Error("No empty board pixel");
    },
  );
}

/** Brings one preview into view through normal board panning without remounting it. */
export async function showPreview(page: Page, screenId: string) {
  const surface = page.getByTestId(`preview-${screenId}`).locator(".preview-surface");
  const box = await surface.boundingBox();
  const board = await page.getByTestId("board").boundingBox();
  if (!box || !board) throw new Error("Missing board geometry");
  const point = await emptyPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(box.x - board.x - 80, box.y - board.y - 70);
  /** Reads the latest painted horizontal position after rAF-batched motion. */
  async function left() { return (await surface.boundingBox())?.x; }
  /** Reads the latest painted vertical position after rAF-batched motion. */
  async function top() { return (await surface.boundingBox())?.y; }
  await expect.poll(left).toBeCloseTo(board.x + 80, 0);
  await expect.poll(top).toBeCloseTo(board.y + 70, 0);
}

/** Sends native pointer input through the Select overlay, including disabled controls that locator.click cannot activate. */
export async function pointAt(page: Page, locator: Locator, click = true, shift = false, topPadding = false) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing target geometry");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + (topPadding ? 3 : box.height / 2));
  await page.mouse.move(x, y);
  if (!click) return;
  if (shift) await page.keyboard.down("Shift");
  try { await page.mouse.click(x, y); }
  finally { if (shift) await page.keyboard.up("Shift"); }
}

/** Toggles diagnostics without covering board pointer targets while closed. */
export async function setMenu(page: Page, open: boolean) {
  const current = (await page.getByTestId("dev-menu").getAttribute("open")) !== null;
  if (current !== open) await page.getByTestId("dev-toggle").click();
}

/** Selects the landing page's Details-backed button through its overlay and waits for the synchronized tree. */
export async function selectPrimary(page: Page) {
  await setMenu(page, false);
  await showPreview(page, "scr-01");
  await pointAt(page, (await previewFrame(page, "scr-01")).locator('[data-key="cta-primary"]'));
  await expect(page.getByTestId("details-component")).toHaveText("Button");
  await expect(page.locator(".layers-row.is-selected .layers-name")).toHaveText("Get started");
}

/** Reads the lifetime total independently of the bounded log ring. */
export async function reports(page: Page) {
  return Number(await page.getByTestId("report-count").textContent());
}

/** Checks the exact failure/report pair and attribution after a live regional failure. */
export async function occurrence(page: Page, context: string, count: number) {
  /** Reads the live total while the guarded failure entry settles. */
  function total() { return reports(page); }
  await expect.poll(total).toBe(count);
  const entries = await page.getByTestId("failure-log").locator("li").allTextContents();
  expect(entries.at(-2)).toMatch(new RegExp(`^failure: ${context} — `));
  expect(entries.at(-1)).toBe(entries.at(-2)?.replace(/^failure:/, "report:"));
}
