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
  await expect(
    page.getByRole("button", { name: "собрать композицию" }),
  ).toBeVisible();
  await expect(page.locator(".history-row.active")).toContainText(
    "своё название",
  );
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
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("черновик");
  await page
    .getByRole("button", { name: "новая композиция", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "описание композиции" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "описание композиции" }),
  ).toHaveAttribute("placeholder", "идея иллюстрации или названия объектов");
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
