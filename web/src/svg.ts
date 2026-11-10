import DOMPurify from "dompurify";
import {
  palettes,
  transform,
  type Asset,
  type Scene,
  type Palette,
} from "./model";
const NS = "http://www.w3.org/2000/svg";
const allowed = new Set(
  "svg g path rect circle ellipse line polyline polygon defs clipPath mask linearGradient radialGradient stop pattern use title desc text tspan".split(
    " ",
  ),
);
export function sanitize(raw: string): { svg: string; viewBox: number[] } {
  if (raw.length > 2_000_000) throw Error("svg слишком большой, максимум 2 мб");
  if (/<!DOCTYPE|<!ENTITY/i.test(raw))
    throw Error("svg с внешними сущностями не поддерживается");
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw Error("не удалось прочитать svg");
  const root = doc.documentElement;
  if (
    root.querySelectorAll("*").length > 10000 ||
    root.querySelectorAll("use").length > 250
  )
    throw Error("svg слишком сложный для загрузки");
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (
      (el.namespaceURI && el.namespaceURI !== NS) ||
      !allowed.has(el.localName)
    )
      throw Error(
        `элемент ${el.localName.toLowerCase()} не поддерживается, нужен статический векторный svg`,
      );
    for (const at of [...el.attributes]) {
      const name = at.localName.toLowerCase(),
        v = at.value;
      if (/\\|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))
        throw Error(
          "экранированные или управляющие символы в атрибутах не поддерживаются",
        );
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "class" ||
        name === "base" ||
        name === "src"
      )
        throw Error(
          "svg содержит стили или активное содержимое, сохрани файл с атрибутами представления",
        );
      if (name === "href" && !/^#[\w:.-]+$/.test(v))
        throw Error("внешние ссылки в svg не поддерживаются");
      if (/url\s*\(/i.test(v) && !/^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/i.test(v))
        throw Error("внешние ресурсы в svg не поддерживаются");
    }
  }
  const vb = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number) ?? [
    0,
    0,
    parseFloat(root.getAttribute("width") || ""),
    parseFloat(root.getAttribute("height") || ""),
  ];
  if (
    vb.length !== 4 ||
    !vb.every(Number.isFinite) ||
    vb[2] <= 0 ||
    vb[3] <= 0 ||
    vb.some((x) => Math.abs(x) > 1e7)
  )
    throw Error("нужен корректный viewbox или размеры svg");
  const svg = DOMPurify.sanitize(new XMLSerializer().serializeToString(root), {
    USE_PROFILES: { svg: true, svgFilters: false },
    ADD_TAGS: ["use"],
    ADD_ATTR: ["href"],
  });
  return { svg, viewBox: vb };
}
export function paletteFor(s: Scene): Palette {
  return s.palette === "custom" && s.customPalette
    ? s.customPalette
    : (palettes.find((p) => p.id === s.palette) ?? palettes[0]);
}
export function markup(
  raw: string,
  prefix: string,
  p: Palette,
  recolor = true,
): string {
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml"),
    root = doc.documentElement;
  const ids = new Map<string, string>();
  root.querySelectorAll("[id]").forEach((el) => {
    const old = el.id;
    ids.set(old, `${prefix}-${ids.size}`);
    el.id = ids.get(old)!;
  });
  const colors: Record<string, string> = {
    "#7864d7": p.strong,
    "#aa9bf0": p.medium,
    "#d7cdf5": p.light,
    "#f9ecb0": p.highlight,
    "#f9a3aa": p.pink,
    "#ffe3e1": p.soft,
  };
  for (const el of [root, ...root.querySelectorAll("*")])
    for (const at of [...el.attributes]) {
      if (at.name === "id") continue;
      let v = at.value.replace(
        /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g,
        (_, id) => `url(#${ids.get(id) ?? prefix + "-missing"})`,
      );
      if (at.localName === "href" && v.startsWith("#"))
        v = "#" + (ids.get(v.slice(1)) ?? prefix + "-missing");
      if (
        recolor &&
        ["fill", "stroke", "stop-color", "color"].includes(at.localName)
      )
        v = colors[v.toLowerCase()] ?? v;
      el.setAttribute(at.name, v);
    }
  const g = doc.createElementNS(NS, "g");
  // preserve root presentation attributes, including fill="none"
  for (const at of [...root.attributes])
    if (
      !["xmlns", "width", "height", "viewBox", "id"].includes(at.name) &&
      !at.name.startsWith("xmlns:")
    )
      g.setAttribute(at.name, at.value);
  while (root.firstChild) g.appendChild(root.firstChild);
  return new XMLSerializer().serializeToString(g);
}
export function exportSVG(
  scene: Scene,
  assets: Asset[],
  sources: Record<string, string>,
): string {
  const { width: w, height: h } = scene.canvas,
    p = paletteFor(scene);
  const background = backgroundMarkup(scene, sources);
  const body = scene.layers
    .filter((l) => l.visible)
    .map((l) => {
      const a = assets.find((a) => a.id === l.assetId),
        raw = sources[l.assetId] ?? a?.svg;
      if (!a || !raw) throw Error("исходник объекта не загружен");
      return `<g id="layer-${l.id}" opacity="${l.opacity}" transform="${transform(scene, l, a)}">${markup(raw, l.id, p, !a.svg)}</g>`;
    })
    .join("");
  return `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${background}${body}</svg>`;
}
export function download(text: string, name: string, type = "image/svg+xml") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parsePalette(raw: string): Palette {
  const x = JSON.parse(raw);
  const keys = ["strong", "medium", "light", "highlight", "pink", "soft"];
  if (
    !x ||
    !keys.every((k) => typeof x[k] === "string" && /^#[\da-f]{6}$/i.test(x[k]))
  )
    throw Error(
      "палитра должна содержать strong, medium, light, highlight, pink, soft в формате #rrggbb",
    );
  return {
    id: "custom",
    name: "своя палитра",
    strong: x.strong,
    medium: x.medium,
    light: x.light,
    highlight: x.highlight,
    pink: x.pink,
    soft: x.soft,
  };
}

export function backgroundMarkup(
  scene: Scene,
  sources: Record<string, string>,
): string {
  const p = paletteFor(scene),
    { width: w, height: h } = scene.canvas;
  const backgroundId =
    scene.backgroundId ||
    "background-square-" +
      (scene.palette === "custom" ? "violet" : scene.palette);
  const raw = sources[backgroundId];
  if (!raw) return `<rect width="${w}" height="${h}" fill="${p.light}"/>`;
  return `<svg x="0" y="0" width="${w}" height="${h}" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">${markup(raw, "bg", p, scene.palette === "custom")}</svg>`;
}
