import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, copyFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const archive = process.env.SOURCE_ARCHIVE || 'originals/assets.zip';
const output = process.env.ASSET_OUTPUT_ROOT || 'web/public';
if (!existsSync(archive)) {
 console.error(`\nSyraVec: исходный архив SVG не найден: ${archive}\nОригинальные иллюстрации не публикуются в Git. Получи исходный архив отдельно\nи положи его в originals/assets.zip рядом с compose.yaml.\nЗатем повтори: sudo docker compose up --build -d\nИнтерфейс не запускается, пока библиотека не подготовлена.\n`);
 process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), 'syravec-assets-'));
try {
const items = [
 ['puzzle','Пазлы','Пазлы','идеи творчество решение команда'], ['book','Книга','Книга','знания образование обучение чтение'],
 ['phone','Телефон','Телефон','связь технологии общение'], ['headphones','Наушники','Наушники','музыка звук отдых'],
 ['lamp','Лампа','Лампа','идея свет работа вдохновение'], ['wallet','Кошелек','Кошелек','финансы деньги бюджет'],
 ['pen','Ручка','Ручка','письмо творчество работа'], ['folder','Папка','Папка','документы порядок работа'],
 ['coin','Монета','Монета','деньги инвестиции финансы'], ['flowers','Цветы','Group 2136136344','природа рост красота жизнь']
];
const descriptions={
 puzzle:'Interlocking puzzle pieces: bringing separate ideas together, solving a problem, collaboration, connection.',
 book:'Open book with bookmark: knowledge, discovery, learning, access to new possibilities, shared experience.',
 phone:'Smartphone: communication, technology, digital connection, remote work, access to information.',
 headphones:'Over-ear headphones: listening, focus, personal space, music, tuning out distractions.',
 lamp:'Desk lamp casting light: insight, clarity, an idea, guidance, a focused workspace.',
 wallet:'Wallet: personal resources, financial responsibility, saving, protection, financial habits.',
 pen:'Pen: expression, authorship, turning intention into action, planning, creativity.',
 folder:'Document folder: structure, organizing knowledge, documents, keeping information together.',
 coin:'Coin with keyhole: value, access, opportunity, security, an investment or a small step.',
 flowers:'Flowers in a vase: growth, care, renewal, thriving, a result that takes time to develop.'
};
mkdirSync(root+'/assets', {recursive:true});
const assets=[]; const colors={};
function save(id, file) {
 const svg=execFileSync('unzip',['-p',archive, file+'.svg'],{encoding:'utf8',maxBuffer:8e6});
 if (/<(?:script|image|foreignObject)\b|\bon\w+\s*=|(?:href\s*=\s*["'](?!#))|url\(\s*(?!#)/i.test(svg)) throw Error('unsafe asset '+file);
 const viewBox=svg.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
 if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) throw Error('invalid viewBox: '+file);
 writeFileSync(root+'/assets/'+id+'.svg',svg);
 for(const m of svg.matchAll(/#[\da-f]{6}\b/gi)) colors[m[0].toLowerCase()]=(colors[m[0].toLowerCase()]||0)+1;
 return viewBox;
}
for(const [id,name,file,tags] of items) for(const variant of ['main','background']) {
 const src=variant==='main'?file:id==='flowers'?'Group 2136136347':file+'-1';
 const key=id+'-'+variant;
 assets.push({id:key,displayName:name,variant,tags:tags.split(' '),description:descriptions[id],viewBox:save(key,src),assetUrl:'/assets/'+key+'.svg'});
}
const backgrounds=[];
for(const [preset,names] of [['square',['Фон','Фон-1','Фон-2']],['landscape',['Фон','Фон-1','Фон-2']]]) {
 for(const [i,palette] of ['violet','teal','warm'].entries()) {const id=`background-${preset}-${palette}`;backgrounds.push({id,preset,palette,viewBox:save(id,names[i]),assetUrl:`/assets/${id}.svg`});}
}
writeFileSync(root+'/assets/manifest.json',JSON.stringify({assets,backgrounds,palettes:['violet','teal','warm'],canvasPresets:['square','landscape','portrait']},null,2));

console.log('prepared',assets.length,'objects and',backgrounds.length,'backgrounds');

if (process.env.ASSET_AUDIT_BIN) execFileSync(process.env.ASSET_AUDIT_BIN,[],{stdio:'inherit',env:{...process.env,ASSET_PUBLIC_ROOT:root}});
else execFileSync('go',['run','./cmd/asset-audit'],{cwd:'api',stdio:'inherit',env:{...process.env,ASSET_PUBLIC_ROOT:root}});
// Publish only after the complete archive and silhouettes pass validation.
mkdirSync(output+'/assets', {recursive:true});
for (const file of readdirSync(root+'/assets').filter((file) => file !== 'manifest.json')) copyFileSync(root+'/assets/'+file, output+'/assets/'+file);
copyFileSync(root+'/assets/manifest.json', output+'/assets/.manifest-next.json');
renameSync(output+'/assets/.manifest-next.json', output+'/assets/manifest.json');
if (!process.env.ASSET_OUTPUT_ROOT) writeFileSync('docs/source-colors.json',JSON.stringify(colors,null,2));
} catch (error) {
 console.error('SyraVec: не удалось подготовить исходный архив SVG. Проверь полноту архива и имена файлов. '+error.message);
 process.exitCode=1;
} finally { rmSync(root,{recursive:true,force:true}); }
