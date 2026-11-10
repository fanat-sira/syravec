import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
test("старт, редактор, история, загрузки, векторный экспорт", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "что соберем?" }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/syravec-welcome.png", fullPage: true });
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await expect(
    page.getByRole("img", { name: "холст композиции" }),
  ).toBeVisible();
  expect(await page.locator(".artboard>g>g").count()).toBeGreaterThanOrEqual(3);
  await page.locator(".layer-row").first().locator("button").first().click();
  await page.getByRole("button", { name: "дублировать объект" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(4);
  await page.getByRole("button", { name: "отменить", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await page.getByRole("button", { name: "повторить", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(4);
  await page.locator(".layer-row").first().locator("button").first().click();
  await page.getByRole("slider", { name: "поворот", exact: true }).fill("27");
  await page.locator(".scene-viewport").click({ position: { x: 8, y: 70 } });
  await page
    .getByRole("combobox", { name: "палитра композиции" })
    .selectOption("teal");
  await page
    .getByRole("combobox", { name: "формат композиции" })
    .selectOption("landscape");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "экспорт svg", exact: true }).click();
  const d = await dl;
  await d.saveAs("/tmp/syravec-export.svg");
  await page.screenshot({ path: "/tmp/syravec-editor.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".layer-row")).toHaveCount(4);
  const count = await page.locator(".history-row").count();
  await page
    .getByRole("button", { name: "новая композиция", exact: false })
    .click();
  await expect(page.getByRole("heading")).toBeVisible();
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("2 монеты, ручка и лампа");
  await page.getByRole("button", { name: "собрать композицию" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(4);
  await expect(page.locator(".layer-list")).toContainText("Монета");
  await expect(page.locator(".history-row")).toHaveCount(count + 1);
  // Upload stays vector; unsafe input is rejected without altering the scene
  const before = await page.locator(".layer-row").count();
  await page
    .locator('input[type=file][accept=".svg,image/svg+xml"]')
    .setInputFiles({
      name: "мой.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#f00"/></svg>',
      ),
    });
  await expect(page.locator(".layer-row")).toHaveCount(before + 1);
  await page
    .locator('input[type=file][accept=".svg,image/svg+xml"]')
    .setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>',
      ),
    });
  await expect(page.getByRole("status")).toContainText("не поддерживается");
  await expect(page.locator(".layer-row")).toHaveCount(before + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/syravec-mobile.png", fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
test("ошибка генерации сохраняет сцену", async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: true } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /деньги под контролем/ }).click();
  const before = await page.locator(".artboard").innerHTML();
  await page.route("**/api/v1/compositions", (r) =>
    r.fulfill({
      status: 502,
      json: { error: { code: "provider_error", message: "ошибка модели" } },
    }),
  );
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("другая композиция");
  await page.getByRole("button", { name: "собрать композицию" }).click();
  await expect(page.getByRole("alert")).toContainText("ошибка модели");
  expect(await page.locator(".artboard").innerHTML()).toBe(before);
});

test("указатель двигает и вращает слой, индивидуального масштаба нет", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page.locator(".layer-row").first().locator("button").first().click();
  const x = page.getByRole("spinbutton", { name: "позиция x" });
  const initial = Number(await x.inputValue());
  const art = page.locator(".artboard");
  const box = (await art.boundingBox())!;
  // last main object is the puzzle, centered at .76,.7 in this example
  const point = { x: box.x + box.width * 0.76, y: box.y + box.height * 0.7 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 40, point.y - 25, { steps: 5 });
  await page.mouse.up();
  expect(Number(await x.inputValue())).toBeLessThan(initial);
  await expect(page.locator('[aria-label="изменить размер"]')).toHaveCount(0);
  await expect(
    page.getByRole("slider", { name: "масштаб", exact: true }),
  ).toHaveCount(0);
  const rotate = page.locator('[aria-label="повернуть объект"]'),
    rb = (await rotate.boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 35, rb.y + rb.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.up();
  expect(
    Number(
      await page
        .getByRole("slider", { name: "поворот", exact: true })
        .inputValue(),
    ),
  ).not.toBe(8);
  await page.getByRole("button", { name: "блокировка слоя" }).click();
  await expect(
    page.getByRole("slider", { name: "поворот", exact: true }),
  ).toBeDisabled();
});

test("запоздавший ответ не заменяет ручную правку", async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { aiConfigured: true } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/compositions", async (r) => {
    await gate;
    await r.fulfill({
      json: {
        scene: {
          version: 2,
          illustrationSize: "large",
          canvas: { width: 1000, height: 1000, preset: "square" },
          palette: "violet",
          backgroundId: "background-square-violet",
          layers: [
            {
              id: "test-layer",
              assetId: "coin-main",
              x: 0.5,
              y: 0.5,

              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
            },
          ],
        },
        generation: { source: "llm" },
      },
    });
  });
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("новая идея");
  await page.getByRole("button", { name: "собрать композицию" }).click();
  await expect(
    page.getByRole("button", { name: "остановить сборку" }),
  ).toBeVisible();
  await page.locator(".layer-row").first().locator("button").first().click();
  await page.getByRole("button", { name: "дублировать объект" }).click();
  release();
  await expect(page.getByRole("alert")).toContainText("композиция изменилась");
  await expect(page.locator(".layer-row")).toHaveCount(4);
});

test("три примера экспортируются как автономные векторные файлы", async ({
  page,
}) => {
  await page.goto("/");
  for (const [i, name] of [
    "знания открывают двери",
    "деньги под контролем",
    "на своей волне",
  ].entries()) {
    if (i > 0)
      await page
        .getByRole("button", { name: "новая композиция", exact: false })
        .click();
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page
      .getByRole("combobox", { name: "палитра композиции" })
      .selectOption(["violet", "teal", "warm"][i]);
    await page
      .getByRole("combobox", { name: "формат композиции" })
      .selectOption(["square", "landscape", "portrait"][i]);
    const dl = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "экспорт svg", exact: true })
      .click();
    await (await dl).saveAs(`../artifacts/composition-${i + 1}.svg`);
    await page.screenshot({
      path: `../artifacts/composition-${i + 1}.png`,
      fullPage: true,
    });
  }
});

test("мобильная история доступна через боковую панель", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: /на своей волне/ }).click();
  await page
    .getByRole("button", { name: "переключить боковую панель" })
    .click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "переключить боковую панель" })
    .click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
