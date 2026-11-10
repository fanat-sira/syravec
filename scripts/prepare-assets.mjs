import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  cpSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
const sourceDir = process.env.SOURCE_DIR || "originals";
const output = process.env.ASSET_OUTPUT_ROOT || "web/public";
const findArchive = (envName, names) =>
  process.env[envName] ||
  names.map((name) => join(sourceDir, name)).find(existsSync) ||
  join(sourceDir, names[0]);
const archives = {
  large:
    process.env.SOURCE_ARCHIVE ||
    findArchive("SOURCE_ARCHIVE_LARGE", [
      "assets.zip",
      "Тестовое _ иллюстрации(2).zip",
    ]),
  small: findArchive("SOURCE_ARCHIVE_SMALL", [
    "assets-small.zip",
    "Тестовое _ иллюстрации(3).zip",
  ]),
};
for (const [size, archive] of Object.entries(archives))
  if (!existsSync(archive)) {
    console.error(
      `SyraVec: отсутствует ${size === "large" ? "большой" : "малый"} исходный архив: ${archive}\nПоложи оба оригинальных архива в originals/assets.zip (большой) и originals/assets-small.zip (малый). Малые SVG не создаются масштабированием больших.\nЗатем повтори: sudo docker compose up --build -d`,
    );
    process.exit(1);
  }
const root = mkdtempSync(join(tmpdir(), "syravec-assets-"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const generation =
  "library-" +
  hash(
    Buffer.concat([
      Buffer.from("syravec-source-sets-v2\0"),
      readFileSync(archives.large),
      readFileSync(archives.small),
    ]),
  ).slice(0, 20);
try {
  const items = [
    ["puzzle", "Пазлы", "Пазлы", "идеи творчество решение команда"],
    ["book", "Книга", "Книга", "знания образование обучение чтение"],
    ["phone", "Телефон", "Телефон", "связь технологии общение"],
    ["headphones", "Наушники", "Наушники", "музыка звук отдых"],
    ["lamp", "Лампа", "Лампа", "идея свет работа вдохновение"],
    ["wallet", "Кошелек", "Кошелек", "финансы деньги бюджет"],
    ["pen", "Ручка", "Ручка", "письмо творчество работа"],
    ["folder", "Папка", "Папка", "документы порядок работа"],
    ["coin", "Монета", "Монета", "деньги инвестиции финансы"],
    ["flowers", "Цветы", "Group 2136136344", "природа рост красота жизнь"],
  ];
  const descriptions = {
    puzzle:
      "Interlocking puzzle pieces: bringing separate ideas together, solving a problem, collaboration, connection.",
    book: "Open book with bookmark: knowledge, discovery, learning, access to new possibilities, shared experience.",
    phone:
      "Smartphone: communication, technology, digital connection, remote work, access to information.",
    headphones:
      "Over-ear headphones: listening, focus, personal space, music, tuning out distractions.",
    lamp: "Desk lamp casting light: insight, clarity, an idea, guidance, a focused workspace.",
    wallet:
      "Wallet: personal resources, financial responsibility, saving, protection, financial habits.",
    pen: "Pen: expression, authorship, turning intention into action, planning, creativity.",
    folder:
      "Document folder: structure, organizing knowledge, documents, keeping information together.",
    coin: "Coin with keyhole: value, access, opportunity, security, an investment or a small step.",
    flowers:
      "Flowers in a vase: growth, care, renewal, thriving, a result that takes time to develop.",
  };
  const records = {};
  for (const [size, archive] of Object.entries(archives)) {
    const names = execFileSync("unzip", ["-Z1", archive], {
      encoding: "utf8",
      maxBuffer: 2e6,
    })
      .split("\n")
      .filter((n) => /\.svg$/i.test(n));
    if (names.length > 1000) throw Error("слишком много файлов SVG");
    records[size] = names.map((file) => {
      const raw = execFileSync("unzip", ["-p", archive, file], {
        maxBuffer: 8e6,
      });
      const svg = raw.toString("utf8");
      if (
        /<(?:script|image|foreignObject)\b|\bon\w+\s*=|(?:href\s*=\s*["'](?!#))|url\(\s*(?!#)/i.test(
          svg,
        )
      )
        throw Error("unsafe asset " + file);
      const viewBox = svg
        .match(/viewBox\s*=\s*["']([^"']+)["']/)?.[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        !viewBox ||
        viewBox.length !== 4 ||
        !viewBox.every(Number.isFinite) ||
        viewBox[2] <= 0 ||
        viewBox[3] <= 0
      )
        throw Error("invalid viewBox: " + file);
      const isMain =
        /#(?:181817|181818|000000)\b|(?:fill|stroke)\s*=\s*["'](?:black|#000)["']/i.test(
          svg,
        );
      return {
        file,
        raw,
        viewBox,
        isMain,
        pathCount: (svg.match(/<path\b/g) || []).length,
        sha256: hash(raw),
      };
    });
  }
  const directory = join(root, "assets", generation);
  for (const size of ["large", "small"])
    mkdirSync(join(directory, size), { recursive: true });
  function named(size, file) {
    const matches = records[size].filter(
      (r) => basename(r.file) === file + ".svg",
    );
    if (matches.length !== 1)
      throw Error(`неоднозначный или отсутствующий исходник ${size}: ${file}`);
    return matches[0];
  }
  const used = { large: new Set(), small: new Set() };
  function save(size, id, source) {
    if (used[size].has(source.file) && !id.startsWith("background-"))
      throw Error("один исходник назначен нескольким объектам: " + source.file);
    used[size].add(source.file);
    writeFileSync(join(directory, size, id + ".svg"), source.raw);
    return {
      viewBox: source.viewBox,
      assetUrl: `/assets/${generation}/${size}/${id}.svg`,
      sourceFile: source.file,
      sha256: source.sha256,
      pathCount: source.pathCount,
    };
  }
  // Explicit correspondence verified against BOTH supplied original archives.
  // Group filenames differ between sets; native dimensions are not forced to 1/2.
  const smallFiles = {
    "puzzle-main": "Пазлы",
    "puzzle-background": "Пазлы-1",
    "book-main": "Group 2136136335",
    "book-background": "Group 2136136341",
    "phone-main": "Телефон",
    "phone-background": "Телефон-1",
    "headphones-main": "Наушники",
    "headphones-background": "Наушники-1",
    "lamp-main": "Лампа",
    "lamp-background": "Лампа-1",
    "wallet-main": "Кошелек",
    "wallet-background": "Кошелек-1",
    "pen-main": "Group 2136136336",
    "pen-background": "Group 2136136343",
    "folder-main": "Group 2136136337",
    "folder-background": "Group 2136136342",
    "coin-main": "Монета",
    "coin-background": "Монета-1",
    "flowers-main": "Group 2136136345",
    "flowers-background": "Group 2136136346",
  };
  const assets = [];
  for (const [id, displayName, file, tags] of items)
    for (const variant of ["main", "background"]) {
      const key = id + "-" + variant;
      const large = named(
        "large",
        variant === "main"
          ? file
          : id === "flowers"
            ? "Group 2136136347"
            : file + "-1",
      );
      const small = named("small", smallFiles[key]);
      if (small.isMain !== (variant === "main"))
        throw Error(
          `неверная цветовая роль малого исходника ${key}: ${small.file}`,
        );
      const sets = {
        large: save("large", key, large),
        small: save("small", key, small),
      };
      assets.push({
        id: key,
        displayName,
        variant,
        tags: tags.split(" "),
        description: descriptions[id],
        ...sets.large,
        sets,
      });
    }
  const backgrounds = [];
  for (const preset of ["square", "landscape"])
    for (const [index, palette] of ["violet", "teal", "warm"].entries()) {
      const id = `background-${preset}-${palette}`,
        file = ["Фон", "Фон-1", "Фон-2"][index];
      const sets = Object.fromEntries(
        ["large", "small"].map((size) => [
          size,
          save(size, id, named(size, file)),
        ]),
      );
      backgrounds.push({ id, preset, palette, ...sets.large, sets });
    }
  writeFileSync(
    join(root, "assets/manifest.json"),
    JSON.stringify(
      {
        version: 2,
        objectFactor: 1,
        assets,
        backgrounds,
        illustrationSizes: ["large", "small"],
        palettes: ["violet", "teal", "warm"],
        canvasPresets: ["square", "landscape", "portrait"],
      },
      null,
      2,
    ),
  );
  if (process.env.ASSET_AUDIT_BIN)
    execFileSync(process.env.ASSET_AUDIT_BIN, [], {
      stdio: "inherit",
      env: { ...process.env, ASSET_PUBLIC_ROOT: root },
    });
  else
    execFileSync("go", ["run", "./cmd/asset-audit"], {
      cwd: "api",
      stdio: "inherit",
      env: { ...process.env, ASSET_PUBLIC_ROOT: root },
    });
  mkdirSync(join(output, "assets"), { recursive: true });
  const target = join(output, "assets", generation);
  if (!existsSync(target)) {
    const staged = join(output, "assets", ".next-" + generation);
    rmSync(staged, { recursive: true, force: true });
    cpSync(directory, staged, { recursive: true });
    renameSync(staged, target);
  }
  writeFileSync(
    join(output, "assets", ".manifest-next.json"),
    readFileSync(join(root, "assets/manifest.json")),
  );
  renameSync(
    join(output, "assets", ".manifest-next.json"),
    join(output, "assets", "manifest.json"),
  );
  console.log(
    "prepared 20 logical objects × 2 original sets and source backgrounds; fixed object factor 1",
  );
} catch (error) {
  console.error(
    "SyraVec: не удалось подготовить обе исходные библиотеки: " + error.message,
  );
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
