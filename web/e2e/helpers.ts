import { expect, type Page } from "@playwright/test";
// Seed only this test's isolated browser; project import is no longer a UI action.
export async function seedScene(page: Page, scene: unknown) {
  // Leave the running app before replacing IndexedDB, so its queued persistence
  // cannot overwrite this fixture while the new page is hydrating.
  await page.goto("/assets/manifest.json");
  await page.evaluate(async (scene) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("syravec", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("state", "readwrite");
      t.objectStore("state").put(
        JSON.stringify({
          state: {
            projects: [
              {
                id: "fixture",
                title: "тестовая композиция",
                scene,
                messages: [],
                generations: [],
                updatedAt: Date.now(),
              },
            ],
            current: "fixture",
            customAssets: [],
          },
          version: 0,
        }),
        "projects",
      );
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    db.close();
  }, scene);
  await page.goto("/");
  await expect(page.locator(".artboard")).toBeVisible();
}
