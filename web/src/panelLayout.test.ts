import { describe, it, expect } from "vitest";
import { panelLayout, resizePanels, PANEL_MIN } from "./panelLayout";
describe("размеры секций инспектора", () => {
  it("сворачивание слоев сохраняет библиотеку и положение заголовка слоев", () => {
    const desired: [number, number, number] = [320, 250, 318];
    const before = panelLayout(900, desired, [true, true, true]);
    const after = panelLayout(900, desired, [true, false, true]);
    expect(after.sizes[0]).toBe(before.sizes[0]);
    expect(after.sizes[1]).toBe(41);
    expect(after.sizes[2]).toBe(before.sizes[2] + before.sizes[1] - 41);
    expect(panelLayout(900, desired, [true, true, true]).sizes).toEqual(
      before.sizes,
    );
  });
  it("перетаскивание изменяет только соседние секции и останавливается на минимуме", () => {
    expect(resizePanels([300, 220, 268], 0, 70)).toEqual([370, 150, 268]);
    expect(resizePanels([300, 220, 268], 1, 10000)).toEqual([
      300,
      368,
      PANEL_MIN,
    ]);
    expect(resizePanels([300, 220, 268], 0, -10000)).toEqual([
      PANEL_MIN,
      400,
      268,
    ]);
  });
  it("на коротком экране сохраняет все заголовки и минимумы открытых секций", () => {
    const layout = panelLayout(310, [300, 220, 260], [true, true, true]);
    expect(layout.open).toEqual([false, true, true]);
    expect(layout.sizes.reduce((a, b) => a + b, 12)).toBeLessThanOrEqual(310);
    layout.sizes.forEach((size, i) =>
      expect(size).toBeGreaterThanOrEqual(layout.open[i] ? PANEL_MIN : 41),
    );
  });
});
