import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
test("фокус расширяет тот же чат на высоту холста, элементы управления под вводом", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const chat = page.locator(".chat-history"),
    composer = page.locator(".composer"),
    main = page.locator(".main-shell");
  const input = (await composer.boundingBox())!,
    controls = (await page.locator(".composer-control-row").boundingBox())!,
    messages = (await chat.boundingBox())!;
  expect(messages.y + messages.height).toBeLessThan(input.y);
  expect(controls.y).toBeGreaterThanOrEqual(input.y + input.height);
  expect(
    await page
      .locator(".conversation")
      .evaluate((el) => getComputedStyle(el).scrollbarColor),
  ).toBe("rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
  const bounds = await page.locator(".canvas-area").boundingBox();
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  const focused = (await chat.boundingBox())!,
    frame = (await main.boundingBox())!;
  expect(focused.y).toBeCloseTo(frame.y + 12, 0);
  expect(focused.y + focused.height).toBeCloseTo(input.y - 8, 0);
  expect(await chat.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
    "none",
  );
  expect(await chat.evaluate((el) => getComputedStyle(el).maskImage)).toBe(
    "none",
  );
  expect(await page.locator(".canvas-area").boundingBox()).toEqual(bounds);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "../artifacts/chat-focus.png" });
  await page.getByRole("button", { name: "закрыть историю генераций" }).click();
  await expect(chat).not.toHaveClass(/is-focused/);
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
  await expect(
    page.locator(".composer-control-row .ai-controls"),
  ).toBeVisible();
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
