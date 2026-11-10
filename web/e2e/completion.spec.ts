import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
test("форматы и все палитры сохраняют исходные пути всей библиотеки", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "добавить Книга на холст", exact: true }),
  ).toBeVisible();
  const manifest = await (
    await page.request.get("/assets/manifest.json")
  ).json();
  const layers = manifest.assets.map((a: any, i: number) => ({
    id: "catalog-" + i,
    assetId: a.id,
    x: ((i % 5) + 0.5) / 5,
    y: (Math.floor(i / 5) + 0.5) / 4,
    scale: 0.38,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  }));
  const scene = {
    version: 1,
    canvas: { width: 1000, height: 1000, preset: "square" },
    palette: "violet",
    backgroundId: "background-square-violet",
    layers,
  };
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .last()
    .setInputFiles({
      name: "catalog.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ scene })),
    });
  await expect(page.locator(".layer-row")).toHaveCount(20);
  const paths = await page
    .locator(".artboard>g>g[transform]")
    .evaluateAll((groups) =>
      groups.flatMap((g) =>
        [...g.querySelectorAll("path")].map((p) => p.getAttribute("d")),
      ),
    );
  for (const [i, palette] of ["violet", "teal", "warm"].entries()) {
    await page
      .getByRole("combobox", { name: "палитра композиции" })
      .selectOption(palette);
    expect(
      await page
        .locator(".artboard>g>g[transform]")
        .evaluateAll((groups) =>
          groups.flatMap((g) =>
            [...g.querySelectorAll("path")].map((p) => p.getAttribute("d")),
          ),
        ),
    ).toEqual(paths);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "экспорт svg" }).click();
    await (await dl).saveAs(`../artifacts/catalog-${palette}.svg`);
    await page.screenshot({ path: `../artifacts/catalog-${palette}.png` });
    await page
      .getByRole("combobox", { name: "формат композиции" })
      .selectOption(["portrait", "landscape", "square"][i]);
    await expect(page.locator(".layer-row")).toHaveCount(20);
    const clipped = await page.locator(".artboard").evaluate((svg) => {
      const vb = (svg as SVGSVGElement).viewBox.baseVal;
      return [...svg.querySelectorAll(":scope > g > g[transform]")].some(
        (g) => {
          const b = (g as SVGGraphicsElement).getBBox(),
            m = (g as SVGGraphicsElement).transform.baseVal.consolidate()!
              .matrix;
          const corners = [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x, b.y + b.height],
            [b.x + b.width, b.y + b.height],
          ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
          return corners.some(
            (p) =>
              p.x < -0.1 ||
              p.y < -0.1 ||
              p.x > vb.width + 0.1 ||
              p.y > vb.height + 0.1,
          );
        },
      );
    });
    expect(clipped).toBe(false);
  }
});
test("блокировка защищает от удаления и перестановки, скрытый слой остается в экспорте", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page.locator(".layer-select").first().click();
  const active = page.locator(".layer-row.active"),
    id = await active.getAttribute("data-layer");
  await page.getByRole("button", { name: "блокировка слоя" }).click();
  await expect(
    page.getByRole("button", { name: "удалить объект" }),
  ).toBeDisabled();
  await expect(active.locator(".layer-select")).toHaveAttribute(
    "draggable",
    "false",
  );
  await page.keyboard.press("Delete");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await active.getByRole("button", { name: "скрыть слой" }).click();
  await expect(page.locator(".selection")).toHaveCount(0);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "экспорт svg" }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  let svg = "";
  for await (const chunk of stream!) svg += chunk.toString();
  expect(svg).toContain(`id="layer-${id}" display="none"`);
  expect(svg).not.toContain("canvas-clip");
  await page.getByRole("button", { name: "блокировка слоя" }).click();
  await active.getByRole("button", { name: "показать слой" }).click();
  await page.getByRole("button", { name: "удалить объект" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(2);
});
test("перенос проекта в чистый браузер сохраняет название, предыдущие результаты и свою палитру", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page
    .locator('input[type=file][accept=".svg,image/svg+xml"]')
    .setInputFiles({
      name: "звезда.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 0L100 100H0Z" fill="#f99366"/></svg>',
      ),
    });
  await page.getByRole("button", { name: "из объектов", exact: true }).click();
  await page
    .getByRole("button", { name: "выбрать звезда для генерации" })
    .click();
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("мой результат");
  await page.getByRole("button", { name: "собрать композицию" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  const palette = {
    strong: "#36563a",
    medium: "#8aa887",
    light: "#e0efdc",
    highlight: "#ffe299",
    pink: "#e99daa",
    soft: "#f5dce1",
  };
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .first()
    .setInputFiles({
      name: "palette.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(palette)),
    });
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "сохранить проект json" }).click();
  const project = await dl;
  await project.saveAs("/tmp/syravec-complete.json");
  const fresh = await browser.newContext();
  const tab = await fresh.newPage();
  await tab.goto("/");
  await tab
    .locator('input[type=file][accept=".json,application/json"]')
    .last()
    .setInputFiles("/tmp/syravec-complete.json");
  await expect(tab.locator(".layer-row")).toHaveCount(1);
  await expect(tab.locator(".history-row")).toContainText(
    "знания открывают двери",
  );
  expect(await tab.locator(".artboard").innerHTML()).toContain("#e0efdc");
  await tab
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await expect(tab.locator(".generation-record")).toContainText(
    "мой результат",
  );
  await tab.getByRole("button", { name: "открыть результат" }).click();
  await expect(tab.locator(".layer-row")).toContainText("звезда");
  expect(await tab.locator(".artboard").innerHTML()).toContain("#f99366");
  await fresh.close();
});
test("настоящая связка с go возвращает разные шаблонные компоновки строго выбранного набора", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "из объектов", exact: true }).click();
  for (const name of ["Книга", "Телефон", "Пазлы"])
    await page
      .getByRole("button", { name: `выбрать ${name} для генерации` })
      .click();
  const results: any[] = [];
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/v1/compositions") && r.ok())
      results.push(await r.json());
  });
  await page.getByRole("button", { name: "собрать композицию" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await page.getByRole("button", { name: "собрать композицию" }).click();
  await expect.poll(() => results.length).toBe(2);
  expect(results[0].generation.source).toBe("fallback");
  expect(results[0].scene.layers.map((l: any) => l.assetId).sort()).toEqual([
    "book-main",
    "phone-main",
    "puzzle-main",
  ]);
  expect(results[0].scene.layers.map((l: any) => [l.x, l.y])).not.toEqual(
    results[1].scene.layers.map((l: any) => [l.x, l.y]),
  );
  await page
    .getByRole("button", { name: "история генераций", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "открыть результат" }),
  ).toHaveCount(2);
});
