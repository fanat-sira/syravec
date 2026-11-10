// Independent synthetic source geometries for checks only, never product assets.
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(process.argv[2] || "/tmp/syravec-test-public");
if (root === resolve("web/public"))
  throw Error("test assets must stay outside web/public");
const manifest = JSON.parse(
  readFileSync(new URL("../web/public/assets/manifest.json", import.meta.url)),
);
manifest.version = 2;
manifest.objectFactor = 1;
manifest.illustrationSizes = ["large", "small"];
for (const asset of [...manifest.assets, ...manifest.backgrounds]) {
  const large = asset.sets?.large?.viewBox ?? asset.viewBox;
  // Test fixtures are intentionally synthetic and contain different path geometry.
  const small = asset.sets?.small?.viewBox ?? [
    large[0] / 2,
    large[1] / 2,
    Math.ceil(large[2] / 2),
    Math.ceil(large[3] / 2),
  ];
  asset.sets = {};
  for (const [size, viewBox] of [
    ["large", large],
    ["small", small],
  ]) {
    const [x, y, w, h] = viewBox,
      assetUrl = `/assets/${size}/${asset.id}.svg`;
    mkdirSync(`${root}/assets/${size}`, { recursive: true });
    const geometry =
      size === "large"
        ? `<path fill="#7864d7" d="M${x} ${y}h${w}v${h}H${x}Z"/><circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 4}" fill="#f9a3aa"/>`
        : `<path fill="#7864d7" d="M${x} ${y}h${w}v${h}H${x}Z"/><path fill="#f9a3aa" d="M${x} ${y}L${x + w} ${y + h}H${x}Z"/>`;
    writeFileSync(
      root + assetUrl,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}">${geometry}</svg>`,
    );
    asset.sets[size] = {
      viewBox,
      assetUrl,
      occupancy: asset.occupancy,
      visualBounds: asset.visualBounds,
      visualWeight: asset.visualWeight,
      centroid: asset.centroid,
    };
  }
  Object.assign(asset, asset.sets.large);
}
mkdirSync(root + "/assets", { recursive: true });
writeFileSync(root + "/assets/manifest.json", JSON.stringify(manifest));
copyFileSync(
  new URL("../web/public/favicon.svg", import.meta.url),
  root + "/favicon.svg",
);
console.log(`synthetic source sets: ${root}`);
