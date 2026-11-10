import { seedScene } from "./helpers";
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
  await seedScene(page, scene);
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
