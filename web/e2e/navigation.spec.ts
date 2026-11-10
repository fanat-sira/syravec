import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
test("syravec, единый пазл в логотипе и favicon", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("syravec");
  await expect(page.locator(".brand")).toHaveText("syravec");
  await expect(page.locator(".brand svg")).toHaveCount(1);
  const url = await page.locator("link[rel=icon]").getAttribute("href");
  const response = await page.request.get(url!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("<path");
  expect(await response.text()).not.toContain("<image");
});
test("размеры секций, жесткие минимумы и неподвижный заголовок свернутых слоев", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const library = page.locator(".section-library"),
    layers = page.locator(".section-layers"),
    properties = page.locator(".section-properties"),
    heading = layers.locator(".section-heading");
  await page.locator(".asset-grid").evaluate((el) => (el.scrollTop = 100));
  const scroll = await page
    .locator(".asset-grid")
    .evaluate((el) => el.scrollTop);
  const before = {
    library: (await library.boundingBox())!,
    layers: (await layers.boundingBox())!,
    properties: (await properties.boundingBox())!,
    heading: (await heading.boundingBox())!,
  };
  await heading.click();
  expect(await library.boundingBox()).toEqual(before.library);
  expect((await heading.boundingBox())!.y).toBe(before.heading.y);
  expect((await layers.boundingBox())!.height).toBe(41);
  expect((await properties.boundingBox())!.height).toBeCloseTo(
    before.properties.height + before.layers.height - 41,
    0,
  );
  expect(await page.locator(".asset-grid").evaluate((el) => el.scrollTop)).toBe(
    scroll,
  );
  await heading.click();
  expect((await layers.boundingBox())!.height).toBeCloseTo(
    before.layers.height,
    0,
  );
  const split = page.getByRole("separator", { name: "высота библиотеки" }),
    box = (await split.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 50, {
    steps: 5,
  });
  await page.mouse.up();
  expect((await library.boundingBox())!.height).toBeCloseTo(
    before.library.height + 50,
    0,
  );
  expect((await properties.boundingBox())!.height).toBeCloseTo(
    before.properties.height,
    0,
  );
  const second = page.getByRole("separator", { name: "высота слоев" }),
    b = (await second.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 1000, { steps: 5 });
  await page.mouse.up();
  expect((await properties.boundingBox())!.height).toBe(120);
  await second.focus();
  await page.keyboard.press("ArrowUp");
  expect((await properties.boundingBox())!.height).toBe(136);
  await page.screenshot({ path: "../artifacts/resizable-inspector.png" });
});
test("пробел с левой кнопкой и средняя кнопка перемещают только вид, фон снимает выделение", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page.locator(".layer-select").first().click();
  const x = page.getByRole("spinbutton", { name: "позиция x" }),
    initial = await x.inputValue();
  const art = page.locator(".artboard"),
    before = (await art.boundingBox())!;
  const point = {
    x: before.x + before.width * 0.76,
    y: before.y + before.height * 0.7,
  };
  const downloadBefore = page.waitForEvent("download");
  await page.getByRole("button", { name: "экспорт svg", exact: true }).click();
  const first = await downloadBefore;
  const firstResponse = await first.createReadStream();
  let initialSVG = "";
  for await (const chunk of firstResponse!) initialSVG += chunk.toString();
  await page.keyboard.down("Space");
  await expect(page.locator(".scene-viewport")).toHaveClass(/pan-ready/);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 45, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  let moved = (await art.boundingBox())!;
  expect(moved.x).toBeCloseTo(before.x + 70, 0);
  expect(moved.y).toBeCloseTo(before.y + 45, 0);
  expect(await x.inputValue()).toBe(initial);
  await expect(page.locator(".selection")).toHaveCount(1);
  await page.mouse.move(point.x + 70, point.y + 45);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(point.x + 35, point.y + 70, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  moved = (await art.boundingBox())!;
  expect(moved.x).toBeCloseTo(before.x + 35, 0);
  expect(moved.y).toBeCloseTo(before.y + 70, 0);
  expect(await x.inputValue()).toBe(initial);
  const downloadAfter = page.waitForEvent("download");
  await page.getByRole("button", { name: "экспорт svg", exact: true }).click();
  const second = await downloadAfter;
  const stream = await second.createReadStream();
  let finalSVG = "";
  for await (const chunk of stream!) finalSVG += chunk.toString();
  expect(finalSVG).toBe(initialSVG);
  const viewport = (await page.locator(".scene-viewport").boundingBox())!;
  await page.mouse.click(viewport.x + 5, viewport.y + 5);
  await expect(page.locator(".selection")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "формат композиции" }),
  ).toBeVisible();
  await page.getByTitle("вписать композицию").click();
  expect((await art.boundingBox())!.x).toBeCloseTo(before.x, 0);
  expect((await art.boundingBox())!.y).toBeCloseTo(before.y, 0);
  const input = page.getByRole("textbox", { name: "описание композиции" });
  await input.fill("один");
  await input.press("Space");
  await expect(input).toHaveValue("один ");
  await expect(page.locator(".scene-viewport")).not.toHaveClass(/pan-ready/);
});
