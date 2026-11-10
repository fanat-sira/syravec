import { test, expect } from "@playwright/test";
import { seedScene } from "./helpers";
test("источники реально меняются, шесть холстов и фиксированный размер объектов", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "добавить Телефон на холст", exact: true })
    .click();
  const group = page.locator(".artboard [data-layer-id]");
  const id = await group.getAttribute("data-layer-id");
  const largePaths = await group
    .locator("path")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("d")));
  await page.getByRole("button", { name: "композиция", exact: true }).click();
  const choose = page.getByRole("combobox", { name: "размер иллюстраций" });
  await choose.selectOption("small");
  await expect(choose).toHaveValue("small");
  await expect(group).toHaveAttribute("data-layer-id", id!);
  const smallPaths = await group
    .locator("path")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("d")));
  expect(smallPaths).not.toEqual(largePaths);
  expect(await group.getAttribute("transform")).not.toContain("scale(");
  await page.keyboard.press("Control+z");
  await expect(choose).toHaveValue("large");
  expect(
    await group
      .locator("path")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("d"))),
  ).toEqual(largePaths);
  for (const size of ["large", "small"]) {
    await choose.selectOption(size);
    for (const [preset, largeW, largeH, smallW, smallH] of [
      ["square", 1000, 1000, 500, 500],
      ["landscape", 1000, 633, 500, 317],
      ["portrait", 750, 1000, 375, 500],
    ] as const) {
      await page
        .getByRole("combobox", { name: "формат композиции" })
        .selectOption(preset);
      const w = size === "large" ? largeW : smallW,
        h = size === "large" ? largeH : smallH;
      await expect(page.locator(".artboard")).toHaveAttribute(
        "viewBox",
        `0 0 ${w} ${h}`,
      );
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "экспорт svg", exact: true })
        .click();
      const file = await pending;
      let xml = "";
      for await (const chunk of (await file.createReadStream())!)
        xml += chunk.toString();
      expect(xml).toContain(`viewBox="0 0 ${w} ${h}"`);
      expect(xml).not.toContain("<image");
      expect(xml).not.toContain('class="selection');
      expect(xml).toContain(
        `viewBox="0 0 ${size === "large" ? 1000 : 500} ${size === "large" ? 1000 : 500}"`,
      );
      expect(xml).toContain('preserveAspectRatio="xMidYMid slice"');
      const pixelDifference = await page.locator(".artboard").evaluate(
        async (node, { xml, w, h }) => {
          const preview = node.cloneNode(true) as SVGSVGElement;
          preview.querySelectorAll(".selection").forEach((e) => e.remove());
          preview.setAttribute("width", String(w));
          preview.setAttribute("height", String(h));
          preview.setAttribute("overflow", "hidden");
          const pixels = async (source: string) => {
            const image = new Image();
            const url = URL.createObjectURL(
              new Blob([source], { type: "image/svg+xml" }),
            );
            try {
              image.src = url;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = 200;
              canvas.height = Math.round((200 * h) / w);
              const context = canvas.getContext("2d")!;
              context.drawImage(image, 0, 0, canvas.width, canvas.height);
              return context.getImageData(0, 0, canvas.width, canvas.height)
                .data;
            } finally {
              URL.revokeObjectURL(url);
            }
          };
          const [a, b] = await Promise.all([
            pixels(new XMLSerializer().serializeToString(preview)),
            pixels(xml),
          ]);
          return (
            a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) /
            a.length
          );
        },
        { xml, w, h },
      );
      expect(pixelDifference).toBeLessThan(0.01);
    }
  }
});
test("масштаб старого проекта мигрирует, пользовательский SVG не получает фиктивный второй набор", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".asset-card").first().waitFor();
  const legacy = {
    version: 1,
    canvas: { width: 1000, height: 1000, preset: "square" },
    palette: "violet",
    backgroundId: "background-square-violet",
    layers: [
      {
        id: "old",
        assetId: "phone-main",
        x: 0.4,
        y: 0.5,
        scale: 5,
        rotation: 12,
        opacity: 0.7,
        visible: true,
        locked: false,
      },
    ],
  };
  await seedScene(page, legacy);
  await page.locator(".layer-select").first().click();
  await expect(
    page.getByRole("slider", { name: "масштаб", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[aria-label="изменить размер"]')).toHaveCount(0);
  expect(
    await page.locator(".artboard [data-layer-id]").getAttribute("transform"),
  ).not.toContain("scale(");
  await page
    .locator('input[type=file][accept=".svg,image/svg+xml"]')
    .setInputFiles({
      name: "custom.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0H100V50H0Z"/></svg>',
      ),
    });
  await page.getByRole("button", { name: "композиция", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "размер иллюстраций" }),
  ).toBeDisabled();
  await expect(page.locator(".properties")).toContainText(
    "нет альтернативного набора",
  );
});
