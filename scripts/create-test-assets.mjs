// Synthetic geometry for tests only; never shipped as the illustration library.
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || '/tmp/syravec-test-public');
if (root === resolve('web/public')) throw Error('test assets must stay outside web/public');
const manifest = JSON.parse(readFileSync(new URL('../web/public/assets/manifest.json', import.meta.url)));
mkdirSync(`${root}/assets`, { recursive: true });
for (const asset of [...manifest.assets, ...manifest.backgrounds]) {
  const [x, y, w, h] = asset.viewBox;
  writeFileSync(`${root}${asset.assetUrl}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${asset.viewBox.join(' ')}"><path fill="#7864d7" d="M${x} ${y}h${w}v${h}H${x}Z"/><circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/4}" fill="#f9a3aa"/></svg>`);
}
writeFileSync(`${root}/assets/manifest.json`, JSON.stringify(manifest));
copyFileSync(new URL('../web/public/favicon.svg', import.meta.url), `${root}/favicon.svg`);
console.log(`synthetic SVG fixtures: ${root}`);
