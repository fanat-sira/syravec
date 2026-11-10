import { type Scene, type Asset, type Project, type Generation } from "./model";
import { sanitize, parsePalette } from "./svg";
export function validateScene(raw: unknown, assets: Asset[]): Scene {
  const s = raw as Scene;
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
  const customPalette =
    s.customPalette === undefined
      ? undefined
      : parsePalette(JSON.stringify(s.customPalette));
  if (s.palette === "custom" && !customPalette)
    throw Error("в проекте отсутствует пользовательская палитра");
  const ids = new Set<string>();
  const layers = s.layers.map((l) => {
    if (
      !l ||
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
    if (l.role !== undefined && !["focal", "support", "decor"].includes(l.role))
      throw Error("неизвестная роль объекта");
    return {
      id: l.id,
      assetId: l.assetId,
      x: l.x,
      y: l.y,
      scale: l.scale,
      rotation: l.rotation,
      opacity: l.opacity,
      visible: l.visible,
      locked: l.locked,
      ...(l.role ? { role: l.role } : {}),
    };
  });
  if (
    typeof s.backgroundId !== "string" ||
    (s.backgroundId &&
      !/^background-(square|landscape)-(violet|teal|warm)$/.test(
        s.backgroundId,
      ))
  )
    throw Error("неизвестный фон");
  return {
    version: 1,
    canvas: {
      width: s.canvas.width,
      height: s.canvas.height,
      preset: s.canvas.preset,
    },
    palette: s.palette,
    ...(customPalette ? { customPalette } : {}),
    backgroundId: s.backgroundId,
    layers,
  };
}
export function readProject(
  raw: unknown,
  assets: Asset[],
): {
  scene: Scene;
  customAssets: Asset[];
  title?: string;
  messages?: Project["messages"];
  generations?: Generation[];
} {
  const x = raw as {
    format?: string;
    version?: number;
    scene?: Scene;
    customAssets?: Asset[];
    title?: string;
    messages?: Project["messages"];
    generations?: Generation[];
  };
  if (
    !x ||
    (x.format !== undefined &&
      (x.format !== "syravec-project" || x.version !== 1))
  )
    throw Error("неподдерживаемая версия проекта");
  const customAssets: Asset[] = [];
  if (x.customAssets !== undefined) {
    if (!Array.isArray(x.customAssets) || x.customAssets.length > 200)
      throw Error("слишком много своих объектов");
    const seen = new Set<string>();
    for (const a of x.customAssets) {
      if (
        !a ||
        typeof a.id !== "string" ||
        !/^custom-[-\w]+$/.test(a.id) ||
        seen.has(a.id) ||
        typeof a.svg !== "string" ||
        typeof a.displayName !== "string"
      )
        throw Error("неверный свой объект");
      seen.add(a.id);
      const clean = sanitize(a.svg),
        existing = assets.find((v) => v.id === a.id);
      if (existing && existing.svg !== clean.svg)
        throw Error("конфликт идентификаторов своих объектов");
      if (!existing)
        customAssets.push({
          id: a.id,
          svg: clean.svg,
          viewBox: clean.viewBox,
          displayName: a.displayName.slice(0, 80),
          assetUrl: "",
          variant: "main",
          tags: [],
        });
    }
  }
  const known = [...assets, ...customAssets],
    scene = validateScene(x.scene, known);
  if (x.title !== undefined && typeof x.title !== "string")
    throw Error("неверное название проекта");
  if (
    x.messages !== undefined &&
    (!Array.isArray(x.messages) ||
      x.messages.length > 2000 ||
      x.messages.some(
        (m) =>
          !m ||
          !["user", "assistant"].includes(m.role) ||
          typeof m.text !== "string" ||
          m.text.length > 4000,
      ))
  )
    throw Error("неверная история запросов");
  if (
    x.generations !== undefined &&
    (!Array.isArray(x.generations) || x.generations.length > 30)
  )
    throw Error("неверная история генераций");
  const generations = x.generations?.map((g) => {
    if (
      !g ||
      typeof g.id !== "string" ||
      typeof g.prompt !== "string" ||
      g.prompt.length > 2000 ||
      !["concept", "selection"].includes(g.mode) ||
      !["llm", "fallback"].includes(g.source) ||
      !["success", "error", "cancelled"].includes(g.status) ||
      !Number.isFinite(g.createdAt)
    )
      throw Error("неверная запись генерации");
    if (g.status === "success" && !g.scene)
      throw Error("нет результата генерации");
    return {
      id: g.id,
      prompt: g.prompt,
      mode: g.mode,
      source: g.source,
      status: g.status,
      createdAt: g.createdAt,
      ...(g.scene ? { scene: validateScene(g.scene, known) } : {}),
      ...(typeof g.error === "string" ? { error: g.error.slice(0, 2000) } : {}),
    };
  });
  return {
    scene,
    customAssets,
    ...(x.title !== undefined ? { title: x.title.slice(0, 120) } : {}),
    ...(x.messages
      ? { messages: x.messages.map((m) => ({ role: m.role, text: m.text })) }
      : {}),
    ...(generations ? { generations } : {}),
  };
}
export function validateProject(raw: unknown, assets: Asset[]): Scene {
  return readProject(raw, assets).scene;
}
export function serializeProject(
  project: Project,
  customAssets: Asset[],
): string {
  const required = new Set(
    [
      ...project.scene.layers,
      ...(project.generations ?? []).flatMap((g) => g.scene?.layers ?? []),
    ].map((l) => l.assetId),
  );
  const text = JSON.stringify(
    {
      format: "syravec-project",
      version: 1,
      title: project.title,
      scene: project.scene,
      messages: project.messages,
      generations: project.generations ?? [],
      customAssets: customAssets.filter((a) => required.has(a.id)),
    },
    null,
    2,
  );
  if (new Blob([text]).size > 32e6) throw Error("проект превышает 32 мб");
  return text;
}
