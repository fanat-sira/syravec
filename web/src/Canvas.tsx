import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useLayoutEffect,
  type PointerEvent,
} from "react";
import {
  type Scene,
  type Layer,
  type Asset,
  size,
  transform,
  uid,
} from "./model";
import { markup, paletteFor, backgroundMarkup } from "./svg";
interface Props {
  scene: Scene;
  assets: Asset[];
  sources: Record<string, string>;
  selected: string | null;
  select: (id: string | null) => void;
  change: (s: Scene) => void;
  zoom: number;
  resetKey?: number;
  onZoom: (zoom: number) => void;
  onAssetDrop: (assetId: string, x: number, y: number) => void;
}
export function Canvas({
  scene,
  assets,
  sources,
  selected,
  select,
  change,
  zoom,
  resetKey = 0,
  onZoom,
  onAssetDrop,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fitAreaRef = useRef<HTMLDivElement>(null);
  const spaceRef = useRef(false);
  const [space, setSpace] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panGesture = useRef<{
    x: number;
    y: number;
    origin: { x: number; y: number };
    pointerId: number;
  } | null>(null);
  const stopPan = () => {
    panGesture.current = null;
    setPanning(false);
  };
  useEffect(() => {
    function down(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        e.code !== "Space" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        target.matches("input,textarea,select") ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      spaceRef.current = true;
      setSpace(true);
    }
    function up(e: KeyboardEvent) {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpace(false);
      }
    }
    function blur() {
      spaceRef.current = false;
      setSpace(false);
      const g = panGesture.current;
      if (g && viewportRef.current?.hasPointerCapture(g.pointerId))
        viewportRef.current.releasePointerCapture(g.pointerId);
      stopPan();
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(
    () => setPan({ x: 0, y: 0 }),
    [resetKey, scene.canvas.width, scene.canvas.height],
  );
  function viewportDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      e.stopPropagation();
      panGesture.current = {
        x: e.clientX,
        y: e.clientY,
        origin: pan,
        pointerId: e.pointerId,
      };
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (e.button === 0 && !(e.target as Element).closest(".artboard"))
      select(null);
  }
  function viewportMove(e: PointerEvent<HTMLDivElement>) {
    const g = panGesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    setPan({
      x: g.origin.x + e.clientX - g.x,
      y: g.origin.y + e.clientY - g.y,
    });
  }
  function viewportEnd(e: PointerEvent<HTMLDivElement>) {
    const g = panGesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    stopPan();
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const [fit, setFit] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    function wheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const previous = zoomRef.current;
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node!.clientHeight : 1);
      const next = Math.max(
        25,
        Math.min(400, previous * Math.exp(-delta * 0.002)),
      );
      if (next === previous) return;
      const bounds = wrapRef.current!.getBoundingClientRect(),
        factor = next / previous;
      setPan((p) => ({
        x: p.x + (1 - factor) * (e.clientX - bounds.left - bounds.width / 2),
        y: p.y + (1 - factor) * (e.clientY - bounds.top - bounds.height / 2),
      }));
      zoomRef.current = next;
      onZoom(next);
    }
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [onZoom]);
  function drop(e: React.DragEvent<HTMLDivElement>) {
    const id = e.dataTransfer.getData("application/x-syravec-asset");
    if (!id) return;
    e.preventDefault();
    setDragOver(false);
    if (!assets.some((a) => a.id === id) || !ref.current?.getScreenCTM())
      return;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      ref.current.getScreenCTM()!.inverse(),
    );
    onAssetDrop(
      id,
      Math.max(0, Math.min(1, point.x / scene.canvas.width)),
      Math.max(0, Math.min(1, point.y / scene.canvas.height)),
    );
  }

  useLayoutEffect(() => {
    const parent = fitAreaRef.current;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const contentWidth = Math.max(1, width),
        contentHeight = Math.max(1, height);
      const gutter = Math.min(
        24,
        Math.max(4, Math.min(contentWidth, contentHeight) * 0.04),
      );
      setFit(
        Math.max(
          1,
          Math.min(
            760,
            contentWidth - gutter * 2,
            ((contentHeight - gutter * 2) * scene.canvas.width) /
              scene.canvas.height,
          ),
        ),
      );
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [scene.canvas.width, scene.canvas.height]);
  const [draft, setDraft] = useState<Layer | null>(null);
  const drag = useRef<{
    kind: string;
    start: { x: number; y: number };
    layer: Layer;
    distance: number;
    angle: number;
    latest: Layer;
    duplicate: boolean;
    moved: boolean;
    screenStart: { x: number; y: number };
  } | null>(null);
  const p = paletteFor(scene),
    { width: w, height: h } = scene.canvas;
  const local = (e: PointerEvent) => {
    const point = ref.current!.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const t = point.matrixTransform(ref.current!.getScreenCTM()!.inverse());
    return { x: t.x, y: t.y };
  };
  function start(e: PointerEvent, l: Layer, kind = "move") {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(l.id);
    if (l.locked || (kind === "move" && e.altKey && scene.layers.length >= 40))
      return;
    e.preventDefault();
    const pt = local(e),
      dx = pt.x - l.x * w,
      dy = pt.y - l.y * h;
    const duplicate = kind === "move" && e.altKey;
    drag.current = {
      kind,
      start: pt,
      layer: { ...l, id: duplicate ? uid() : l.id },
      latest: l,
      duplicate,
      moved: false,
      screenStart: { x: e.clientX, y: e.clientY },
      distance: Math.max(1, Math.hypot(dx, dy)),
      angle: Math.atan2(dy, dx),
    };
    ref.current!.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (
      !d.moved &&
      Math.hypot(e.clientX - d.screenStart.x, e.clientY - d.screenStart.y) < 3
    )
      return;
    d.moved = true;
    const pt = local(e),
      l = { ...d.layer };
    if (d.kind === "move") {
      l.x = Math.max(-0.2, Math.min(1.2, l.x + (pt.x - d.start.x) / w));
      l.y = Math.max(-0.2, Math.min(1.2, l.y + (pt.y - d.start.y) / h));
    } else if (d.kind === "scale") {
      l.scale = Math.max(
        0.1,
        Math.min(
          6,
          (l.scale * Math.hypot(pt.x - l.x * w, pt.y - l.y * h)) / d.distance,
        ),
      );
    } else {
      l.rotation =
        d.layer.rotation +
        ((Math.atan2(pt.y - l.y * h, pt.x - l.x * w) - d.angle) * 180) /
          Math.PI;
      if (e.shiftKey) l.rotation = Math.round(l.rotation / 15) * 15;
    }
    d.latest = l;
    setDraft(l);
  }
  function end() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDraft(null);
    if (!d.moved) return;
    if (d.duplicate) {
      change({ ...scene, layers: [...scene.layers, d.latest] });
      select(d.latest.id);
      return;
    }
    if (JSON.stringify(d.latest) !== JSON.stringify(d.layer))
      change({
        ...scene,
        layers: scene.layers.map((l) => (l.id === d.layer.id ? d.latest : l)),
      });
  }
  const bg = useMemo(() => backgroundMarkup(scene, sources), [sources, scene]);
  const selectedLayer = draft ?? scene.layers.find((l) => l.id === selected),
    a = assets.find((a) => a.id === selectedLayer?.assetId);
  return (
    <div
      className={`scene-viewport ${space ? "pan-ready" : ""} ${panning ? "is-panning" : ""} ${dragOver ? "is-drag-over" : ""} ${scene.layers.length ? "" : "is-empty"}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-syravec-asset")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragOver(false);
      }}
      onDrop={drop}
      ref={viewportRef}
      onPointerDownCapture={viewportDown}
      onPointerMoveCapture={viewportMove}
      onPointerUpCapture={viewportEnd}
      onPointerCancelCapture={viewportEnd}
      onLostPointerCapture={stopPan}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
    >
      <div className="stage-fit-area" ref={fitAreaRef}>
        <div
          ref={wrapRef}
          className="artboard-wrap"
          style={{
            width: fit ? `${(fit * zoom) / 100}px` : "100%",
            height: fit ? `${(fit * zoom * h) / (100 * w)}px` : "auto",
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
          }}
        >
          <svg
            ref={ref}
            className="artboard"
            aria-label="холст композиции"
            role="img"
            viewBox={`0 0 ${w} ${h}`}
            onPointerDown={(e) => {
              if (e.button === 0) select(null);
            }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => {
              drag.current = null;
              setDraft(null);
            }}
          >
            <defs>
              <clipPath id="canvas-clip">
                <rect width={w} height={h} />
              </clipPath>
            </defs>
            <g clipPath="url(#canvas-clip)">
              <rect width={w} height={h} fill={p.light} />
              {bg && <g dangerouslySetInnerHTML={{ __html: bg }} />}
              {(draft && drag.current?.duplicate
                ? [...scene.layers, draft]
                : scene.layers
              )
                .filter((l) => l.visible)
                .map((original) => {
                  const l = draft?.id === original.id ? draft : original,
                    asset = assets.find((a) => a.id === l.assetId),
                    raw = sources[l.assetId] ?? asset?.svg;
                  if (!asset || !raw) return null;
                  return (
                    <g
                      key={l.id}
                      opacity={l.opacity}
                      transform={transform(scene, l, asset)}
                      onPointerDown={(e) => start(e, l)}
                      style={{ cursor: l.locked ? "not-allowed" : "grab" }}
                      data-layer-id={l.id}
                    >
                      <rect
                        x={asset.viewBox[0]}
                        y={asset.viewBox[1]}
                        width={asset.viewBox[2]}
                        height={asset.viewBox[3]}
                        fill="transparent"
                        pointerEvents="all"
                      />
                      <g
                        dangerouslySetInnerHTML={{
                          __html: markup(raw, `object-${l.id}`, p, !asset.svg),
                        }}
                      />
                    </g>
                  );
                })}
            </g>
            {selectedLayer &&
              a &&
              selectedLayer.visible &&
              (() => {
                const l = selectedLayer,
                  { w: bw, h: bh } = size(scene, l, a);
                return (
                  <g
                    transform={`translate(${l.x * w} ${l.y * h}) rotate(${l.rotation})`}
                    className="selection"
                  >
                    <rect
                      x={-bw / 2 - 8}
                      y={-bh / 2 - 8}
                      width={bw + 16}
                      height={bh + 16}
                      fill="none"
                      stroke="white"
                      strokeWidth="5"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    <rect
                      x={-bw / 2 - 8}
                      y={-bh / 2 - 8}
                      width={bw + 16}
                      height={bh + 16}
                      fill="none"
                      stroke="#6b50c7"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray={l.locked ? "5 5" : undefined}
                    />
                    {!l.locked && (
                      <>
                        <line
                          x1={0}
                          y1={-bh / 2 - 8}
                          x2={0}
                          y2={-bh / 2 - 45}
                          stroke="#6b50c7"
                          strokeWidth="2"
                        />
                        <circle
                          aria-label="повернуть объект"
                          cx={0}
                          cy={-bh / 2 - 45}
                          r={12}
                          fill="white"
                          stroke="#6b50c7"
                          strokeWidth="2"
                          onPointerDown={(e) => start(e, l, "rotate")}
                          style={{ cursor: "crosshair" }}
                        />
                        {[-1, 1].flatMap((x) =>
                          [-1, 1].map((y) => (
                            <rect
                              key={`${x}${y}`}
                              aria-label="изменить размер"
                              x={x * (bw / 2 + 8) - 8}
                              y={y * (bh / 2 + 8) - 8}
                              width={16}
                              height={16}
                              rx={3}
                              fill="white"
                              stroke="#6b50c7"
                              strokeWidth="2"
                              onPointerDown={(e) => start(e, l, "scale")}
                              style={{ cursor: "nwse-resize" }}
                            />
                          )),
                        )}
                      </>
                    )}
                  </g>
                );
              })()}
          </svg>
        </div>
      </div>
    </div>
  );
}
