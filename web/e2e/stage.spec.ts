import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
test("перенос варианта из библиотеки на холст с координатами и отменой", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page
    .getByRole("combobox", { name: "вариант Книга", exact: true })
    .selectOption("background");
  const art = page.locator(".artboard");
  const bounds = (await art.boundingBox())!;
  const point = { x: bounds.width * 0.3, y: bounds.height * 0.35 };
  const count = await page.locator(".layer-row").count();
  await page
    .locator('[data-asset="book-main"] .asset-preview')
    .dragTo(art, { targetPosition: point });
  await expect(page.locator(".layer-row")).toHaveCount(count + 1);
  await expect(page.locator(".layer-row.active")).toContainText("Книга");
  await expect(
    page.getByRole("combobox", { name: "вариант svg", exact: true }),
  ).toHaveValue("book-background");
  expect(
    Number(
      await page.getByRole("spinbutton", { name: "позиция x" }).inputValue(),
    ),
  ).toBeCloseTo(30, 0);
  expect(
    Number(
      await page.getByRole("spinbutton", { name: "позиция y" }).inputValue(),
    ),
  ).toBeCloseTo(35, 0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(count);
  await page.keyboard.press("Control+Shift+Z");
  await expect(page.locator(".layer-row")).toHaveCount(count + 1);
  // physical key works for shifted and non-Latin layouts too
  await page.keyboard.press("Control+KeyZ");
  await expect(page.locator(".layer-row")).toHaveCount(count);
});
test("ctrl с колесом масштабирует вид вокруг курсора без изменения объектов", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page.locator(".layer-select").first().click();
  const x = await page
    .getByRole("spinbutton", { name: "позиция x" })
    .inputValue();
  const art = page.locator(".artboard"),
    before = (await art.boundingBox())!;
  const point = {
    // Native wheel events use integer client coordinates.
    x: Math.round(before.x + before.width * 0.4),
    y: Math.round(before.y + before.height * 0.4),
  };
  const coords = () =>
    page.evaluate(({ x, y }) => {
      const svg = document.querySelector<SVGSVGElement>(".artboard")!;
      const p = new DOMPoint(x, y).matrixTransform(
        svg.getScreenCTM()!.inverse(),
      );
      return { x: p.x, y: p.y };
    }, point);
  const world = await coords();
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -160);
  await page.keyboard.up("Control");
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("button", { name: "текущий масштаб" })
          .innerText()
          .then((s) => s.replace("%", "")),
      ),
    )
    .toBeGreaterThan(100);
  const after = (await art.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width);
  const same = await coords();
  expect(same.x).toBeCloseTo(world.x, 1);
  expect(same.y).toBeCloseTo(world.y, 1);
  expect(
    await page.getByRole("spinbutton", { name: "позиция x" }).inputValue(),
  ).toBe(x);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(1);
  await page.mouse.wheel(0, 160);
  expect((await art.boundingBox())!.width).toBeCloseTo(after.width, 1);
  await page.getByTitle("вписать композицию").click();
  expect((await art.boundingBox())!.width).toBeCloseTo(before.width, 1);
});
test("перенос из библиотеки создает первую композицию", async ({ page }) => {
  await page.goto("/");
  const before = await page.locator(".layer-row").count();
  await page
    .locator('[data-asset="coin-main"] .asset-preview')
    .dragTo(page.locator(".welcome"), { targetPosition: { x: 70, y: 180 } });
  await expect(page.locator(".layer-row")).toHaveCount(before + 1);
  await expect(page.locator(".artboard")).toBeVisible();
  await expect(page.locator(".layer-row.active")).toContainText("Монета");
});
