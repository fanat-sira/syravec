import { type Scene, type Asset } from "./model";
import { sanitize, parsePalette } from "./svg";
export function readProject(
  raw: unknown,
  assets: Asset[],
): { scene: Scene; customAssets: Asset[] } {
  const x = raw as { scene?: Scene; customAssets?: Asset[] };
  const s = x?.scene;
  const customAssets: Asset[] = [];
  if (x?.customAssets !== undefined) {
    if (!Array.isArray(x.customAssets) || x.customAssets.length > 40)
      throw Error("слишком много своих объектов");
    const seen = new Set<string>();
    for (const a of x.customAssets) {
      if (
        typeof a.id !== "string" ||
        !/^custom-[-\w]+$/.test(a.id) ||
        seen.has(a.id) ||
        typeof a.svg !== "string" ||
        typeof a.displayName !== "string"
      )
        throw Error("неверный свой объект");
      seen.add(a.id);
      const clean = sanitize(a.svg);
      const existing = assets.find((v) => v.id === a.id);
      if (existing && existing.svg !== clean.svg)
        throw Error("конфликт идентификаторов своих объектов");
      if (!existing)
        customAssets.push({
          ...a,
          svg: clean.svg,
          viewBox: clean.viewBox,
          displayName: a.displayName.slice(0, 80),
          assetUrl: "",
          variant: "main",
          tags: [],
        });
    }
  }
  assets = [...assets, ...customAssets];
  if (
    !s ||
    s.version !== 1 ||
    !s.canvas ||
    !["square", "landscape", "portrait"].includes(s.canvas.preset) ||
    ![s.canvas.width, s.canvas.height].every(
      (n) => Number.isFinite(n) && n >= 100 && n <= 4000,
    ) ||
    !["violet", "teal", "warm", "custom"].includes(s.palette) ||
    !Array.isArray(s.layers) ||
    s.layers.length > 40
  )
    throw Error("неподдерживаемый формат проекта");
  if (s.palette === "custom") {
    s.customPalette = parsePalette(JSON.stringify(s.customPalette));
  }
  const ids = new Set<string>();
  for (const l of s.layers) {
    if (
      typeof l.id !== "string" ||
      !/^[-\w]+$/.test(l.id) ||
      ids.has(l.id) ||
      !assets.some((a) => a.id === l.assetId) ||
      ![l.x, l.y, l.scale, l.rotation, l.opacity].every(Number.isFinite) ||
      l.x < -0.2 ||
      l.x > 1.2 ||
      l.y < -0.2 ||
      l.y > 1.2 ||
      l.scale < 0.1 ||
      l.scale > 6 ||
      Math.abs(l.rotation) > 3600 ||
      l.opacity < 0 ||
      l.opacity > 1 ||
      typeof l.visible !== "boolean" ||
      typeof l.locked !== "boolean"
    )
      throw Error("проект содержит неизвестные объекты или неверные параметры");
    ids.add(l.id);
  }
  if (
    s.backgroundId &&
    !/^background-(square|landscape)-(violet|teal|warm)$/.test(s.backgroundId)
  )
    throw Error("неизвестный фон");
  return { scene: structuredClone(s), customAssets };
}

export function validateProject(raw: unknown, assets: Asset[]): Scene {
  return readProject(raw, assets).scene;
}
