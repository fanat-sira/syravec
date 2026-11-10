import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { aiConfigured: true } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
});
test("composer без чата и json, кнопки выровнены", async ({ page }) => {
  await expect(
    page.locator(
      ".chat-history,.generation-record,.composer-tabs,.composer-control-row",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /сохранить проект|открыть проект|история генераций|из объектов|по идее/,
    }),
  ).toHaveCount(0);
  await expect(page.locator(".composer .ai-controls")).toContainText("ai");
  const rects = await page
    .locator(
      ".composer > .icon-button,.composer > .generate,.composer .ai-controls > .icon-button",
    )
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { center: r.y + r.height / 2, height: r.height };
      }),
    );
  expect(rects).toHaveLength(3);
  for (const r of rects) {
    expect(r.height).toBe(36);
    expect(r.center).toBeCloseTo(rects[0].center, 0);
  }
  await page.screenshot({ path: "../artifacts/composer-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "переключить боковую панель" })
    .click();
  await page.screenshot({ path: "../artifacts/composer-mobile.png" });
});
test("стоп в кнопке отправки сохраняет сцену и черновик", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/v1/compositions", async (r) => {
    await gate;
    await r.abort().catch(() => {});
  });
  const input = page.getByRole("textbox", { name: "описание композиции" });
  await input.fill("книга и телефон рядом");
  const button = page.locator(".generate"),
    before = await button.boundingBox(),
    scene = await page.locator(".artboard").innerHTML();
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "остановить сборку");
  const after = (await button.boundingBox())!;
  expect(after.width).toBe(before!.width);
  expect(after.height).toBe(before!.height);
  expect(Math.abs(after.y - before!.y)).toBeLessThanOrEqual(1);
  expect(after.x).toBe(before!.x);
  await expect(button.locator(".lucide-square")).toHaveCount(1);
  await expect(page.locator(".generation-progress")).toHaveCount(0);
  await button.click();
  release();
  await expect(button).toHaveAttribute("aria-label", "собрать композицию");
  await expect(input).toHaveValue("книга и телефон рядом");
  expect(await page.locator(".artboard").innerHTML()).toBe(scene);
});
test("auto-запрос, постоянная ошибка и сохранение нового черновика", async ({
  page,
}) => {
  let received: any, release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/v1/compositions", async (r) => {
    received = r.request().postDataJSON();
    await gate;
    await r.fulfill({
      status: 422,
      json: { error: { message: "уточни объекты из библиотеки" } },
    });
  });
  const input = page.getByRole("textbox", { name: "описание композиции" });
  await input.fill("поставь книгу рядом с телефоном");
  await page.locator(".generate").click();
  await expect(page.locator(".generate")).toHaveAttribute(
    "aria-label",
    "остановить сборку",
  );
  await input.fill("знания открывают двери");
  release();
  await expect(page.getByRole("alert")).toContainText("уточни объекты");
  expect(received.mode).toBe("auto");
  expect(received.assetIds).toEqual([]);
  await expect(input).toHaveValue("знания открывают двери");
  await expect(page.locator(".layer-row")).toHaveCount(3);
});
test("названия объектов в composer работают с go-шаблоном", async ({
  page,
}) => {
  await page.getByRole("button", { name: "параметры генерации" }).click();
  await page
    .getByRole("combobox", { name: "способ сборки" })
    .selectOption("template");
  await page.getByRole("button", { name: "параметры генерации" }).click();
  const input = page.getByRole("textbox", { name: "описание композиции" });
  await input.fill("Книга, Телефон, Пазлы");
  await page.locator(".generate").click();
  await expect(input).toHaveValue("");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await expect(page.locator(".layer-list")).toContainText("Телефон");
  await page.reload();
  await expect(page.locator(".layer-row")).toHaveCount(3);
});
test("alt-drag создает копию, сохраняет оригинал и дает один undo", async ({
  page,
}) => {
  const nodes = page.locator(".artboard [data-layer-id]");
  const original = await nodes.evaluateAll((gs) =>
    gs.map((g) => ({
      id: g.getAttribute("data-layer-id"),
      transform: g.getAttribute("transform"),
    })),
  );
  const box = (await page.locator(".artboard").boundingBox())!,
    x = box.x + box.width * 0.76,
    y = box.y + box.height * 0.7;
  await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 45, y - 30, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator(".layer-row")).toHaveCount(4);
  expect(
    await nodes.evaluateAll((gs) =>
      gs.slice(0, 3).map((g) => ({
        id: g.getAttribute("data-layer-id"),
        transform: g.getAttribute("transform"),
      })),
    ),
  ).toEqual(original);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".layer-row")).toHaveCount(4);
});
test("alt-click, отмена жеста и блокировка не дублируют", async ({ page }) => {
  const box = (await page.locator(".artboard").boundingBox())!,
    x = box.x + box.width * 0.76,
    y = box.y + box.height * 0.7;
  await page.keyboard.down("Alt");
  await page.mouse.click(x, y);
  await page.keyboard.up("Alt");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y - 20, { steps: 5 });
  await page.locator(".artboard").dispatchEvent("pointercancel");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await page.getByRole("button", { name: "блокировка слоя" }).click();
  const before = await page.locator(".artboard").innerHTML();
  await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y - 20, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  expect(await page.locator(".artboard").innerHTML()).toBe(before);
});
