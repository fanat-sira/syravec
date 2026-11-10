// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  emptyScene,
  layer,
  transform,
  arrange,
  type Asset,
  palettes,
} from "./model";
import { exportSVG, markup, sanitize, parsePalette } from "./svg";
import { validateProject } from "./validate";
const asset: Asset = {
  id: "book-main",
  displayName: "книга",
  variant: "main",
  tags: [],
  viewBox: [10, 20, 200, 100],
  assetUrl: "",
};
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100" fill="none"><defs><clipPath id="clip"><rect width="100" height="100"/></clipPath></defs><path clip-path="url(#clip)" fill="#7864D7" d="M10 20h200v100z"/></svg>';
describe("векторная сцена", () => {
  it("центрирует ненулевой viewbox и сохраняет пропорции", () => {
    const s = emptyScene(),
      l = { ...layer("book-main"), rotation: 30 };
    expect(transform(s, l, asset)).toBe(
      "translate(500 500) rotate(30) translate(-110 -70)",
    );
  });
  it("экспортирует повторные объекты без коллизий определений и без растров", () => {
    const s = emptyScene();
    s.layers = [layer(asset.id), layer(asset.id), layer(asset.id)];
    const svg = exportSVG(s, [asset], { [asset.id]: source });
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of doc.querySelectorAll("[clip-path]"))
      expect(ids).toContain(e.getAttribute("clip-path")!.slice(5, -1));
    expect(doc.querySelectorAll("path")).toHaveLength(3);
    expect(doc.querySelector("image,script")).toBeNull();
    expect(svg).toBe(exportSVG(s, [asset], { [asset.id]: source }));
    expect(svg).toContain('fill="none"');
  });
  it("перекрашивает известные роли без изменения геометрии", () => {
    const a = markup(source, "one", palettes[0]),
      b = markup(source, "one", palettes[1]);
    expect(b).toContain("#5abebe");
    expect(b.replace("#5abebe", "#7864d7")).toBe(a);
  });
  it.each([
    "<script>alert(1)</script>",
    '<image href="https://example.org/a.png"/>',
    '<g onclick="x()"/>',
    '<path fill="url(https://evil.org/a)"/>',
    '<use href="data:image/svg+xml,bad"/>',
    "<foreignObject/>",
  ])("отклоняет активное или внешнее содержимое %s", (body) => {
    expect(() =>
      sanitize(`<svg viewBox="0 0 100 100">${body}</svg>`),
    ).toThrow();
  });
  it("проверяет xml, размеры и локальные ссылки", () => {
    expect(sanitize(source).viewBox).toEqual([10, 20, 200, 100]);
    expect(() => sanitize('<svg viewBox="0 0 0 3"/>')).toThrow();
    expect(() => sanitize("<svg>")).toThrow();
  });
  it("валидирует палитру", () => {
    expect(parsePalette(JSON.stringify(palettes[1])).strong).toBe("#5abebe");
    expect(() => parsePalette('{"strong":"url(evil)"}')).toThrow();
  });
  it("не принимает неизвестные объекты и повторные идентификаторы проекта", () => {
    const s = emptyScene();
    s.layers = [layer("fake")];
    expect(() => validateProject({ scene: s }, [asset])).toThrow();
    s.layers = [layer(asset.id)];
    expect(validateProject({ scene: s }, [asset])).toEqual(s);
    s.layers.push(s.layers[0]);
    expect(() => validateProject({ scene: s }, [asset])).toThrow();
  });
  it("шаблон сохраняет выбранные объекты", () => {
    expect(
      arrange(["a", "b", "c"], emptyScene()).layers.map((l) => l.assetId),
    ).toEqual(["a", "b", "c"]);
  });
});
