import { test, expect } from "@playwright/test";
import { seedScene } from "./helpers";
const scene = {
  version: 2,
  illustrationSize: "large",
  canvas: { width: 1000, height: 1000, preset: "square" },
  palette: "violet",
  backgroundId: "background-square-violet",
  layers: [
    {
      id: "book",
      assetId: "book-main",
      x: 0.5,
      y: 0.5,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    },
  ],
};
test("request survives project switches and reload without changing the job ID", async ({
  page,
}) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { aiConfigured: true } }),
  );
  let ready = false;
  const ids: string[] = [];
  await page.route("**/api/v1/compositions", async (r) => {
    ids.push(r.request().headers()["x-composition-job"]);
    await r.fulfill({ status: 202, json: { status: "pending" } });
  });
  await page.route("**/api/v1/compositions/*", (r) =>
    r.fulfill(
      ready
        ? { json: { scene, generation: { source: "llm", warnings: [] } } }
        : { status: 202, json: { status: "pending" } },
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  const input = page.getByRole("textbox", { name: "описание композиции" });
  await input.fill("светлая идея");
  await page
    .getByRole("button", { name: "собрать композицию", exact: true })
    .click();
  await expect.poll(() => ids.length).toBe(1);
  await page
    .getByRole("button", { name: "новая композиция", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await page.locator(".history-row > button:first-child").first().click();
  await expect(input).toHaveValue("светлая идея");
  await expect(
    page.getByRole("button", { name: "остановить сборку" }),
  ).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue("светлая идея");
  await expect.poll(() => ids.length).toBe(2);
  expect(ids[1]).toBe(ids[0]);
  ready = true;
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(input).toHaveValue("");
  await page.reload();
  await expect(page.locator(".layer-row")).toHaveCount(1);
});
test("composer has no inset outline; selection extends past artboard and viewport clips tools", async ({
  page,
}) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { aiConfigured: false } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await seedScene(page, {
    ...scene,
    layers: [{ ...scene.layers[0], x: 0, y: 0.05 }],
  });
  await page.locator(".layer-select").first().click();
  await page.getByRole("textbox", { name: "описание композиции" }).focus();
  const result = await page.evaluate(() => {
    const input = document.querySelector(".composer textarea")!;
    const board = document.querySelector(".artboard")!;
    const selection = document.querySelector(".selection")!;
    const viewport = document.querySelector(".scene-viewport")!;
    return {
      outline: getComputedStyle(input).outlineStyle,
      svgOverflow: getComputedStyle(board).overflow,
      viewportOverflow: getComputedStyle(viewport).overflow,
      outside:
        selection.getBoundingClientRect().left <
        board.getBoundingClientRect().left,
    };
  });
  expect(result).toEqual({
    outline: "none",
    svgOverflow: "visible",
    viewportOverflow: "hidden",
    outside: true,
  });
  await page.screenshot({ path: "../artifacts/selection-overflow.png" });
});

test("completed background request updates only its own project", async ({
  page,
}) => {
  await page.route("**/api/v1/health", (r) =>
    r.fulfill({ json: { aiConfigured: true } }),
  );
  let ready = false,
    polling = false;
  await page.route("**/api/v1/compositions", (r) =>
    r.fulfill({ status: 202, json: { status: "pending" } }),
  );
  await page.route("**/api/v1/compositions/*", (r) => {
    polling = true;
    return r.fulfill(
      ready
        ? { json: { scene, generation: { source: "llm", warnings: [] } } }
        : { status: 202, json: { status: "pending" } },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: /знания открывают двери/ }).click();
  await page
    .getByRole("textbox", { name: "описание композиции" })
    .fill("спокойная работа");
  await page
    .getByRole("button", { name: "собрать композицию", exact: true })
    .click();
  await expect.poll(() => polling).toBe(true);
  await page
    .getByRole("button", { name: "новая композиция", exact: true })
    .click();
  ready = true;
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("syravec", 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const state = await new Promise<any>((resolve, reject) => {
          const r = db
            .transaction("state")
            .objectStore("state")
            .get("projects");
          r.onsuccess = () => resolve(JSON.parse(r.result).state);
          r.onerror = () => reject(r.error);
        });
        db.close();
        return (
          state.projects[0].pending === undefined &&
          state.projects[0].scene.layers.length === 1
        );
      }),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "что соберем?" }),
  ).toBeVisible();
  await page.locator(".history-row > button:first-child").first().click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "описание композиции" }),
  ).toHaveValue("");
});
