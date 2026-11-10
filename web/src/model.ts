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
export interface Asset {
  id: string;
  displayName: string;
  variant: "main" | "background";
  tags: string[];
  viewBox: number[];
  assetUrl: string;
  svg?: string;
}
export interface Layer {
  id: string;
  assetId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}
export interface Scene {
  version: 1;
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
  scene: Scene;
  generations?: Generation[];
  messages: { role: "user" | "assistant"; text: string }[];
  updatedAt: number;
}
export const emptyScene = (): Scene => ({
  version: 1,
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
  scale: 1.5,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
});
export function transform(s: Scene, l: Layer, a: Asset) {
  const [vx, vy, vw, vh] = a.viewBox,
    k =
      ((0.4 * Math.min(s.canvas.width, s.canvas.height)) / Math.max(vw, vh)) *
      l.scale;
  return `translate(${l.x * s.canvas.width} ${l.y * s.canvas.height}) rotate(${l.rotation}) scale(${k}) translate(${-vx - vw / 2} ${-vy - vh / 2})`;
}
export function size(s: Scene, l: Layer, a: Asset) {
  const k =
    ((0.4 * Math.min(s.canvas.width, s.canvas.height)) /
      Math.max(a.viewBox[2], a.viewBox[3])) *
    l.scale;
  return { w: a.viewBox[2] * k, h: a.viewBox[3] * k };
}
export function arrange(ids: string[], scene: Scene, seed = 0): Scene {
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
    scale:
      n === 1
        ? 1.8
        : n <= 3
          ? i === 0
            ? 1.7
            : 1.1
          : Math.min(1.1, 2.2 / Math.sqrt(n)),
    rotation: (((i + seed) % 3) - 1) * 8,
  }));
  layers.sort(
    (a, b) =>
      Number(b.assetId.endsWith("-background")) -
      Number(a.assetId.endsWith("-background")),
  );
  return { ...scene, layers };
}
