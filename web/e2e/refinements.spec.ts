import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
test("слои не меняют высоту при выделении и ширину при появлении скролла", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const row = page.locator(".layer-row").first(),
    body = page.locator(".section-layers .section-body");
  const before = (await row.boundingBox())!,
    remove = (await row.locator(".layer-delete").boundingBox())!;
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    false,
  );
  await row.locator(".layer-select").click();
  expect((await row.boundingBox())!.height).toBe(before.height);
  expect((await row.locator(".layer-delete").boundingBox())!.x).toBe(remove.x);
  const separator = page.getByRole("separator", { name: "высота слоев" }),
    box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 500, { steps: 5 });
  await page.mouse.up();
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  expect((await row.locator(".layer-delete").boundingBox())!.x).toBe(remove.x);
  expect((await row.boundingBox())!.width).toBe(before.width);
  expect(
    await body.evaluate((el) => getComputedStyle(el).scrollbarGutter),
  ).toBe("stable");
});
test("перетаскивание слоев меняет порядок и поддерживает отмену", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const original = await page
    .locator(".layer-row")
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-layer")));
  await page
    .locator(".layer-select")
    .first()
    .dragTo(page.locator(".layer-row").last(), {
      targetPosition: { x: 40, y: 45 },
    });
  const next = await page
    .locator(".layer-row")
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-layer")));
  expect(next).toEqual([original[1], original[2], original[0]]);
  await expect(page.locator(".layer-row.active")).toHaveAttribute(
    "data-layer",
    original[0]!,
  );
  await page.keyboard.press("Control+z");
  expect(
    await page
      .locator(".layer-row")
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-layer"))),
  ).toEqual(original);
});
test("экспорт сверху, инструменты вида справа снизу, ai-параметры внутри composer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const stage = (await page.locator(".main-shell").boundingBox())!,
    exportButton = (await page
      .getByRole("button", { name: "экспорт svg" })
      .boundingBox())!,
    inspector = (await page.locator(".inspector").boundingBox())!;
  expect(exportButton.y - stage.y).toBeLessThan(24);
  expect(exportButton.x + exportButton.width).toBeLessThan(inspector.x);
  await expect(page.locator(".dock-left")).not.toContainText("настройки");
  await expect(
    page.locator('.dock-left [aria-label="параметры генерации"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "параметры генерации" }).click();
  await expect(
    page.getByRole("combobox", { name: "способ сборки" }),
  ).toBeVisible();
  await expect(page.locator(".composer .ai-controls")).toBeVisible();
  await page.getByRole("button", { name: "параметры генерации" }).click();
  await page.getByRole("button", { name: "текущий масштаб" }).click();
  await page.getByRole("menuitem", { name: "150%", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "текущий масштаб" }),
  ).toContainText("150%");
  await page.getByRole("button", { name: "уменьшить холст" }).click();
  await expect(
    page.getByRole("button", { name: "текущий масштаб" }),
  ).toContainText("120%");
  await page.getByRole("button", { name: "увеличить холст" }).click();
  await expect(
    page.getByRole("button", { name: "текущий масштаб" }),
  ).toContainText("150%");
  await page.getByRole("button", { name: "вписать композицию" }).click();
  await expect(
    page.getByRole("button", { name: "текущий масштаб" }),
  ).toContainText("100%");
  await page.screenshot({ path: "../artifacts/editor-initial.png" });
});
