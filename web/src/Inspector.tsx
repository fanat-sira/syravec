import {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  type ReactNode,
  type PointerEvent,
} from "react";
import {
  ChevronDown,
  Plus,
  Upload,
  Download,
  Search,
  Eye,
  EyeOff,
  LockKeyhole,
  LockKeyholeOpen,
  Copy,
  Trash2,
  X,
} from "lucide-react";
import {
  panelLayout,
  resizePanels,
  PANEL_MIN,
  type PanelSizes,
} from "./panelLayout";
import { type Scene, type Asset, type Layer, palettes, uid } from "./model";
import { download } from "./svg";
interface Props {
  scene: Scene;
  assets: Asset[];
  selected: string | null;
  select: (id: string | null) => void;
  change: (s: Scene) => void;
  add: (a: Asset) => void;
  upload: () => void;
  uploadPalette: () => void;
  format: (p: Scene["canvas"]["preset"]) => void;
  open: boolean;
  close: () => void;
  libraryExpanded: boolean;
  libraryRequest: number;
  setLibraryExpanded: (v: boolean) => void;
}
function Section({
  name,
  count,
  open,
  toggle,
  children,
  kind,
  height,
}: {
  name: string;
  count?: number;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
  kind: string;
  height: number;
}) {
  return (
    <section
      className={`inspector-section ${open ? "expanded" : "collapsed"} section-${kind}`}
      style={{ height }}
    >
      <button
        className="section-heading"
        aria-expanded={open}
        aria-controls={`section-${kind}`}
        onClick={toggle}
      >
        <ChevronDown size={15} />
        <span>{name}</span>
        {count !== undefined && <span className="section-count">{count}</span>}
      </button>
      <div id={`section-${kind}`} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
export function Inspector(p: Props) {
  const [layersOpen, setLayersOpen] = useState(true),
    [propertiesOpen, setPropertiesOpen] = useState(true),
    [search, setSearch] = useState(""),
    [propertyTab, setPropertyTab] = useState<"object" | "composition">(
      "object",
    ),
    [variants, setVariants] = useState<Record<string, string>>({});
  useEffect(() => {
    setPropertyTab("object");
    if (p.selected) {
      setLayersOpen(true);
      setPriority(1);
    }
  }, [p.selected]);
  const stackRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [desired, setDesired] = useState<PanelSizes>([300, 220, 260]);
  const [priority, setPriority] = useState(2);
  useEffect(() => {
    if (p.libraryRequest) setPriority(0);
  }, [p.libraryRequest]);
  const [resizing, setResizing] = useState(false);
  const initialized = useRef(false);
  const resizeGesture = useRef<{
    index: 0 | 1;
    y: number;
    sizes: PanelSizes;
  } | null>(null);
  useLayoutEffect(() => {
    const node = stackRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.contentRect.height;
      if (height <= 0) return;
      setAvailable(height);
      if (!initialized.current) {
        initialized.current = true;
        setDesired([
          Math.round((height - 12) * 0.36),
          Math.round((height - 12) * 0.28),
          Math.round((height - 12) * 0.36),
        ]);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const layout = panelLayout(
    available,
    desired,
    [p.libraryExpanded, layersOpen, propertiesOpen],
    priority,
  );
  const toggle = (index: 0 | 1 | 2) => {
    setPriority(index);
    const next = !layout.open[index];
    if (index === 0) p.setLibraryExpanded(next);
    else if (index === 1) setLayersOpen(next);
    else setPropertiesOpen(next);
  };
  function divider(index: 0 | 1) {
    const enabled = layout.open[index] && layout.open[index + 1];
    const apply = (delta: number) =>
      setDesired(resizePanels(layout.sizes, index, delta));
    function start(e: PointerEvent<HTMLDivElement>) {
      if (!enabled || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeGesture.current = { index, y: e.clientY, sizes: layout.sizes };
      setResizing(true);
    }
    return (
      <div
        className="panel-divider"
        role="separator"
        aria-label={index === 0 ? "высота библиотеки" : "высота слоев"}
        aria-orientation="horizontal"
        aria-disabled={!enabled}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={Math.max(
          PANEL_MIN,
          layout.sizes[index] + layout.sizes[index + 1] - PANEL_MIN,
        )}
        aria-valuenow={Math.round(layout.sizes[index])}
        tabIndex={enabled ? 0 : -1}
        onPointerDown={start}
        onPointerMove={(e) => {
          const gesture = resizeGesture.current;
          if (!gesture || gesture.index !== index) return;
          setDesired(resizePanels(gesture.sizes, index, e.clientY - gesture.y));
        }}
        onPointerUp={() => {
          resizeGesture.current = null;
          setResizing(false);
        }}
        onPointerCancel={() => {
          resizeGesture.current = null;
          setResizing(false);
        }}
        onLostPointerCapture={() => {
          resizeGesture.current = null;
          setResizing(false);
        }}
        onKeyDown={(e) => {
          if (enabled && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            apply((e.key === "ArrowUp" ? -1 : 1) * (e.shiftKey ? 1 : 16));
          }
        }}
      />
    );
  }
  const [draggedLayer, setDraggedLayer] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    edge: "before" | "after";
  } | null>(null);
  function dropLayer(e: React.DragEvent, id: string) {
    const from = e.dataTransfer.getData("application/x-syravec-layer");
    if (
      !from ||
      from === id ||
      !p.scene.layers.some((l) => l.id === from && !l.locked)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = e.currentTarget.getBoundingClientRect(),
      edge = e.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    const visual = p.scene.layers.toReversed(),
      source = visual.find((l) => l.id === from)!;
    const ordered = visual.filter((l) => l.id !== from);
    const index = ordered.findIndex((l) => l.id === id);
    if (index < 0) return;
    ordered.splice(index + (edge === "after" ? 1 : 0), 0, source);
    if (ordered.toReversed().some((l, i) => l.id !== p.scene.layers[i].id))
      p.change({ ...p.scene, layers: ordered.toReversed() });
    p.select(from);
    setDraggedLayer(null);
    setDropTarget(null);
  }
  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = selectedRef.current,
      body = row?.closest(".section-body");
    if (!row || !body) return;
    const r = row.getBoundingClientRect(),
      b = body.getBoundingClientRect();
    if (r.top < b.top) body.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) body.scrollTop += r.bottom - b.bottom;
  }, [p.selected, layout.open[1], layout.sizes[1], p.scene.layers]);
  const selected = p.scene.layers.find((l) => l.id === p.selected),
    selectedAsset = p.assets.find((a) => a.id === selected?.assetId);
  const groups = p.assets
    .filter((a) => a.variant === "main")
    .map((a) => ({
      main: a,
      background: a.id.endsWith("-main")
        ? p.assets.find((b) => b.id === a.id.replace(/-main$/, "-background"))
        : undefined,
    }));
  const patch = (id: string, values: Partial<Layer>) =>
    p.change({
      ...p.scene,
      layers: p.scene.layers.map((l) =>
        l.id === id ? { ...l, ...values } : l,
      ),
    });
  const duplicate = (l: Layer) => {
    if (p.scene.layers.length >= 40) return;
    const copy = {
      ...l,
      id: uid(),
      x: Math.min(1.2, l.x + 0.04),
      y: Math.min(1.2, l.y + 0.04),
    };
    p.change({ ...p.scene, layers: [...p.scene.layers, copy] });
    p.select(copy.id);
  };
  const remove = (l: Layer) => {
    if (l.locked) return;
    p.change({
      ...p.scene,
      layers: p.scene.layers.filter((v) => v.id !== l.id),
    });
    if (p.selected === l.id) p.select(null);
  };
  const reorder = (l: Layer, delta: number) => {
    if (l.locked) return;
    const arr = [...p.scene.layers],
      i = arr.findIndex((v) => v.id === l.id),
      j = i + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    p.change({ ...p.scene, layers: arr });
  };
  const thumbnail = (a: Asset) =>
    a.svg ? `data:image/svg+xml,${encodeURIComponent(a.svg)}` : a.assetUrl;
  return (
    <aside
      className={`inspector ${p.open ? "is-open" : ""}`}
      aria-label="инспектор"
    >
      <button
        className="icon-button inspector-close"
        title="закрыть слои"
        aria-label="закрыть слои"
        onClick={p.close}
      >
        <X size={17} />
      </button>
      <div
        className={`inspector-stack ${resizing ? "resizing" : ""}`}
        ref={stackRef}
      >
        <Section
          name="библиотека"
          count={groups.length}
          open={layout.open[0]}
          toggle={() => toggle(0)}
          height={layout.sizes[0]}
          kind="library"
        >
          <div className="library-controls">
            <div className="search">
              <Search size={15} />
              <input
                aria-label="поиск объектов"
                placeholder="поиск"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              className="icon-button"
              title="загрузить svg"
              aria-label="загрузить svg"
              onClick={p.upload}
            >
              <Upload size={17} />
            </button>
          </div>
          <p className="library-hint">
            + на холст · миниатюру можно перетащить
          </p>
          <div className="asset-grid">
            {groups
              .filter((g) =>
                g.main.displayName.toLowerCase().includes(search.toLowerCase()),
              )
              .map(({ main, background }) => {
                const a =
                  variants[main.id] === "background" && background
                    ? background
                    : main;
                return (
                  <article
                    className="asset-card"
                    data-variant={a.variant}
                    key={main.id}
                    data-asset={main.id}
                  >
                    <div
                      className="asset-preview"
                      draggable
                      title={`перетащить ${main.displayName} на холст`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "application/x-syravec-asset",
                          a.id,
                        );
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      <span className="variant-badge">
                        {a.variant === "main" ? "основной" : "фоновый"}
                      </span>
                      <img
                        src={thumbnail(a)}
                        alt={a.displayName}
                        draggable={false}
                      />
                    </div>
                    <div className="asset-card-heading">
                      <span>{main.displayName}</span>
                    </div>
                    <div className="asset-card-controls">
                      <select
                        aria-label={`вариант ${main.displayName}`}
                        value={a.variant}
                        onChange={(e) =>
                          setVariants({
                            ...variants,
                            [main.id]: e.target.value,
                          })
                        }
                      >
                        <option value="main">главный</option>
                        {background && (
                          <option value="background">фоновый</option>
                        )}
                      </select>
                      <button
                        title={`добавить ${main.displayName} на холст`}
                        aria-label={`добавить ${main.displayName} на холст`}
                        disabled={p.scene.layers.length >= 40}
                        onClick={() => p.add(a)}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </Section>
        {divider(0)}
        <Section
          name="слои"
          count={p.scene.layers.length}
          open={layout.open[1]}
          toggle={() => toggle(1)}
          height={layout.sizes[1]}
          kind="layers"
        >
          <div className="layer-list">
            {p.scene.layers.toReversed().map((l) => {
              const a = p.assets.find((a) => a.id === l.assetId),
                active = l.id === p.selected;
              return (
                <div
                  className={`layer-row ${active ? "active" : ""} ${draggedLayer === l.id ? "dragging" : ""} ${dropTarget?.id === l.id ? "drop-" + dropTarget.edge : ""}`}
                  draggable={!l.locked}
                  onDragStart={(e) => {
                    if (l.locked) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData("application/x-syravec-layer", l.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggedLayer(l.id);
                    p.select(l.id);
                  }}
                  onDragOver={(e) => {
                    if (
                      !e.dataTransfer.types.includes(
                        "application/x-syravec-layer",
                      ) ||
                      draggedLayer === l.id
                    )
                      return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropTarget({
                      id: l.id,
                      edge:
                        e.clientY < r.top + r.height / 2 ? "before" : "after",
                    });
                  }}
                  onDrop={(e) => dropLayer(e, l.id)}
                  onDragEnd={() => {
                    setDraggedLayer(null);
                    setDropTarget(null);
                  }}
                  key={l.id}
                  ref={active ? selectedRef : undefined}
                  data-layer={l.id}
                >
                  <div className="layer-main">
                    <button
                      className="layer-select"
                      draggable={!l.locked}
                      onKeyDown={(e) => {
                        if (
                          e.altKey &&
                          (e.key === "ArrowUp" || e.key === "ArrowDown")
                        ) {
                          e.preventDefault();
                          reorder(l, e.key === "ArrowUp" ? 1 : -1);
                        }
                      }}
                      title="перетащить слой, alt + стрелки для изменения порядка"
                      aria-pressed={active}
                      onClick={() => p.select(l.id)}
                    >
                      {a && <img src={thumbnail(a)} alt="" draggable={false} />}
                      <span>
                        {a?.displayName}
                        <small>
                          {a?.variant === "background" ? "фоновый" : "главный"}
                        </small>
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      title={l.visible ? "скрыть слой" : "показать слой"}
                      aria-label={l.visible ? "скрыть слой" : "показать слой"}
                      onClick={() => patch(l.id, { visible: !l.visible })}
                    >
                      {l.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                    <button
                      className="icon-button"
                      title={
                        active
                          ? "блокировка слоя"
                          : `блокировка ${a?.displayName}`
                      }
                      aria-label={
                        active
                          ? "блокировка слоя"
                          : `блокировка ${a?.displayName}`
                      }
                      aria-pressed={l.locked}
                      onClick={() => patch(l.id, { locked: !l.locked })}
                    >
                      {l.locked ? (
                        <LockKeyhole size={15} />
                      ) : (
                        <LockKeyholeOpen size={15} />
                      )}
                    </button>
                    <button
                      className="icon-button layer-duplicate"
                      title={
                        active
                          ? "дублировать объект"
                          : `дублировать ${a?.displayName}`
                      }
                      aria-label={
                        active
                          ? "дублировать объект"
                          : `дублировать ${a?.displayName}`
                      }
                      disabled={p.scene.layers.length >= 40}
                      onClick={() => duplicate(l)}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button layer-delete"
                      disabled={l.locked}
                      title={
                        active ? "удалить объект" : `удалить ${a?.displayName}`
                      }
                      aria-label={
                        active ? "удалить объект" : `удалить ${a?.displayName}`
                      }
                      onClick={() => remove(l)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
        {divider(1)}
        <Section
          name="свойства"
          open={layout.open[2]}
          toggle={() => toggle(2)}
          height={layout.sizes[2]}
          kind="properties"
        >
          <div className="properties">
            {selected && (
              <div
                className="property-tabs"
                aria-label="свойства объекта и композиции"
              >
                <button
                  aria-pressed={propertyTab === "object"}
                  onClick={() => setPropertyTab("object")}
                >
                  объект
                </button>
                <button
                  aria-pressed={propertyTab === "composition"}
                  onClick={() => setPropertyTab("composition")}
                >
                  композиция
                </button>
              </div>
            )}
            {selected && propertyTab === "object" ? (
              <>
                <div className="properties-name">
                  {selectedAsset?.displayName}
                </div>
                <label>
                  положение, %
                  <div className="input-pair">
                    {(["x", "y"] as const).map((axis) => (
                      <span key={axis}>
                        {axis}
                        <input
                          aria-label={`позиция ${axis}`}
                          type="number"
                          min={-20}
                          max={120}
                          value={Math.round(selected[axis] * 100)}
                          disabled={selected.locked}
                          onChange={(e) =>
                            patch(selected.id, {
                              [axis]: Math.max(
                                -0.2,
                                Math.min(1.2, Number(e.target.value) / 100),
                              ),
                            })
                          }
                        />
                      </span>
                    ))}
                  </div>
                </label>
                {(
                  [
                    {
                      key: "scale",
                      name: "масштаб",
                      min: 0.1,
                      max: 6,
                      step: 0.01,
                      value: Math.round(selected.scale * 100) + "%",
                    },
                    {
                      key: "rotation",
                      name: "поворот",
                      min: -180,
                      max: 180,
                      step: 1,
                      value: Math.round(selected.rotation) + "°",
                    },
                    {
                      key: "opacity",
                      name: "непрозрачность",
                      min: 0,
                      max: 1,
                      step: 0.01,
                      value: Math.round(selected.opacity * 100) + "%",
                    },
                  ] as const
                ).map((field) => (
                  <label key={field.key}>
                    {field.name}
                    <span>{field.value}</span>
                    <input
                      aria-label={field.name}
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={selected[field.key]}
                      disabled={selected.locked}
                      onChange={(e) =>
                        patch(selected.id, {
                          [field.key]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  вариант svg
                  <select
                    aria-label="вариант svg"
                    value={selected.assetId}
                    disabled={selected.locked || !!selectedAsset?.svg}
                    onChange={(e) =>
                      patch(selected.id, { assetId: e.target.value })
                    }
                  >
                    {p.assets
                      .filter(
                        (a) =>
                          a.id === selected.assetId ||
                          (!selectedAsset?.svg &&
                            a.id.replace(/-(main|background)$/, "") ===
                              selected.assetId.replace(
                                /-(main|background)$/,
                                "",
                              )),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.variant === "main" ? "главный" : "фоновый"}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <div className="properties-name">композиция</div>
                <label>
                  формат
                  <select
                    aria-label="формат композиции"
                    value={p.scene.canvas.preset}
                    onChange={(e) =>
                      p.format(e.target.value as Scene["canvas"]["preset"])
                    }
                  >
                    <option value="square">квадрат · 1:1</option>
                    <option value="landscape">альбом · 1000:633</option>
                    <option value="portrait">портрет · 3:4</option>
                  </select>
                </label>
                <div className="composition-size">
                  {p.scene.canvas.width} × {p.scene.canvas.height} px
                </div>
                <label>
                  палитра
                  <select
                    aria-label="палитра композиции"
                    value={p.scene.palette}
                    onChange={(e) =>
                      p.change({
                        ...p.scene,
                        palette: e.target.value as Scene["palette"],
                        backgroundId:
                          p.scene.canvas.preset === "portrait" ||
                          e.target.value === "custom"
                            ? ""
                            : `background-${p.scene.canvas.preset}-${e.target.value}`,
                      })
                    }
                  >
                    {palettes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    {p.scene.customPalette && (
                      <option value="custom">своя палитра</option>
                    )}
                  </select>
                </label>
                <div className="palette-previews" aria-label="цвета палитр">
                  {[
                    ...palettes,
                    ...(p.scene.customPalette ? [p.scene.customPalette] : []),
                  ].map((palette) => (
                    <button
                      key={palette.id}
                      title={palette.name}
                      aria-label={`палитра ${palette.name}`}
                      aria-pressed={p.scene.palette === palette.id}
                      onClick={() =>
                        p.change({
                          ...p.scene,
                          palette: palette.id,
                          backgroundId:
                            p.scene.canvas.preset === "portrait" ||
                            palette.id === "custom"
                              ? ""
                              : `background-${p.scene.canvas.preset}-${palette.id}`,
                        })
                      }
                    >
                      {[
                        palette.strong,
                        palette.medium,
                        palette.light,
                        palette.highlight,
                        palette.pink,
                        palette.soft,
                      ].map((color, i) => (
                        <span key={i} style={{ background: color }} />
                      ))}
                    </button>
                  ))}
                </div>
                <div className="palette-actions">
                  <button className="text-button" onClick={p.uploadPalette}>
                    <Upload size={15} /> загрузить палитру
                  </button>
                  <button
                    className="icon-button"
                    title="скачать пример палитры"
                    aria-label="скачать пример палитры"
                    onClick={() =>
                      download(
                        JSON.stringify(palettes[0], null, 2),
                        "palette.json",
                        "application/json",
                      )
                    }
                  >
                    <Download size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </Section>
      </div>
    </aside>
  );
}
