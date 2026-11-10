import { test, expect, type Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { status: "ok", aiConfigured: false } }),
  );
});
const sizes = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
];
async function fixedFrame(page: Page) {
  const result = await page.evaluate(() => {
    const root = document.documentElement,
      body = document.body;
    const nodes = [
      ".main-shell",
      ".composer",
      'textarea[aria-label="описание композиции"]',
      ".generate",
    ];
    return {
      width: innerWidth,
      height: innerHeight,
      rootWidth: root.scrollWidth,
      rootHeight: root.scrollHeight,
      bodyHeight: body.scrollHeight,
      rects: nodes.map((q) => {
        const r = document.querySelector(q)!.getBoundingClientRect();
        return {
          selector: q,
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
        };
      }),
    };
  });
  expect(result.rootWidth).toBeLessThanOrEqual(result.width);
  expect(result.rootHeight).toBeLessThanOrEqual(result.height);
  expect(result.bodyHeight).toBeLessThanOrEqual(result.height);
  for (const r of result.rects) {
    expect(r.top, r.selector).toBeGreaterThanOrEqual(0);
    expect(r.bottom, r.selector).toBeLessThanOrEqual(result.height);
    expect(r.left, r.selector).toBeGreaterThanOrEqual(0);
    expect(r.right, r.selector).toBeLessThanOrEqual(result.width);
    expect(r.height, r.selector).toBeGreaterThan(20);
  }
}
for (const size of sizes)
  test(`фиксированный интерфейс ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "что соберем?" }),
    ).toBeVisible();
    await fixedFrame(page);
    if (size.height <= 440) {
      await page
        .getByRole("textbox", { name: "описание композиции" })
        .fill("образование");
      await page.getByRole("button", { name: "собрать композицию" }).click();
    } else
      await page
        .getByRole("button", { name: /знания открывают двери/ })
        .click();
    await expect(page.locator(".artboard")).toBeVisible();
    await fixedFrame(page);
    const canvas = await page.locator(".canvas-area").boundingBox(),
      art = await page.locator(".artboard").boundingBox();
    expect(art!.height).toBeGreaterThan(20);
    expect(art!.height).toBeLessThanOrEqual(canvas!.height);
    expect(art!.width).toBeLessThanOrEqual(canvas!.width);
    // opening a saved composition must preserve the same viewport bounds
    await page.reload();
    await expect(page.locator(".artboard")).toBeVisible();
    await fixedFrame(page);
    await page
      .getByRole("textbox", { name: "описание композиции" })
      .fill("длинный запрос\n".repeat(70));
    await fixedFrame(page);
    await page.locator(".scene-viewport").hover({ position: { x: 8, y: 100 } });
    await page.mouse.wheel(0, 800);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    if (size.width === 1440)
      await page.screenshot({ path: "../artifacts/layout-editor.png" });
    if (size.width === 390)
      await page.screenshot({ path: "../artifacts/layout-mobile.png" });
  });
test("прокрутка сообщений остается внутри чата", async ({ page }) => {
  await page.route("**/api/v1/compositions", (r) =>
    r.fulfill({
      json: {
        scene: {
          version: 1,
          canvas: { width: 1000, height: 1000, preset: "square" },
          palette: "violet",
          backgroundId: "background-square-violet",
          layers: [
            {
              id: "one",
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
        },
        generation: { source: "fallback", warnings: [] },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  for (let i = 0; i < 8; i++) {
    await page
      .getByRole("textbox", { name: "описание композиции" })
      .fill(`запрос ${i}`);
    await page.getByRole("button", { name: "собрать композицию" }).click();
    await expect(
      page.getByRole("button", { name: "собрать композицию" }),
    ).toBeVisible();
  }
  const chat = page.locator(".conversation");
  expect(await chat.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await chat.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await chat.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await chat.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await fixedFrame(page);
  const text = await page.locator(".app").innerText();
  for (const banned of [
    "всегда вектор",
    "из готового в новое",
    "исходные векторы",
    "твои сочетания",
    "это пример композиции",
    "маленькая студия",
    "сделай по-своему",
    "новые объекты не рисуем",
    "собрала по шаблону",
  ])
    expect(text).not.toContain(banned);
});
