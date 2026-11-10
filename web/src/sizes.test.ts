// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  emptyScene,
  layer,
  size,
  transform,
  canvasFor,
  changeIllustrationSize,
  adaptFormat,
  migrateScene,
  type Asset,
  type Layer,
} from "./model";
import { exportSVG, backgroundMarkup } from "./svg";
import { validateScene } from "./validate";
const book: Asset = {
  id: "book-main",
  displayName: "book",
  variant: "main",
  tags: [],
  viewBox: [0, 0, 1446, 977],
  assetUrl: "/large.svg",
  sets: {
    large: { viewBox: [0, 0, 1446, 977], assetUrl: "/large.svg" },
    small: { viewBox: [0, 0, 723, 489], assetUrl: "/small.svg" },
  },
};
const coin: Asset = {
  ...book,
  id: "coin-main",
  viewBox: [0, 0, 287, 189],
  sets: {
    large: { viewBox: [0, 0, 287, 189], assetUrl: "/coin-large.svg" },
    small: { viewBox: [0, 0, 144, 95], assetUrl: "/coin-small.svg" },
  },
};
const large =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1446 977"><defs><clipPath id="clip"><rect width="1446" height="977"/></clipPath></defs><path d="M0 0H1446V977H0Z" clip-path="url(#clip)" fill="#7864d7"/></svg>';
const small =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 723 489"><defs><clipPath id="clip"><rect width="723" height="489"/></clipPath></defs><path d="M0 0H723V489H0Z" clip-path="url(#clip)" fill="#7864d7"/><path d="M10 20L100 70Z" fill="#f9ecb0"/></svg>';
describe("original source sizes", () => {
  it("uses native dimensions and fixed ratios, never a per-object normalization", () => {
    const scene = emptyScene(),
      a = layer(book.id),
      b = layer(coin.id);
    expect(size(scene, a, book)).toEqual({ w: 1446, h: 977 });
    expect(size(scene, b, coin)).toEqual({ w: 287, h: 189 });
    expect(size(scene, a, book).w / size(scene, b, coin).w).toBe(1446 / 287);
    expect(
      transform(scene, { ...a, scale: 0.001 } as unknown as Layer, book),
    ).toBe(transform(scene, a, book));
    expect(transform(scene, a, book)).not.toContain("scale(");
  });
  it("switches actual SVG paths with stable logical IDs, defs and links", () => {
    const scene = emptyScene();
    scene.layers = [layer(book.id)];
    const sources = { "large:book-main": large, "small:book-main": small };
    const before = exportSVG(scene, [book], sources),
      next = changeIllustrationSize(scene, "small", [book]),
      after = exportSVG(next, [book], sources);
    const parse = (text: string) =>
      new DOMParser().parseFromString(text, "image/svg+xml");
    expect(parse(before).querySelectorAll("path")).toHaveLength(1);
    expect(parse(after).querySelectorAll("path")).toHaveLength(2);
    expect(after).toContain('d="M10 20L100 70Z"');
    expect(before).not.toContain('d="M10 20L100 70Z"');
    expect(next.layers).toEqual(scene.layers);
    expect(size(next, next.layers[0], book)).toEqual({ w: 723, h: 489 });
    const doc = parse(after),
      ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids).toContain(
      doc.querySelector("path")!.getAttribute("clip-path")!.slice(5, -1),
    );
  });
  it.each([
    ["square", 1000, 1000, 500, 500],
    ["landscape", 1000, 633, 500, 317],
    ["portrait", 750, 1000, 375, 500],
  ] as const)("has exact large/small canvas for %s", (preset, w, h, sw, sh) => {
    expect(canvasFor(preset, "large")).toEqual({ preset, width: w, height: h });
    expect(canvasFor(preset, "small")).toEqual({
      preset,
      width: sw,
      height: sh,
    });
  });
  it("format and size preserve normalized placement, rotation, palette and layer flags", () => {
    const scene = emptyScene();
    scene.palette = "warm";
    scene.layers = [
      {
        ...layer(book.id),
        x: 1.1,
        y: -0.1,
        rotation: 35,
        opacity: 0.7,
        locked: true,
      },
    ];
    const next = changeIllustrationSize(
      adaptFormat(scene, "portrait", [book]),
      "small",
      [book],
    );
    expect(next.layers).toEqual(scene.layers);
    expect(next.palette).toBe("warm");
    expect(next.canvas).toEqual({
      preset: "portrait",
      width: 375,
      height: 500,
    });
  });
  it("migrates old scales away and rejects hidden scale fields in version 2", () => {
    const scene = emptyScene();
    scene.layers = [layer(book.id)];
    const legacy = {
      ...scene,
      version: 1,
      illustrationSize: undefined,
      layers: [{ ...scene.layers[0], scale: 5 }],
    };
    const migrated = migrateScene(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.layers[0]).not.toHaveProperty("scale");
    expect(migrated.layers[0]).toEqual(scene.layers[0]);
    expect(() =>
      validateScene({ ...scene, layers: [{ ...scene.layers[0], scale: 1 }] }, [
        book,
      ]),
    ).toThrow();
  });
  it("does not manufacture alternate versions for user vectors", () => {
    const custom: Asset = {
      ...book,
      id: "custom-one",
      svg: large,
      sets: undefined,
      nativeSize: "large",
    };
    const scene = emptyScene();
    scene.layers = [layer(custom.id)];
    expect(() => changeIllustrationSize(scene, "small", [custom])).toThrow(
      /второго исходного набора/,
    );
  });
  it("background uses its native viewBox and proportional cropping", () => {
    const scene = {
      ...emptyScene(),
      illustrationSize: "small" as const,
      canvas: canvasFor("landscape", "small"),
    };
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><path fill="#7864d7" d="M0 0H500V500Z"/></svg>';
    const bg = backgroundMarkup(scene, {
      "small:background-square-violet": raw,
    });
    expect(bg).toContain('viewBox="0 0 500 500"');
    expect(bg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(bg).toContain('d="M0 0H500V500Z"');
  });
});
