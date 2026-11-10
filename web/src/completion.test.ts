// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  adaptFormat,
  emptyScene,
  layer,
  palettes,
  type Asset,
  type Project,
} from "./model";
import { readProject, serializeProject, validateScene } from "./validate";
import { exportSVG, markup } from "./svg";
const a: Asset = {
  id: "book-main",
  displayName: "книга",
  viewBox: [0, 0, 1400, 900],
  variant: "main",
  tags: [],
  assetUrl: "",
};
describe("завершенные сценарии сцены и переноса", () => {
  it("смена формата сохраняет идентичность, порядок и пропорции с исходными размерами и допустимым кадрированием", () => {
    const scene = emptyScene();
    scene.layers = [
      { ...layer(a.id), x: 1.15, y: -0.1, rotation: 71 },
      {
        ...layer(a.id),
        x: 0.85,
        y: 0.8,
        rotation: -35,
        locked: true,
      },
    ];
    for (const preset of ["portrait", "landscape", "square"] as const) {
      const next = adaptFormat(scene, preset, [a]);
      expect(next.layers.map((l) => l.id)).toEqual(
        scene.layers.map((l) => l.id),
      );
      expect(next.layers[1].locked).toBe(true);
      expect(next.layers).toEqual(scene.layers);
    }
  });
  it("проект переносит название, палитры, историю и svg, нужные предыдущим результатам", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#123456" d="M0 100L50 0L100 100Z"/></svg>';
    const custom: Asset = {
      id: "custom-one",
      displayName: "треугольник",
      variant: "main",
      tags: [],
      viewBox: [0, 0, 100, 100],
      assetUrl: "",
      svg,
    };
    const current = emptyScene();
    current.customPalette = {
      ...palettes[1],
      id: "custom",
      name: "своя палитра",
    };
    current.layers = [layer(a.id)];
    const previous = {
      ...emptyScene(),
      palette: "custom" as const,
      customPalette: {
        ...palettes[2],
        id: "custom" as const,
        name: "своя палитра",
      },
      layers: [layer(custom.id)],
    };
    const project: Project = {
      id: "one",
      title: "мой проект",
      scene: current,
      messages: [{ role: "user", text: "рост знаний" }],
      generations: [
        {
          id: "gen",
          prompt: "рост знаний",
          mode: "concept",
          source: "llm",
          createdAt: 1,
          status: "success",
          scene: previous,
        },
      ],
      updatedAt: 1,
    };
    const text = serializeProject(project, [custom]);
    const imported = readProject(JSON.parse(text), [a]);
    expect(imported.title).toBe(project.title);
    expect(imported.messages).toEqual(project.messages);
    expect(imported.generations?.[0].scene).toEqual(previous);
    expect(imported.customAssets).toHaveLength(1);
    expect(imported.scene.customPalette).toEqual(current.customPalette);
  });
  it("проверяет пользовательскую палитру даже когда сейчас выбрана стандартная", () => {
    const scene = {
      ...emptyScene(),
      customPalette: { strong: '\"/><script/>' },
    };
    expect(() => validateScene(scene, [a])).toThrow();
  });
  it("сохраняет маски, клипы, градиенты, xlink и скрытые векторы при дублировании", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" id="root"><defs><path id="shape" d="M0 0h100v100H0Z"/><linearGradient id="paint"><stop stop-color="#7864d7"/><stop offset="1" stop-color="#d7cdf5"/></linearGradient><clipPath id="clip"><circle cx="50" cy="50" r="45"/></clipPath><mask id="mask"><rect width="100" height="100" fill="white"/></mask></defs><use xlink:href="#shape" fill="url(#paint)" clip-path="url(#clip)" mask="url(#mask)"/></svg>';
    const asset = { ...a, viewBox: [0, 0, 100, 100] };
    const scene = emptyScene();
    scene.layers = [
      { ...layer(asset.id), id: "bg" },
      { ...layer(asset.id), visible: false },
      layer(asset.id),
    ];
    const out = exportSVG(scene, [asset], {
      [asset.id]: svg,
      "background-square-violet": svg,
    });
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.querySelectorAll("use")).toHaveLength(4);
    expect(doc.querySelectorAll("mask")).toHaveLength(4);
    expect(doc.querySelectorAll('g[display="none"]')).toHaveLength(1);
    for (const use of doc.querySelectorAll("use")) {
      const href = use.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      expect(href).toBeTruthy();
      expect(ids).toContain(href!.slice(1));
    }
    expect(out).not.toContain("<image");
    expect(markup(svg, "unit", palettes[0])).toContain('id="unit-0"');
  });
  it("отклоняет испорченную историю вместо неполного восстановления", () => {
    expect(() =>
      readProject(
        { scene: emptyScene(), generations: [{ id: "x", status: "success" }] },
        [a],
      ),
    ).toThrow();
  });
});
