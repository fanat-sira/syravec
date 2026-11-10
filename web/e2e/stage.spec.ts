import { test, expect } from "@playwright/test";
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
    x: before.x + before.width * 0.4,
    y: before.y + before.height * 0.4,
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
test("компактный ввод, затухающая история и фокус без изменения холста", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".canvas-toolbar")).toHaveCount(0);
  const canvas = (await page.locator(".canvas-area").boundingBox())!,
    main = (await page.locator(".main-shell").boundingBox())!;
  expect(canvas.height).toBeCloseTo(main.height - 2, 0);
  expect(canvas.width).toBeCloseTo(main.width - 2, 0);
  const composer = page.locator(".composer"),
    input = page.getByRole("textbox", { name: "описание композиции" });
  const first = (await composer.boundingBox())!;
  expect(first.height).toBeLessThanOrEqual(52);
  expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    "13px",
  );
  await input.fill("строка один\nстрока два");
  const two = (await composer.boundingBox())!;
  expect(two.height).toBeGreaterThan(first.height);
  await input.fill("один\nдва\nтри");
  const three = (await composer.boundingBox())!;
  await input.fill("один\nдва\nтри\nчетыре\nпять");
  expect((await composer.boundingBox())!.height).toBe(three.height);
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await input.fill("");
  expect((await composer.boundingBox())!.height).toBe(first.height);
  await expect(page.locator(".conversation")).toBeVisible();
  const mask = await page
    .locator(".chat-history")
    .evaluate((el) => getComputedStyle(el).maskImage);
  expect(mask).toContain("0.2");
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await expect(page.locator(".chat-history")).toHaveClass(/is-focused/);
  expect(await page.locator(".canvas-area").boundingBox()).toEqual(canvas);
  await page.getByRole("button", { name: "закрыть историю генераций" }).click();
  await expect(page.locator(".conversation")).toBeVisible();
  await page
    .getByRole("button", { name: "переключить боковую панель" })
    .click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".floating-sidebar-toggle")).toBeVisible();
  await page
    .getByRole("button", { name: "переключить боковую панель" })
    .click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.screenshot({ path: "../artifacts/full-stage.png" });
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

test("пустая сохраненная композиция сохраняет нижний ввод и фокус истории", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  for (let i = 0; i < 3; i++) {
    await page.locator(".layer-select").first().click();
    await page.getByRole("button", { name: "удалить объект" }).click();
  }
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await expect(page.locator(".editor-dock")).toBeVisible();
  await expect(page.locator(".conversation")).toBeVisible();
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  const box = (await page.locator(".chat-history").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThan(1000);
  await expect(
    page.getByRole("textbox", { name: "описание композиции" }),
  ).toBeVisible();
});
