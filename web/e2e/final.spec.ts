import { test, expect, type Page } from "@playwright/test";
const scene = {
  version: 1,
  canvas: { width: 1000, height: 1000, preset: "square" },
  palette: "violet",
  backgroundId: "background-square-violet",
  layers: [
    {
      id: "book",
      assetId: "book-main",
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
async function openHistory(page: Page) {
  await page.goto("/");
  await expect(page.locator(".asset-card")).toHaveCount(10);
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .last()
    .setInputFiles({
      name: "history.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          title: "тест истории",
          scene,
          generations: Array.from({ length: 20 }, (_, i) => ({
            id: `g-${i}`,
            prompt: `композиция ${i}`,
            mode: "concept",
            source: "fallback",
            createdAt: i + 1,
            status: "success",
            scene,
          })),
        }),
      ),
    });
  await expect(page.locator(".generation-record")).toHaveCount(20);
}
async function svg(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "экспорт svg", exact: true }).click();
  const file = await waiting;
  let contents = "";
  for await (const chunk of (await file.createReadStream())!)
    contents += chunk.toString();
  return { contents, name: file.suggestedFilename() };
}
test("переименование, имя SVG, восстановление проекта и подтверждение удаления", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page.locator(".history-row").hover();
  await page.getByRole("button", { name: /переименовать знания/ }).click();
  await page
    .getByRole("textbox", { name: "название композиции" })
    .fill("моя композиция");
  await page
    .getByRole("textbox", { name: "название композиции" })
    .press("Enter");
  expect((await svg(page)).name).toBe("моя композиция.svg");
  await page.reload();
  await expect(page.locator(".history-row.active")).toContainText(
    "моя композиция",
  );
  await page.locator(".history-row").hover();
  await page
    .getByRole("button", { name: "удалить моя композиция", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await page
    .getByRole("button", { name: "удалить моя композиция", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "удалить композицию", exact: true })
    .click();
  await expect(page.locator(".history-row")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "что соберем?" }),
  ).toBeVisible();
});
test("ручное название до первого запроса не перезаписывается", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "добавить Книга на холст", exact: true })
    .click();
  await page.locator(".history-row").hover();
  await page
    .getByRole("button", { name: "переименовать новая композиция" })
    .click();
  await page
    .getByRole("textbox", { name: "название композиции" })
    .fill("своё название");
  await page
    .getByRole("textbox", { name: "название композиции" })
    .press("Enter");
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("образование");
  await page
    .getByRole("button", { name: "собрать композицию", exact: true })
    .click();
  await expect(page.locator(".generation-record.success")).toHaveCount(1);
  await expect(page.locator(".history-row.active")).toContainText(
    "своё название",
  );
});
test("свободная область истории пропускает колесо, ctrl-wheel и выделение к холсту", async ({
  page,
}) => {
  await openHistory(page);
  const before = await svg(page);
  const chat = page.locator(".conversation");
  const bounds = (await page.locator(".chat-history").boundingBox())!;
  const blank = { x: bounds.x + 2, y: bounds.y + bounds.height / 2 };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        !!document.elementFromPoint(x, y)?.closest(".scene-viewport"),
      blank,
    ),
  ).toBe(true);
  const scroll = await chat.evaluate((el) => el.scrollTop);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => chat.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -140);
  await page.keyboard.up("Control");
  await expect
    .poll(() =>
      page.getByRole("button", { name: "текущий масштаб" }).innerText(),
    )
    .not.toBe("100%");
  expect((await svg(page)).contents).toBe(before.contents);
  await page.locator(".layer-select").click();
  await page.mouse.click(blank.x, blank.y);
  await expect(page.locator(".selection")).toHaveCount(0);
  const last = (await page.locator(".generation-record").last().boundingBox())!;
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(() => chat.evaluate((el) => el.scrollTop))
    .toBeLessThan(scroll);
  expect(
    await chat.evaluate((el) => getComputedStyle(el).scrollbarGutter),
  ).toBe("auto");
  // Expanded history also passes events above the fitted artboard rectangle.
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  const expanded = (await page.locator(".chat-history").boundingBox())!;
  const topBlank = { x: expanded.x + 2, y: expanded.y + 2 };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        !!document.elementFromPoint(x, y)?.closest(".scene-viewport"),
      topBlank,
    ),
  ).toBe(true);
  const previousZoom = await page
    .getByRole("button", { name: "текущий масштаб" })
    .innerText();
  await page.mouse.move(topBlank.x, topBlank.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(() =>
      page.getByRole("button", { name: "текущий масштаб" }).innerText(),
    )
    .not.toBe(previousZoom);
});
test("история закрывается при увеличенном и сдвинутом виде без изменения композиции", async ({
  page,
}) => {
  await openHistory(page);
  await page.getByRole("button", { name: "увеличить холст" }).click();
  const viewport = (await page.locator(".scene-viewport").boundingBox())!;
  await page.mouse.move(viewport.x + 20, viewport.y + 20);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(viewport.x + 70, viewport.y + 50);
  await page.mouse.up({ button: "middle" });
  const before = await page.locator(".artboard").boundingBox();
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await page
    .getByRole("button", { name: "закрыть историю генераций", exact: true })
    .click();
  expect(await page.locator(".artboard").boundingBox()).toEqual(before);
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await page.keyboard.press("Escape");
  expect(await page.locator(".artboard").boundingBox()).toEqual(before);
});
test("общие свойства доступны без снятия выделения, палитры имеют цветовой предпросмотр", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page.locator(".layer-select").first().click();
  const id = await page.locator(".layer-row.active").getAttribute("data-layer");
  await page.getByRole("button", { name: "композиция", exact: true }).click();
  await page
    .getByRole("button", { name: "палитра мятный", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "палитра мятный", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".palette-previews button span")).toHaveCount(18);
  await expect(page.locator(".layer-row.active")).toHaveAttribute(
    "data-layer",
    id!,
  );
  await expect(page.locator(".selection")).toHaveCount(1);
  await page.getByRole("button", { name: "объект", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "позиция x" }),
  ).toBeVisible();
});
test("новая композиция сбрасывает выделение, набор и временный Composer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page.locator(".layer-select").first().click();
  await page.getByRole("button", { name: "из объектов", exact: true }).click();
  await page
    .getByRole("button", { name: "выбрать Книга для генерации" })
    .click();
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("черновик");
  await page.getByRole("button", { name: "параметры генерации" }).click();
  await page
    .getByRole("button", { name: "новая композиция", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "описание композиции" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "описание композиции" }),
  ).toHaveAttribute("placeholder", "опиши композицию");
  await expect(page.locator(".picked-chips")).toHaveCount(0);
  await expect(page.locator(".selection")).toHaveCount(0);
  await expect(page.locator(".ai-settings")).toHaveCount(0);
});
test("нижние группы не пересекаются и холст вписан между инспектором и инструментами", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  for (const width of [1600, 1440, 1280, 1100, 1024, 900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const rect = (q: string) =>
            document.querySelector(q)!.getBoundingClientRect();
          const groups = [".composer-stack", ".dock-left", ".dock-right"].map(
            rect,
          );
          const art = rect(".artboard"),
            viewport = rect(".stage-fit-area");
          const overlap = groups.some((a, i) =>
            groups
              .slice(i + 1)
              .some(
                (b) =>
                  a.left < b.right &&
                  a.right > b.left &&
                  a.top < b.bottom &&
                  a.bottom > b.top,
              ),
          );
          const clipped =
            art.left < viewport.left - 1 ||
            art.right > viewport.right + 1 ||
            art.top < viewport.top - 1 ||
            art.bottom > viewport.bottom + 1;
          return { overlap, clipped };
        });
      })
      .toEqual({ overlap: false, clipped: false });
  }
  if (await page.locator(".sidebar").isVisible())
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "переключить боковую панель" })
      .click();
  await page.screenshot({ path: "../artifacts/final-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".floating-sidebar-toggle").click();
  await page.screenshot({ path: "../artifacts/final-desktop.png" });
});
test("отмена запроса и ошибка остаются в истории, предыдущий результат доступен", async ({
  page,
}) => {
  await openHistory(page);
  await expect(page.locator(".ai-controls")).toContainText("шаблон");
  await page.route("**/api/v1/compositions", (r) => r.abort("timedout"));
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("новая идея");
  await page
    .getByRole("button", { name: "собрать композицию", exact: true })
    .click();
  await expect(page.locator(".generation-record.error")).toHaveCount(1);
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await page.unroute("**/api/v1/compositions");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/compositions", async (r) => {
    await pending;
    await r.abort().catch(() => {});
  });
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("ещё одна идея");
  await page
    .getByRole("button", { name: "собрать композицию", exact: true })
    .click();
  await expect(page.locator(".generation-progress")).toContainText(
    "по шаблону",
  );
  await page.getByRole("button", { name: "остановить сборку" }).click();
  await expect(page.locator(".generation-record.cancelled")).toHaveCount(1);
  release();
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "открыть результат", exact: true }),
  ).toHaveCount(20);
});

test("отказ и уточнение guard сохраняют сцену, историю и текст для исправления", async ({
  page,
}) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({
      json: { status: "ok", aiConfigured: true, guardEnabled: true },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const before = await page.locator(".artboard").innerHTML();
  const input = page.getByRole("textbox", { name: "описание композиции" });
  for (const [code, prompt, message] of [
    [
      "prompt_rejected",
      "напиши миллион строк кода",
      "SyraVec собирает иллюстрации из SVG. опиши идею",
    ],
    [
      "prompt_uncertain",
      "что-нибудь",
      "сформулируй запрос как идею для иллюстрации",
    ],
  ]) {
    await page.route("**/api/v1/compositions", (r) =>
      r.fulfill({ status: 422, json: { error: { code, message } } }),
    );
    await input.fill(prompt);
    await page
      .getByRole("button", { name: "собрать композицию", exact: true })
      .click();
    await expect(page.locator(".generation-record.error").last()).toContainText(
      message,
    );
    await expect(input).toHaveValue(prompt);
    expect(await page.locator(".artboard").innerHTML()).toBe(before);
    await page.unroute("**/api/v1/compositions");
  }
  await page.reload();
  await expect(page.locator(".generation-record.error")).toHaveCount(2);
  await expect(page.locator(".layer-row")).toHaveCount(3);
});

test("уточнение guard не перезаписывает новый черновик пользователя", async ({
  page,
}) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: true } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/compositions", async (r) => {
    await pending;
    await r.fulfill({
      status: 422,
      json: {
        error: { code: "prompt_uncertain", message: "уточни идею иллюстрации" },
      },
    });
  });
  const input = page.getByRole("textbox", { name: "описание композиции" });
  await input.fill("первая идея");
  await page
    .getByRole("button", { name: "собрать композицию", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "остановить сборку" }),
  ).toBeVisible();
  await input.fill("новый черновик");
  release();
  await expect(page.locator(".generation-record.error")).toContainText(
    "уточни идею иллюстрации",
  );
  await expect(input).toHaveValue("новый черновик");
});
