// Explicit live evaluation: calls the configured provider and writes editable projects
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
const base = process.env.SYRAVEC_API_URL || 'http://127.0.0.1:8080';
const health = await (await fetch(`${base}/api/v1/health`)).json();
if (!health.aiConfigured) throw Error('openrouter не настроен: добавь ключ в .env и перезапусти api');
const catalog = await (await fetch(`${base}/api/v1/catalog`)).json();
const assets = new Map(catalog.assets.map(a => [a.id, a]));
const prompts = [
  'знания открывают двери', 'деньги под контролем', 'на своей волне',
  'собрать мысли в единое целое', 'светлая идея среди повседневных дел',
  'цифровой детокс', 'инвестиции в себя', 'хаос превращается в порядок',
  'между работой и отдыхом',
];
const cases = prompts.map((prompt, i) => ({ mode: 'concept', prompt, assetIds: [], canvasPreset: ['square', 'landscape', 'portrait'][i % 3], palette: ['violet', 'teal', 'warm'][i % 3] }));
cases.push(
  { mode: 'selection', prompt: '', assetIds: ['book-main', 'lamp-main', 'puzzle-background'], canvasPreset: 'portrait', palette: 'teal' },
  { mode: 'selection', prompt: 'центр и два акцента', assetIds: ['wallet-main', 'coin-main', 'folder-main'], canvasPreset: 'landscape', palette: 'warm' },
  { ...cases[0] },
);
await mkdir(new URL('../artifacts/ai-evaluation/', import.meta.url), { recursive: true });
const results = [];
for (const [i, input] of cases.entries()) {
  // Stay below the local 10 requests/minute limit, including a possible repair
  if (i) await pause(7000);
  const request = { ...input, planner: 'llm', seed: Date.now() % 1_000_000 + i };
  const response = await fetch(`${base}/api/v1/compositions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(55000) });
  const data = await response.json();
  if (!response.ok) throw Error(`case ${i + 1}: ${JSON.stringify(data)}`);
  if (data.generation.source !== 'llm') throw Error('live evaluation received a template');
  const scene = data.scene;
  if (input.mode === 'selection' && JSON.stringify(scene.layers.map(l => l.assetId).sort()) !== JSON.stringify([...input.assetIds].sort())) throw Error('selected assets changed');
  for (const l of scene.layers) {
    const a = assets.get(l.assetId);
    if (!a) throw Error('unknown asset');
    const rad = l.rotation * Math.PI / 180;
    const k = 0.4 * Math.min(scene.canvas.width, scene.canvas.height) / Math.max(a.viewBox[2], a.viewBox[3]) * l.scale;
    const rx = (Math.abs(a.viewBox[2] * Math.cos(rad)) + Math.abs(a.viewBox[3] * Math.sin(rad))) * k / scene.canvas.width / 2;
    const ry = (Math.abs(a.viewBox[2] * Math.sin(rad)) + Math.abs(a.viewBox[3] * Math.cos(rad))) * k / scene.canvas.height / 2;
    if (![l.x, l.y, l.scale, l.rotation, l.opacity].every(Number.isFinite) || l.x - rx < 0 || l.x + rx > 1 || l.y - ry < 0 || l.y + ry > 1) throw Error('clipped or invalid layer');
  }
  results.push({ request, ...data });
  await writeFile(new URL(`../artifacts/ai-evaluation/${i + 1}.json`, import.meta.url), JSON.stringify({ format: 'syravec-project', version: 1, title: input.prompt || 'выбранные объекты', scene, messages: [], generations: [], customAssets: [] }, null, 2));
  await writeFile(new URL('../artifacts/ai-evaluation/report.json', import.meta.url), JSON.stringify({ model: health.model, results }, null, 2));
  console.log(`${i + 1}/${cases.length}: ${data.generation.concept || 'selection'}`);
}
const placement = r => r.scene.layers.map(({ id, ...layer }) => layer);
if (JSON.stringify(placement(results[0])) === JSON.stringify(placement(results[11]))) throw Error('repeated idea produced identical placement');
console.log('12 live results saved; open each project to review visual storytelling and composition');
