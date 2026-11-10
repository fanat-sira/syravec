export type PanelSizes = [number, number, number];
export type PanelOpen = [boolean, boolean, boolean];
export const PANEL_HEADER = 41;
export const PANEL_MIN = 120;
export const PANEL_DIVIDER = 6;
export function panelLayout(
  height: number,
  desired: PanelSizes,
  requested: PanelOpen,
  priority = 2,
) {
  const available = Math.max(PANEL_HEADER * 3, height - PANEL_DIVIDER * 2);
  const open = [...requested] as PanelOpen;
  const minimum = () =>
    open.reduce((sum, value) => sum + (value ? PANEL_MIN : PANEL_HEADER), 0);
  // Very short windows keep every header reachable, collapsing other bodies first
  for (const i of [0, 1, 2].filter((i) => i !== priority).concat(priority))
    if (minimum() > available) open[i] = false;
  const mins = open.map((value) => (value ? PANEL_MIN : PANEL_HEADER));
  const sizes = [...mins] as PanelSizes;
  let remaining = available;
  for (let i = 0; i < 3; i++) {
    const following = mins.slice(i + 1).reduce((a, b) => a + b, 0);
    sizes[i] = open[i]
      ? i === 2
        ? remaining
        : Math.max(mins[i], Math.min(desired[i], remaining - following))
      : PANEL_HEADER;
    remaining -= sizes[i];
  }
  return { sizes, open };
}
export function resizePanels(
  sizes: PanelSizes,
  index: 0 | 1,
  delta: number,
): PanelSizes {
  const next = [...sizes] as PanelSizes;
  const change = Math.max(
    PANEL_MIN - sizes[index],
    Math.min(sizes[index + 1] - PANEL_MIN, delta),
  );
  next[index] += change;
  next[index + 1] -= change;
  return next;
}
