import { test, expect } from "@playwright/test";
const baseScene = {
  version: 1,
  canvas: { width: 1000, height: 1000, preset: "square" },
  palette: "violet",
  backgroundId: "background-square-violet",
};
test("библиотека объединяет варианты, выбор для генерации отделен от добавления", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".asset-card")).toHaveCount(10);
  await page.getByRole("button", { name: "из объектов", exact: true }).click();
  await page
    .getByRole("button", { name: "выбрать Книга для генерации" })
    .click();
  await page
    .getByRole("combobox", { name: "вариант Лампа", exact: true })
    .selectOption("background");
  await page
    .getByRole("button", { name: "выбрать Лампа для генерации" })
    .click();
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.getByRole("button", { name: "добавить Телефон на холст" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(page.locator(".section-library .section-count")).toHaveText("2");
  await page.locator(".section-library .section-heading").click();
  await expect(page.locator(".section-library .section-count")).toBeVisible();
  await expect(
    page.locator(".section-library .section-heading"),
  ).toHaveAttribute("aria-expanded", "false");
  await page.locator(".section-library .section-heading").click();
  await expect(
    page.getByRole("button", { name: "выбрать Книга для генерации" }),
  ).toHaveAttribute("aria-pressed", "true");
  let request: any;
  await page.route("**/api/v1/compositions", async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({
      json: {
        scene: {
          ...baseScene,
          layers: request.assetIds.map((assetId: string, i: number) => ({
            id: "chosen-" + i,
            assetId,
            x: 0.35 + i * 0.3,
            y: 0.5,
            scale: 1,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
          })),
        },
        generation: { source: "fallback", warnings: [] },
      },
    });
  });
  await page.getByRole("button", { name: "собрать композицию" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(2);
  expect(request.mode).toBe("selection");
  expect(request.assetIds).toEqual(["book-main", "lamp-background"]);
  await expect(page.locator(".layer-list")).not.toContainText("Телефон");
  await page.screenshot({ path: "../artifacts/inspector-selection.png" });
});
test("секции прокручиваются независимо, заголовки остаются доступны", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const scene = {
    ...baseScene,
    layers: Array.from({ length: 30 }, (_, i) => ({
      id: "layer" + i,
      assetId: "book-main",
      x: 0.5,
      y: 0.5,
      scale: 0.5,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    })),
  };
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .last()
    .setInputFiles({
      name: "many.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ scene })),
    });
  await expect(page.locator(".layer-row")).toHaveCount(30);
  const inspector = await page.locator(".inspector").boundingBox();
  expect(inspector!.width).toBeGreaterThanOrEqual(280);
  expect(inspector!.width).toBeLessThanOrEqual(300);
  expect(
    await page
      .locator(".asset-grid")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  expect(
    await page
      .locator(".section-layers .section-body")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await page.locator(".layer-select").first().click();
  await page.getByRole("slider", { name: "поворот", exact: true }).fill("35");
  await expect(page.locator(".layer-row.active")).toHaveCount(1);
  await expect(page.locator(".selection")).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "вариант svg", exact: true })
    .selectOption("book-background");
  await expect(page.locator(".layer-row.active")).toContainText("фоновый");
  await page
    .locator(".asset-grid")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  const scroll = await page
    .locator(".asset-grid")
    .evaluate((el) => el.scrollTop);
  await page
    .locator(".section-layers .section-body")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  expect(await page.locator(".asset-grid").evaluate((el) => el.scrollTop)).toBe(
    scroll,
  );
  for (const section of ["library", "layers", "properties"]) {
    const header = page.locator(`.section-${section} .section-heading`);
    await expect(header).toBeVisible();
    const box = (await header.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(768);
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    768,
  );
});
test("слои поддерживают порядок, видимость, блокировку и удаление", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const row = page.locator(".layer-row").first();
  const id = await row.getAttribute("data-layer");
  await row.locator(".layer-select").click();
  await page
    .locator(".layer-row.active .layer-select")
    .dragTo(page.locator(".layer-row").nth(1), {
      targetPosition: { x: 40, y: 45 },
    });

  expect(
    await page.locator(".layer-row").nth(1).getAttribute("data-layer"),
  ).toBe(id);
  const active = page.locator(".layer-row.active");
  await active.getByRole("button", { name: "скрыть слой" }).click();
  await expect(page.locator(".selection")).toHaveCount(0);
  await active.getByRole("button", { name: "показать слой" }).click();
  await expect(page.locator(".selection")).toHaveCount(1);
  await page.getByRole("button", { name: "блокировка слоя" }).click();
  await expect(
    page.getByRole("combobox", { name: "вариант svg" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "блокировка слоя" }).click();
  await page.getByRole("button", { name: "дублировать объект" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(4);
  await page.getByRole("button", { name: "удалить объект" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await expect(
    page.getByRole("combobox", { name: "формат композиции" }),
  ).toBeVisible();
});
test("история генераций раскрывается поверх рабочей области и восстанавливает результат", async ({
  page,
}) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { aiConfigured: true } }),
  );
  let requests = 0;
  await page.route("**/api/v1/compositions", async (r) => {
    const input = r.request().postDataJSON();
    expect(input.mode).toBe("concept");
    expect(input.planner).toBe("llm");
    requests++;
    await r.fulfill({
      json: {
        scene: {
          ...baseScene,
          layers: [
            {
              id: "result" + requests,
              assetId: requests === 1 ? "book-main" : "coin-main",
              x: 0.5,
              y: 0.5,
              scale: 1,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
            },
          ],
        },
        generation: { source: "llm", warnings: [] },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const input = page.getByRole("textbox", { name: "описание композиции" });
  for (const prompt of ["образование", "финансы"]) {
    await input.fill(prompt);
    await page.getByRole("button", { name: "собрать композицию" }).click();
    await expect(
      page.getByRole("button", { name: "собрать композицию" }),
    ).toBeVisible();
  }
  await expect(page.locator(".layer-list")).toContainText("Монета");
  const before = await page.locator(".canvas-area").boundingBox();
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await expect(page.locator(".generation-record")).toHaveCount(2);
  expect(await page.locator(".canvas-area").boundingBox()).toEqual(before);
  await page.getByRole("button", { name: "открыть результат" }).first().click();
  await expect(page.locator(".layer-list")).toContainText("Книга");
  await expect(page.locator(".chat-history")).not.toHaveClass(/is-focused/);
  await page.reload();
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await expect(page.locator(".generation-record")).toHaveCount(2);
  await page.screenshot({ path: "../artifacts/inspector-history.png" });
});

test("библиотека и свойства доступны в мобильном инспекторе", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /на своей волне/ }).click();
  await page.getByTitle("библиотека и загрузка svg").click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page.getByRole("button", { name: "добавить Книга на холст" }).click();
  await expect(page.locator(".layer-row.active")).toContainText("Книга");
  await expect(
    page.getByRole("slider", { name: "масштаб", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "закрыть слои", exact: true }).click();
  await expect(page.locator(".inspector")).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "описание композиции" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    844,
  );
});
