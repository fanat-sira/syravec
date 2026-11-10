import { useState, useEffect, useRef, useMemo, useLayoutEffect } from "react";
import {
  Plus,
  Puzzle,
  ArrowUp,
  ArrowUpRight,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Layers,
  Shapes,
  Undo2,
  Redo2,
  Trash2,
  X,
  LoaderCircle,
  Minus,
  Scan,
  ChevronDown,
  Pencil,
  Check,
  Square,
} from "lucide-react";
import { useStore } from "./store";
import {
  emptyScene,
  layer,
  uid,
  arrange,
  adaptFormat,
  changeIllustrationSize,
  assetForSize,
  sourceKey,
  type Asset,
  type Scene,
} from "./model";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { download, exportSVG, sanitize, parsePalette, paletteFor } from "./svg";
const fileName = (title = "композиция") =>
  title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100) || "композиция";
const examples = [
  {
    title: "знания открывают двери",
    ids: ["book-main", "lamp-background", "puzzle-main"],
    art: "book-main",
  },
  {
    title: "деньги под контролем",
    ids: ["wallet-main", "coin-main", "folder-background"],
    art: "wallet-main",
  },
  {
    title: "на своей волне",
    ids: ["headphones-main", "flowers-background"],
    art: "headphones-main",
  },
];
export default function App() {
  const st = useStore(),
    project = st.projects.find((p) => p.id === st.current),
    scene = project?.scene ?? emptyScene();
  const [catalog, setCatalog] = useState<Asset[]>([]),
    [sources, setSources] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [recomposing, setRecomposing] = useState(false),
    [aiConfigured, setAiConfigured] = useState<boolean | null>(null),
    [notice, setNotice] = useState(""),
    [composerError, setComposerError] = useState(""),
    [library, setLibrary] = useState(true),
    [zoom, setZoom] = useState(100),
    [viewReset, setViewReset] = useState(0),
    [sidebar, setSidebar] = useState(() => window.innerWidth > 760),
    [inspectorOpen, setInspectorOpen] = useState(false),
    [zoomOpen, setZoomOpen] = useState(false),
    [renaming, setRenaming] = useState<string | null>(null),
    [renameText, setRenameText] = useState(""),
    [deleting, setDeleting] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null),
    stackRef = useRef<HTMLDivElement>(null),
    zoomMenuRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const shimmerRef = useRef<HTMLDivElement>(null);
  const inEditor = !!project;
  const activeProject = useRef(st.current);
  useEffect(() => {
    if (activeProject.current === st.current) return;
    const previous = activeProject.current;
    activeProject.current = st.current;
    // Creating the first scene by adding an asset keeps the current Composer selection.
    if (!previous && st.current) return;
    resetComposer();
  }, [st.current]);
  function resetComposer() {
    controller.current?.abort();
    setPrompt("");
    setComposerError("");
    setZoomOpen(false);
    setZoom(100);
    setViewReset((v) => v + 1);
  }
  function finishRename(id: string) {
    st.renameProject(id, renameText);
    setRenaming(null);
  }
  useLayoutEffect(() => {
    const main = mainRef.current,
      stack = stackRef.current;
    if (!main || !stack) return;
    const measure = () => {
      const dock = main.querySelector<HTMLElement>(".editor-dock");
      if (dock)
        main.style.setProperty(
          "--dock-space",
          `${main.getBoundingClientRect().bottom - dock.getBoundingClientRect().top + 20}px`,
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    observer.observe(stack);
    const dock = main.querySelector(".editor-dock");
    if (dock) observer.observe(dock);
    return () => observer.disconnect();
  }, [inEditor, loading, st.hydrated]);
  useEffect(() => {
    function outside(e: PointerEvent) {
      if (zoomOpen && !zoomMenuRef.current?.contains(e.target as Node))
        setZoomOpen(false);
    }
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [zoomOpen]);
  function resizePrompt() {
    const input = promptRef.current;
    if (!input) return;
    input.style.height = "0px";
    const css = getComputedStyle(input);
    const contentHeight =
      input.scrollHeight -
      parseFloat(css.paddingTop) -
      parseFloat(css.paddingBottom);
    const height = Math.max(22, Math.min(66, contentHeight));
    input.style.height = height + "px";
    input.style.overflowY = contentHeight > 66 ? "auto" : "hidden";
  }
  useLayoutEffect(resizePrompt, [prompt, inEditor, loading, st.hydrated]);
  useEffect(() => {
    const input = promptRef.current;
    if (!input) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - width) > 1) {
        width = entry.contentRect.width;
        resizePrompt();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [inEditor, loading, st.hydrated]);
  useLayoutEffect(() => {
    if (shimmerRef.current && promptRef.current)
      shimmerRef.current.scrollTop = promptRef.current.scrollTop;
  }, [busy, prompt]);
  const controller = useRef<AbortController | null>(null),
    fileRef = useRef<HTMLInputElement>(null),
    paletteRef = useRef<HTMLInputElement>(null),
    seed = useRef(Math.floor(Math.random() * 1_000_000));
  const assets = useMemo(
    () => [
      ...catalog.map((a) => assetForSize(a, scene.illustrationSize)),
      ...st.customAssets,
    ],
    [catalog, st.customAssets, scene.illustrationSize],
  );
  const selected = scene.layers.find((l) => l.id === st.selected);
  useEffect(() => {
    const failed = () =>
      setNotice(
        "не удалось сохранить изменения в браузере; экспортируй SVG, чтобы сохранить композицию",
      );
    window.addEventListener("syravec-storage-error", failed);
    return () => window.removeEventListener("syravec-storage-error", failed);
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/assets/manifest.json");
        if (!r.ok) throw Error();
        const m = await r.json();
        if (m.version !== 2) throw Error("нужны оба исходных набора SVG");
        const all = [...m.assets, ...m.backgrounds] as Asset[];
        const pairs = await Promise.all(
          all.flatMap((a) =>
            (["large", "small"] as const).map(async (illustrationSize) => {
              const geometry = a.sets?.[illustrationSize];
              if (!geometry) throw Error("неполная библиотека SVG");
              const res = await fetch(geometry.assetUrl);
              if (!res.ok) throw Error();
              return [
                sourceKey(a.id, illustrationSize),
                sanitize(await res.text()).svg,
              ] as const;
            }),
          ),
        );
        if (!cancelled) {
          setCatalog(m.assets);
          setSources(Object.fromEntries(pairs));
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError(
            "библиотека SVG недоступна. положи большой и малый исходные архивы в originals/assets.zip и originals/assets-small.zip и выполни sudo docker compose up --build -d. подробности — в README.",
          );
          setLoading(false);
        }
      }
    }
    void load();
    fetch("/api/v1/health")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.aiConfigured === "boolean")
          setAiConfigured(data.aiConfigured);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (st.migrationNotice) {
      setNotice(st.migrationNotice);
      useStore.setState({ migrationNotice: "" });
    }
  }, [st.migrationNotice]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (deleting || renaming) return;
      const target = e.target;
      const editingText =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement &&
          !["number", "range", "checkbox", "radio"].includes(target.type)) ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (
        !editingText &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.code === "KeyZ" || e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        editingText
      )
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove();
      }
      if (e.key === "Escape") {
        st.select(null);
        setZoomOpen(false);
        setInspectorOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function change(s: Scene) {
    st.setScene(s);
  }
  function remove() {
    if (!selected || selected.locked) return;
    change({
      ...scene,
      layers: scene.layers.filter((l) => l.id !== selected.id),
    });
    st.select(null);
  }
  function add(a: Asset, point?: { x: number; y: number }) {
    if (a.svg && (a.nativeSize ?? "large") !== scene.illustrationSize) {
      setNotice("у этого SVG нет версии для текущего размера иллюстраций");
      return;
    }
    if (scene.layers.length >= 40) {
      setNotice("на холсте уже 40 объектов");
      return;
    }
    const l = { ...layer(a.id), ...(point ?? {}) };
    change({ ...scene, layers: [...scene.layers, l] });
    st.select(l.id);
  }
  function dropAsset(assetId: string, x: number, y: number) {
    const a = assets.find((a) => a.id === assetId);
    if (a) add(a, { x, y });
  }
  function welcomeDrop(e: React.DragEvent) {
    const id = e.dataTransfer.getData("application/x-syravec-asset");
    if (!id) return;
    e.preventDefault();
    const svg = document.querySelector<SVGSVGElement>(".artboard");
    if (!svg?.getScreenCTM()) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.getScreenCTM()!.inverse(),
    );
    dropAsset(
      id,
      Math.max(0, Math.min(1, pt.x / scene.canvas.width)),
      Math.max(0, Math.min(1, pt.y / scene.canvas.height)),
    );
  }
  function illustrationSize(value: Scene["illustrationSize"]) {
    try {
      change(changeIllustrationSize(scene, value, assets));
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function format(preset: Scene["canvas"]["preset"]) {
    change(adaptFormat(scene, preset, assets));
  }
  async function generate(text = prompt, fromLayers = false) {
    if (busy || loading) return;
    if (!fromLayers && !text.trim()) {
      promptRef.current?.focus();
      return;
    }
    if (!fromLayers) st.message("user", text.trim());
    const before = useStore.getState();
    const revision = before.revision,
      current = before.current,
      snapshot = before.projects.find((p) => p.id === current)!.scene;
    activeProject.current = current;
    setComposerError("");
    setNotice("");
    setBusy(true);
    setRecomposing(fromLayers);
    const ac = new AbortController();
    controller.current = ac;
    try {
      const r = await fetch("/api/v1/compositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          mode: fromLayers ? "selection" : "auto",
          illustrationSize: snapshot.illustrationSize,
          prompt: fromLayers ? "" : text.trim(),
          assetIds: fromLayers ? snapshot.layers.map((l) => l.assetId) : [],
          customAssets: fromLayers
            ? [...new Set(snapshot.layers.map((l) => l.assetId))]
                .filter((id) => !catalog.some((a) => a.id === id))
                .map((id) => {
                  const asset = assets.find((a) => a.id === id)!;
                  return {
                    id,
                    displayName: asset.displayName.slice(0, 200),
                    viewBox: asset.viewBox,
                    illustrationSize: asset.nativeSize ?? "large",
                  };
                })
            : undefined,
          palette: snapshot.palette,
          paletteColors: Object.fromEntries(
            ["strong", "medium", "light", "highlight", "pink", "soft"].map(
              (key) => [
                key,
                paletteFor(snapshot)[
                  key as keyof ReturnType<typeof paletteFor>
                ],
              ],
            ),
          ),
          canvasPreset: snapshot.canvas.preset,
          seed: seed.current++,
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(data.error?.message || "не удалось собрать композицию");
      const { validateProject } = await import("./validate");
      let result = validateProject(
        { scene: { ...data.scene, customPalette: snapshot.customPalette } },
        assets,
      );
      // Generated angles are never applied; only manual editing controls rotation.
      result = {
        ...result,
        layers: result.layers.map((l) => ({ ...l, rotation: 0 })),
      };
      if (fromLayers) {
        const originals = new Map<string, Scene["layers"]>();
        for (const original of snapshot.layers) {
          const instances = originals.get(original.assetId) ?? [];
          instances.push(original);
          originals.set(original.assetId, instances);
        }
        if (result.layers.length !== snapshot.layers.length)
          throw Error(
            "модель изменила число объектов; прежняя композиция сохранена",
          );
        const layers = result.layers.map((planned) => {
          const original = originals.get(planned.assetId)?.shift();
          if (!original)
            throw Error(
              "модель изменила набор объектов; прежняя композиция сохранена",
            );
          return {
            ...original,
            x: planned.x,
            y: planned.y,
            role: planned.role,
          };
        });
        if ([...originals.values()].some((instances) => instances.length))
          throw Error(
            "модель пропустила объекты; прежняя композиция сохранена",
          );
        result = { ...snapshot, layers };
      }
      const now = useStore.getState();
      if (now.revision !== revision || now.current !== current) {
        if (now.current === current)
          setComposerError(
            "композиция изменилась во время сборки; повтори запрос, чтобы применить новую компоновку",
          );
        return;
      }
      st.setScene(result);
      if (!fromLayers) {
        st.select(null);
        setPrompt((draft) => (draft.trim() === text.trim() ? "" : draft));
      }
      const warnings = data.generation.warnings?.filter(
        (w: string) => w !== "шаблонная раскладка, без ai",
      );
      if (fromLayers) setAiConfigured(data.generation.source === "llm");
      if (fromLayers && data.generation.source === "fallback")
        setNotice(
          [
            "композиция собрана по шаблону — ai не подключен",
            ...(warnings ?? []),
          ].join(" · "),
        );
      else if (warnings?.length) setNotice(warnings.join(" · "));
    } catch (e) {
      if (!ac.signal.aborted && useStore.getState().current === current)
        setComposerError(
          e instanceof Error ? e.message : "ошибка соединения с сервером",
        );
    } finally {
      setBusy(false);
      setRecomposing(false);
      controller.current = null;
    }
  }
  function example(i: number) {
    const e = examples[i];
    st.newProject();
    st.setScene(arrange(e.ids, emptyScene(), i, assets));
    st.message("user", e.title);
    st.select(null);
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    for (const f of [...files].slice(0, 10)) {
      try {
        const data = sanitize(await f.text());
        const a: Asset = {
          id: "custom-" + uid(),
          displayName: f.name.replace(/\.svg$/i, ""),
          variant: "main",
          tags: [],
          viewBox: data.viewBox,
          assetUrl: "",
          svg: data.svg,
          nativeSize: scene.illustrationSize,
        };
        st.addAsset(a);
        addFromUpload(a);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "не удалось загрузить svg");
      }
    }
  }
  function addFromUpload(a: Asset) {
    const now = useStore.getState(),
      s = now.projects.find((p) => p.id === now.current)?.scene ?? emptyScene();
    if (s.layers.length < 40) {
      const l = layer(a.id);
      now.setScene({ ...s, layers: [...s.layers, l] });
      now.select(l.id);
    }
  }
  async function paletteUpload(f?: File) {
    if (!f) return;
    try {
      const customPalette = parsePalette(await f.text());
      change({ ...scene, palette: "custom", customPalette, backgroundId: "" });
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function exportFile() {
    try {
      download(
        exportSVG(scene, assets, sources),
        `${fileName(project?.title)}.svg`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function fitView() {
    setZoom(100);
    setViewReset((v) => v + 1);
    setZoomOpen(false);
  }
  const ready = !loading && st.hydrated && !loadError,
    hasScene = inEditor;
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      {sidebar && (
        <aside className="sidebar" inert={!!deleting}>
          <div className="brand-row">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                st.newProject();
                resetComposer();
              }}
            >
              <Puzzle
                className="brand-puzzle"
                size={34}
                strokeWidth={1.7}
                fill="#d7cdf5"
                aria-hidden="true"
              />
              <span>syravec</span>
            </a>
            <button
              className="icon-button"
              title="переключить боковую панель"
              aria-label="переключить боковую панель"
              onClick={() => setSidebar(false)}
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
          <button
            className="new-project"
            onClick={() => {
              st.newProject();
              resetComposer();
              if (window.innerWidth <= 760) setSidebar(false);
            }}
          >
            <Plus size={18} /> новая композиция <ArrowUpRight size={16} />
          </button>
          <nav className="history" aria-label="история композиций">
            {st.projects
              .toSorted((a, b) => b.updatedAt - a.updatedAt)
              .map((p) => (
                <div
                  className={`history-row ${p.id === st.current ? "active" : ""}`}
                  key={p.id}
                >
                  {renaming === p.id ? (
                    <form
                      className="project-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        finishRename(p.id);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="название композиции"
                        maxLength={120}
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                      />
                      <button
                        type="submit"
                        aria-label="сохранить название"
                        title="сохранить название · enter"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="отменить переименование"
                        title="отменить · esc"
                        onClick={() => setRenaming(null)}
                      >
                        <X size={14} />
                      </button>
                    </form>
                  ) : (
                    <button
                      title={p.title}
                      onDoubleClick={() => {
                        setRenaming(p.id);
                        setRenameText(p.title);
                      }}
                      onClick={() => {
                        st.openProject(p.id);
                        if (window.innerWidth <= 760) setSidebar(false);
                      }}
                    >
                      <Shapes size={16} />
                      <span>{p.title}</span>
                    </button>
                  )}
                  {renaming !== p.id && (
                    <button
                      className="rename-project"
                      aria-label={`переименовать ${p.title}`}
                      title="переименовать композицию"
                      onClick={() => {
                        setRenaming(p.id);
                        setRenameText(p.title);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  <button
                    aria-label={`удалить ${p.title}`}
                    className="delete-project"
                    title="удалить композицию"
                    onClick={() => setDeleting(p.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
          </nav>
        </aside>
      )}
      <main className="main-shell" ref={mainRef} inert={!!deleting}>
        {!sidebar && (
          <button
            className="icon-button floating-sidebar-toggle"
            title="переключить боковую панель"
            aria-label="переключить боковую панель"
            onClick={() => setSidebar(true)}
          >
            <PanelLeftOpen size={18} />
          </button>
        )}
        {!ready ? (
          <div className="loading-page">
            {loading ? (
              <>
                <LoaderCircle className="spin" /> загрузка
              </>
            ) : (
              loadError || "загрузка"
            )}
          </div>
        ) : (
          <div className="workspace">
            <div className="editor-main">
              <div className="canvas-area">
                <Canvas
                  key={project?.id}
                  resetKey={viewReset}
                  scene={scene}
                  assets={assets}
                  sources={sources}
                  selected={st.selected}
                  select={st.select}
                  change={change}
                  zoom={zoom}
                  onZoom={setZoom}
                  onAssetDrop={dropAsset}
                />
              </div>
              {!hasScene && (
                <section
                  className="welcome"
                  onDragOver={(e) => {
                    if (
                      e.dataTransfer.types.includes(
                        "application/x-syravec-asset",
                      )
                    )
                      e.preventDefault();
                  }}
                  onDrop={welcomeDrop}
                >
                  <div className="welcome-inner">
                    <h1>что соберем?</h1>
                    {composer()}
                    <div className="examples">
                      {examples.map((e, i) => (
                        <button
                          key={e.title}
                          className={`example-card example-${i}`}
                          onClick={() => example(i)}
                        >
                          <div className="example-art">
                            <img src={`/assets/${e.art}.svg`} alt="" />
                            <span className="example-arrow">
                              <ArrowUpRight size={17} />
                            </span>
                          </div>
                          <div className="example-text">
                            <strong>{e.title}</strong>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              )}
              {hasScene ? (
                <div className="editor-dock">
                  <div className="dock-left">
                    <div className="history-tools">
                      <button
                        className="icon-button"
                        title="отменить · ctrl / ⌘ + z"
                        aria-label="отменить"
                        disabled={!st.past.length}
                        onClick={st.undo}
                      >
                        <Undo2 size={17} />
                      </button>
                      <button
                        className="icon-button"
                        title="повторить · ctrl / ⌘ + shift + z"
                        aria-label="повторить"
                        disabled={!st.future.length}
                        onClick={st.redo}
                      >
                        <Redo2 size={17} />
                      </button>
                    </div>
                  </div>
                  {composer()}
                  <div className="dock-right">
                    <div className="zoom-tools" ref={zoomMenuRef}>
                      <button
                        className="icon-button"
                        title="уменьшить холст"
                        aria-label="уменьшить холст"
                        onClick={() => setZoom((z) => Math.max(25, z / 1.25))}
                      >
                        <Minus size={15} />
                      </button>
                      <button
                        className="zoom-current"
                        title="текущий масштаб"
                        aria-label="текущий масштаб"
                        aria-haspopup="menu"
                        aria-expanded={zoomOpen}
                        onClick={() => setZoomOpen(!zoomOpen)}
                      >
                        {Math.round(zoom)}%<ChevronDown size={11} />
                      </button>
                      <button
                        className="icon-button"
                        title="увеличить холст"
                        aria-label="увеличить холст"
                        onClick={() => setZoom((z) => Math.min(400, z * 1.25))}
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title="вписать композицию"
                        aria-label="вписать композицию"
                        onClick={fitView}
                      >
                        <Scan size={16} />
                      </button>
                      {zoomOpen && (
                        <div
                          className="zoom-menu"
                          role="menu"
                          aria-label="масштаб холста"
                        >
                          {[25, 50, 75, 100, 150, 200, 300, 400].map(
                            (value) => (
                              <button
                                role="menuitem"
                                key={value}
                                onClick={() => {
                                  setZoom(value);
                                  setZoomOpen(false);
                                }}
                              >
                                {value}%
                              </button>
                            ),
                          )}
                          <button role="menuitem" onClick={fitView}>
                            вписать
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {hasScene && (
                <div className="stage-top-actions">
                  <button
                    className="primary-export"
                    title="экспорт svg"
                    aria-label="экспорт svg"
                    onClick={exportFile}
                  >
                    <Download size={17} /> экспорт svg
                  </button>
                </div>
              )}
              <button
                className="icon-button inspector-toggle floating-inspector-toggle"
                title="открыть инспектор"
                aria-label="открыть инспектор"
                onClick={() => setInspectorOpen(true)}
              >
                <Layers size={18} />
              </button>
            </div>
            {inspectorOpen && (
              <button
                className="inspector-backdrop"
                title="закрыть панель слоев"
                aria-label="закрыть панель слоев"
                onClick={() => setInspectorOpen(false)}
              />
            )}
            <Inspector
              scene={scene}
              assets={assets}
              selected={st.selected}
              select={st.select}
              change={change}
              add={add}
              upload={() => fileRef.current?.click()}
              uploadPalette={() => paletteRef.current?.click()}
              format={format}
              illustrationSize={illustrationSize}
              open={inspectorOpen}
              close={() => setInspectorOpen(false)}
              libraryExpanded={library}
              setLibraryExpanded={setLibrary}
              recompose={() => void generate("", true)}
              composing={busy}
              recomposing={recomposing}
              cancelRecompose={() => controller.current?.abort()}
              aiConfigured={aiConfigured}
            />
          </div>
        )}
      </main>
      {deleting && (
        <div className="confirm-backdrop" onClick={() => setDeleting(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-heading"
            aria-describedby="delete-description"
            className="confirm-delete"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (busy) return;
              if (e.key === "Escape") {
                e.stopPropagation();
                setDeleting(null);
              }
              if (e.key === "Tab") {
                const buttons =
                  e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
                const next = e.shiftKey ? buttons[0] : buttons[1];
                if (document.activeElement === next) {
                  e.preventDefault();
                  (e.shiftKey ? buttons[1] : buttons[0]).focus();
                }
              }
            }}
          >
            <h2 id="delete-heading">удалить композицию?</h2>
            <p id="delete-description">
              «{st.projects.find((p) => p.id === deleting)?.title}» и все её
              сохранённые результаты будут удалены. это действие нельзя
              отменить.
            </p>
            <div>
              <button autoFocus onClick={() => setDeleting(null)}>
                оставить
              </button>
              <button
                className="danger"
                onClick={() => {
                  st.removeProject(deleting);
                  setDeleting(null);
                }}
              >
                удалить композицию
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        hidden
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={paletteRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void paletteUpload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
  function composer() {
    const feedback = composerError || notice || st.storageError;
    return (
      <div
        className={`composer-stack ${hasScene ? "in-editor" : ""}`}
        ref={stackRef}
      >
        <div
          className={`composer ${hasScene ? "compact" : ""}`}
          aria-busy={busy}
        >
          <div className="composer-input">
            <textarea
              ref={promptRef}
              aria-label="описание композиции"
              aria-describedby={feedback ? "composer-error" : undefined}
              placeholder="идея иллюстрации или названия объектов"
              value={prompt}
              maxLength={2000}
              rows={1}
              readOnly={busy}
              onScroll={(e) => {
                if (shimmerRef.current)
                  shimmerRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (busy) return;
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void generate();
                }
              }}
            />
            {busy && (
              <div
                className="composer-prompt-shimmer"
                ref={shimmerRef}
                aria-hidden="true"
              >
                <span>{prompt}</span>
              </div>
            )}
          </div>
          <button
            className={`generate ${busy ? "is-busy" : ""}`}
            title={
              busy
                ? "остановить сборку"
                : "собрать композицию · enter (shift + enter — новая строка)"
            }
            aria-label={busy ? "остановить сборку" : "собрать композицию"}
            disabled={!ready || (!busy && !prompt.trim())}
            onClick={() =>
              busy ? controller.current?.abort() : void generate()
            }
          >
            {busy ? (
              <Square size={14} fill="currentColor" strokeWidth={0} />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </div>
        {feedback && (
          <div
            className="composer-error"
            id="composer-error"
            role={composerError || st.storageError ? "alert" : "status"}
          >
            <span>{feedback}</span>
            <button
              className="icon-button"
              title="закрыть ошибку"
              aria-label="закрыть ошибку"
              onClick={() => {
                setComposerError("");
                setNotice("");
                useStore.setState({ storageError: "" });
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }
}
