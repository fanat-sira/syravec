import { test, expect } from "@playwright/test";
import { seedScene } from "./helpers";
test("generation ignores model tilt, recomposition preserves manual angles and undo", async ({
  page,
}) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { aiConfigured: true } }),
  );
  await page.goto("/");
  const scene = {
    version: 2,
    illustrationSize: "large",
    canvas: { width: 1000, height: 1000, preset: "square" },
    palette: "violet",
    backgroundId: "background-square-violet",
    layers: [
      {
        id: "first",
        assetId: "book-main",
        x: 0.3,
        y: 0.4,
        rotation: 35,
        opacity: 1,
        visible: true,
        locked: false,
      },
      {
        id: "second",
        assetId: "book-main",
        x: 0.7,
        y: 0.7,
        rotation: -22,
        opacity: 0.8,
        visible: true,
        locked: false,
      },
    ],
  };
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await seedScene(page, scene);
  await expect(page.locator(".layer-row")).toHaveCount(2);
  await page.route("**/api/v1/compositions", (route) =>
    route.fulfill({
      json: {
        scene: {
          ...scene,
          layers: scene.layers.map((l, i) => ({
            ...l,
            id: "generated-" + i,
            x: 0.4 + i * 0.2,
            rotation: 90,
          })),
        },
        generation: { source: "llm", warnings: [] },
      },
    }),
  );
  await page.getByRole("button", { name: /перекомпоновать объекты/ }).click();
  const transforms = () =>
    page
      .locator(".artboard > g > g[transform]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("transform")));
  await expect
    .poll(transforms)
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining("translate(400 400) rotate(35)"),
        expect.stringContaining("rotate(-22)"),
      ]),
    );
  await page.keyboard.press("Control+z");
  await expect
    .poll(transforms)
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining("translate(300 400) rotate(35)"),
      ]),
    );
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("поверни книги на 90 градусов");
  await page
    .getByRole("button", { name: "собрать композицию", exact: true })
    .click();
  await expect
    .poll(transforms)
    .toEqual([
      expect.stringContaining("rotate(0)"),
      expect.stringContaining("rotate(0)"),
    ]);
  await page.locator(".layer-select").first().click();
  const angle = page.getByRole("slider", { name: "поворот", exact: true });
  await angle.fill("47");
  await expect
    .poll(transforms)
    .toEqual(expect.arrayContaining([expect.stringContaining("rotate(47)")]));
  await page.reload();
  await expect
    .poll(transforms)
    .toEqual(expect.arrayContaining([expect.stringContaining("rotate(47)")]));
});
