export type PaletteId = "violet" | "teal" | "warm" | "custom";
export type Palette = {
  id: PaletteId;
  name: string;
  strong: string;
  medium: string;
  light: string;
  highlight: string;
  pink: string;
  soft: string;
};
export const palettes: Palette[] = [
  {
    id: "violet",
    name: "сиреневый",
    strong: "#7864d7",
    medium: "#aa9bf0",
    light: "#d7cdf5",
    highlight: "#f9ecb0",
    pink: "#f9a3aa",
    soft: "#ffe3e1",
  },
  {
    id: "teal",
    name: "мятный",
    strong: "#5abebe",
    medium: "#80dada",
    light: "#beebeb",
    highlight: "#ffd4f2",
    pink: "#6d7bfc",
    soft: "#b6c6fe",
  },
  {
    id: "warm",
    name: "персиковый",
    strong: "#d27532",
    medium: "#fac896",
    light: "#fdd7b9",
    highlight: "#f9ecb0",
    pink: "#80dada",
    soft: "#beebeb",
  },
];
export type IllustrationSize = "large" | "small";
export interface AssetGeometry {
  viewBox: number[];
  assetUrl: string;
  visualBounds?: number[];
  occupancy?: number[];
  visualWeight?: number;
  centroid?: number[];
}
export interface Asset {
  sets?: Record<IllustrationSize, AssetGeometry>;
  nativeSize?: IllustrationSize;
  id: string;
  displayName: string;
  variant: "main" | "background";
  tags: string[];
  viewBox: number[];
  assetUrl: string;
  svg?: string;
  description?: string;
  visualBounds?: number[];
  occupancy?: number[];
  visualWeight?: number;
  centroid?: number[];
}
export interface Layer {
  id: string;
  assetId: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  role?: "focal" | "support" | "decor";
}
export interface Scene {
  version: 2;
  illustrationSize: IllustrationSize;
  canvas: {
    width: number;
    height: number;
    preset: "square" | "landscape" | "portrait";
  };
  palette: PaletteId;
  customPalette?: Palette;
  backgroundId: string;
  layers: Layer[];
}
export interface Generation {
  id: string;
  prompt: string;
  mode: "concept" | "selection";
  source: "llm" | "fallback";
  createdAt: number;
  status: "success" | "error" | "cancelled";
  scene?: Scene;
  error?: string;
}
export interface Project {
  id: string;
  title: string;
  titleEdited?: boolean;
  scene: Scene;
  generations?: Generation[];
  messages: { role: "user" | "assistant"; text: string }[];
  updatedAt: number;
}
export const emptyScene = (): Scene => ({
  version: 2,
  illustrationSize: "large",
  canvas: { width: 1000, height: 1000, preset: "square" },
  palette: "violet",
  backgroundId: "background-square-violet",
  layers: [],
});
export const uid = () => crypto.randomUUID();
export const layer = (assetId: string): Layer => ({
  id: uid(),
  assetId,
  x: 0.5,
  y: 0.5,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
});
// Shared by every object in both source libraries. No per-layer multiplier.
export const OBJECT_FACTOR = 1;
export function canvasFor(
  preset: Scene["canvas"]["preset"],
  illustrationSize: IllustrationSize = "large",
) {
  const small = illustrationSize === "small";
  return {
    preset,
    width: preset === "portrait" ? (small ? 375 : 750) : small ? 500 : 1000,
    height: preset === "landscape" ? (small ? 317 : 633) : small ? 500 : 1000,
  };
}
export function assetForSize(
  a: Asset,
  illustrationSize: IllustrationSize,
): Asset {
  if (a.svg) return a;
  const geometry = a.sets?.[illustrationSize];
  if (geometry) return { ...a, ...geometry };
  if (illustrationSize === "large" && !a.sets) return a;
  throw Error("исходный SVG выбранного размера недоступен");
}
export function sourceKey(id: string, illustrationSize: IllustrationSize) {
  return `${illustrationSize}:${id}`;
}
export function transform(s: Scene, l: Layer, a: Asset) {
  const [vx, vy, vw, vh] = assetForSize(a, s.illustrationSize).viewBox;
  return `translate(${l.x * s.canvas.width} ${l.y * s.canvas.height}) rotate(${l.rotation}) translate(${-vx - vw / 2} ${-vy - vh / 2})`;
}
export function size(s: Scene, _l: Layer, a: Asset) {
  const active = assetForSize(a, s.illustrationSize);
  return {
    w: active.viewBox[2] * OBJECT_FACTOR,
    h: active.viewBox[3] * OBJECT_FACTOR,
  };
}
export function arrange(
  ids: string[],
  scene: Scene,
  seed = 0,
  assets: Asset[] = [],
): Scene {
  const n = ids.length,
    wide = scene.canvas.width > scene.canvas.height,
    cols = n <= 3 ? n : Math.ceil(Math.sqrt(n * (wide ? 1.6 : 1))),
    rows = Math.ceil(n / cols);
  const points =
    seed % 2 === 0
      ? [
          [0.4, 0.6],
          [0.72, 0.28],
          [0.76, 0.7],
        ]
      : [
          [0.6, 0.59],
          [0.26, 0.28],
          [0.23, 0.72],
        ];
  const layers = ids.map((id, i) => ({
    ...layer(id),
    x: n === 1 ? 0.5 : n <= 3 ? points[i][0] : ((i % cols) + 0.5) / cols,
    y:
      n === 1
        ? 0.5
        : n <= 3
          ? points[i][1]
          : (Math.floor(i / cols) + 0.5) / rows,
    rotation: (((i + seed) % 3) - 1) * 8,
  }));
  layers.sort(
    (a, b) =>
      Number(b.assetId.endsWith("-background")) -
      Number(a.assetId.endsWith("-background")),
  );
  return assets.length
    ? fitScene({ ...scene, layers }, assets)
    : { ...scene, layers };
}

export function rotatedSize(scene: Scene, l: Layer, a: Asset) {
  const { w, h } = size(scene, l, a),
    r = (l.rotation * Math.PI) / 180;
  return {
    w: Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r)),
    h: Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r)),
  };
}
// Kept as a compatibility utility: fixed native dimensions never fit by shrinking.
export function fitScene(scene: Scene, _assets: Asset[]): Scene {
  return scene;
}
export function adaptFormat(
  scene: Scene,
  preset: Scene["canvas"]["preset"],
  _assets: Asset[],
): Scene {
  return {
    ...scene,
    canvas: canvasFor(preset, scene.illustrationSize),
    backgroundId: `background-${preset === "portrait" ? "square" : preset}-${scene.palette === "custom" ? "violet" : scene.palette}`,
  };
}
export function changeIllustrationSize(
  scene: Scene,
  illustrationSize: IllustrationSize,
  assets: Asset[],
): Scene {
  if (
    illustrationSize !== scene.illustrationSize &&
    scene.layers.some((l) => assets.find((a) => a.id === l.assetId)?.svg)
  )
    throw Error(
      "для загруженных SVG нет второго исходного набора; убери их из композиции, чтобы сменить размер иллюстраций",
    );
  for (const l of scene.layers)
    assetForSize(
      assets.find((a) => a.id === l.assetId)!,
      illustrationSize,
    );
  return {
    ...scene,
    illustrationSize,
    canvas: canvasFor(scene.canvas.preset, illustrationSize),
  };
}
// Legacy object scales are deliberately discarded; positions and editing state survive.
export function migrateScene(raw: unknown): Scene {
  const scene = raw as Scene;
  const illustrationSize =
    scene.illustrationSize === "small" ? "small" : "large";
  return {
    ...scene,
    version: 2,
    illustrationSize,
    canvas: canvasFor(scene.canvas.preset, illustrationSize),
    layers: scene.layers.map((l) => ({
      id: l.id,
      assetId: l.assetId,
      x: l.x,
      y: l.y,
      rotation: l.rotation,
      opacity: l.opacity,
      visible: l.visible,
      locked: l.locked,
      ...(l.role ? { role: l.role } : {}),
    })),
  };
}
