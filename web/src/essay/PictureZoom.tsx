import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, type DiffFile, type DiffLine, type FileView, type PictureNode, type PrRoute, type WalkthroughData } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { languageForFile, renderCodeLine } from "../components/highlight.ts";
import { Mermaid, type ClickedNode, type NodeChange } from "../components/Mermaid.tsx";
import { CodeFigure } from "./CodeFigure.tsx";
import type { Figure } from "./model.ts";
import type { ReviewSession } from "./session.ts";
import { linesInRange, wholeFileLines } from "./splitRows.ts";

const ZOOM_MS = 620;
const EASE = "cubic-bezier(0.7, 0, 0.25, 1)";

type Picture = WalkthroughData["walkthrough"]["picture"];

type NodeLookup = { nodes: PictureNode[]; isLoading: boolean; error: string | null };

type Zoom = { clicked: ClickedNode; from: DOMRect };

function motionMs(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ZOOM_MS;
}

/** Where each box lives in the code; on older builds it asks Claude on the first click, never before. */
function usePictureNodes(route: PrRoute, picture: Picture): { lookup: NodeLookup; findNodes: () => void } {
  const known = picture.nodes ?? [];
  const [lookup, setLookup] = useState<NodeLookup>({ nodes: known, isLoading: false, error: null });
  const hasAsked = useRef(known.length > 0);
  const findNodes = () => {
    if (hasAsked.current) return;
    hasAsked.current = true;
    setLookup({ nodes: [], isLoading: true, error: null });
    api.pictureNodes(route).then(
      (nodes) => setLookup({ nodes, isLoading: false, error: null }),
      (error: Error) => setLookup({ nodes: [], isLoading: false, error: error.message }),
    );
  };
  return { lookup, findNodes };
}

/** Dives the camera into the clicked box, or back out of it. */
function moveCamera(camera: HTMLElement, box: DOMRect, isIn: boolean): Animation {
  const view = camera.getBoundingClientRect();
  const scale = Math.min(8, Math.min(view.width / box.width, view.height / box.height) * 0.9);
  camera.style.transformOrigin = `${box.left + box.width / 2 - view.left}px ${box.top + box.height / 2 - view.top}px`;
  const wide = { transform: "scale(1)", opacity: 1, filter: "blur(0px)" };
  const close = { transform: `scale(${scale})`, opacity: 0, filter: "blur(3px)" };
  return camera.animate(isIn ? [wide, close] : [close, wide], { duration: motionMs(), easing: EASE, fill: "forwards" });
}

/** The transform that makes the panel sit exactly on the box. */
function shrinkToBox(panel: HTMLElement, box: DOMRect): string {
  const final = panel.getBoundingClientRect();
  const scaleX = box.width / final.width;
  const scaleY = box.height / final.height;
  return `translate(${box.left - final.left}px, ${box.top - final.top}px) scale(${scaleX}, ${scaleY})`;
}

const BOX_TINT: Record<NodeChange, string> = { added: "--color-accent-200", changed: "--color-accent-2-200", existing: "--color-surface" };

function tokenColor(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

function growPanel(panel: HTMLElement, box: DOMRect, isOpening: boolean): Animation {
  const tint = tokenColor(BOX_TINT[panel.dataset.change as NodeChange] ?? BOX_TINT.existing);
  const onBox = { transform: shrinkToBox(panel, box), borderRadius: "40px", backgroundColor: tint };
  const full = { transform: "none", borderRadius: "2px", backgroundColor: tokenColor("--color-bg") };
  return panel.animate(isOpening ? [onBox, full] : [full, onBox], { duration: motionMs(), easing: EASE, fill: "forwards" });
}

function fade(element: HTMLElement, isIn: boolean, delay = 0): Animation {
  const frames = isIn ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  return element.animate(frames, { duration: motionMs() * 0.5, delay: motionMs() * delay, easing: "ease-out", fill: "both" });
}

/** Keeps the page still while the zoomed view is open. */
function useScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isLocked]);
}

function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onEscape();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}

const CHANGE_LABEL: Record<NodeChange, string> = { added: "Added by this PR", changed: "Changed by this PR", existing: "Existing code" };

function fileIn(data: WalkthroughData, path: string): DiffFile | undefined {
  return data.files.find((file) => file.path === path);
}

function useFileView(route: PrRoute, path: string) {
  const [view, setView] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    api.file(route, path).then(setView, (fileError: Error) => setError(fileError.message));
  }, [path]);
  return { view, error };
}

/** What the PR did to these lines, which can differ from the diagram's own label. */
function changeOfLines(lines: DiffLine[]): NodeChange {
  const isTouched = lines.some((line) => line.kind !== "ctx");
  if (!isTouched) return "existing";
  return lines.every((line) => line.kind === "add") ? "added" : "changed";
}

function rangeLinesOf(node: PictureNode, view: FileView | null, diff: DiffFile | undefined): DiffLine[] {
  return view && diff ? linesInRange(wholeFileLines(view.lines, diff), node.startLine, node.endLine) : [];
}

function rangeFigure(node: PictureNode, lines: DiffLine[]): Figure {
  return { id: `zoom-${node.id}`, number: "", file: node.file, lines, firstLine: node.startLine, lastLine: node.endLine, questionsAfter: [] };
}

function PlainCode({ node, view }: { node: PictureNode; view: FileView }) {
  const language = languageForFile(node.file);
  const lines = view.lines.slice(node.startLine - 1, node.endLine);
  return (
    <div className="fig-body plain-code">
      {lines.map((text, lineIndex) => (
        <div key={lineIndex} className="plain-row">
          <span className="fig-number">{node.startLine + lineIndex}</span>
          <span className="code" dangerouslySetInnerHTML={{ __html: renderCodeLine(text, language, false) || " " }} />
        </div>
      ))}
    </div>
  );
}

type NodeCodeProps = { node: PictureNode; session: ReviewSession; data: WalkthroughData; onChangeKnown: (change: NodeChange) => void };

/** The function behind the box: side by side if this PR touched it, plain otherwise. */
function NodeCode({ node, session, data, onChangeKnown }: NodeCodeProps) {
  const { view, error } = useFileView(session.route, node.file);
  const diff = fileIn(data, node.file);
  const lines = rangeLinesOf(node, view, diff);
  const change = changeOfLines(lines);
  useEffect(() => {
    if (view) onChangeKnown(change);
  }, [view]);
  if (error) return <p className="muted">Could not read {node.file}: {error}</p>;
  if (!view) return <p className="muted">Opening {node.file}…</p>;
  if (!diff || change === "existing") return <PlainCode node={node} view={view} />;
  return <CodeFigure figure={rangeFigure(node, lines)} diff={diff} session={session} />;
}

type BodyProps = { zoom: Zoom; lookup: NodeLookup; session: ReviewSession; data: WalkthroughData; onChangeKnown: (change: NodeChange) => void };

function ZoomBody({ zoom, lookup, session, data, onChangeKnown }: BodyProps) {
  const node = lookup.nodes.find((candidate) => candidate.id === zoom.clicked.id);
  if (lookup.isLoading) return <p className="muted">Finding this box in the code. This happens once per PR.</p>;
  if (lookup.error) return <p className="muted">Could not find this box in the code: {lookup.error}</p>;
  if (!node?.file) return <p className="muted">This box is not code in this repo, so there is nothing to look inside.</p>;
  return <NodeCode node={node} session={session} data={data} onChangeKnown={onChangeKnown} />;
}

type PanelProps = { zoom: Zoom; lookup: NodeLookup; session: ReviewSession; data: WalkthroughData; onClose: () => void; onGoTo: (node: PictureNode) => void };

function ZoomHeader({ zoom, lookup, change, onClose, onGoTo }: Pick<PanelProps, "zoom" | "lookup" | "onClose" | "onGoTo"> & { change: NodeChange }) {
  const node = lookup.nodes.find((candidate) => candidate.id === zoom.clicked.id);
  const where = node?.file ? `${node.file}:${node.startLine}–${node.endLine}` : "";
  return (
    <header className="zoom-header">
      <div>
        <div className={`small-caps zoom-kind is-${change}`}>Inside · {CHANGE_LABEL[change]}</div>
        <h2 className="zoom-title">{zoom.clicked.label}</h2>
        {where ? <div className="mono small muted">{where}</div> : null}
      </div>
      <div className="zoom-actions">
        {node?.file ? <button className="btn btn-secondary btn-small" onClick={() => onGoTo(node)}>Find it in the walkthrough</button> : null}
        <button className="btn btn-primary btn-small" onClick={onClose}><Icon name="x" size={14} /> Zoom out</button>
      </div>
    </header>
  );
}

/** Grows out of the clicked box to fill the screen, and shrinks back into it on close. */
function ZoomPanel(props: PanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [change, setChange] = useState<NodeChange>(props.zoom.clicked.change);
  useLayoutEffect(() => {
    growPanel(panel.current!, props.zoom.from, true);
    fade(content.current!, true, 0.55);
  }, []);
  return (
    <div className="zoom-panel" ref={panel} data-change={props.zoom.clicked.change} role="dialog" aria-label={props.zoom.clicked.label}>
      <div className="zoom-content" ref={content}>
        <ZoomHeader zoom={props.zoom} lookup={props.lookup} change={change} onClose={props.onClose} onGoTo={props.onGoTo} />
        <ZoomBody zoom={props.zoom} lookup={props.lookup} session={props.session} data={props.data} onChangeKnown={setChange} />
      </div>
    </div>
  );
}

function Backdrop({ onClick }: { onClick: () => void }) {
  const backdrop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    fade(backdrop.current!, true);
  }, []);
  return <div className="zoom-backdrop" ref={backdrop} onClick={onClick} />;
}

function DiagramLegend() {
  return (
    <div className="legend small muted">
      <span><span className="legend-swatch added" /> added by this PR</span>
      <span><span className="legend-swatch changed" /> changed by this PR</span>
    </div>
  );
}

/** Plays the zoom-out, then removes the panel. */
async function zoomOut(layer: HTMLElement, camera: HTMLElement, zoom: Zoom) {
  const panel = layer.querySelector<HTMLElement>(".zoom-panel")!;
  const backdrop = layer.querySelector<HTMLElement>(".zoom-backdrop")!;
  fade(panel.querySelector<HTMLElement>(".zoom-content")!, false);
  fade(backdrop, false, 0.3);
  growPanel(panel, zoom.from, false);
  await moveCamera(camera, zoom.from, false).finished;
}

/** The big picture: click a box to dive into the code behind it. */
export function ZoomablePicture({ session, data }: { session: ReviewSession; data: WalkthroughData }) {
  const picture = data.walkthrough.picture;
  const { lookup, findNodes } = usePictureNodes(session.route, picture);
  const camera = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  useScrollLock(zoom !== null);
  const open = useCallback((clicked: ClickedNode) => {
    const from = clicked.element.getBoundingClientRect();
    findNodes();
    moveCamera(camera.current!, from, true);
    setZoom({ clicked, from });
  }, []);
  const close = useCallback(async () => {
    if (!zoom || !layer.current) return;
    await zoomOut(layer.current, camera.current!, zoom);
    camera.current!.getAnimations().forEach((animation) => animation.cancel());
    setZoom(null);
  }, [zoom]);
  useEscape(() => void close());
  const goTo = (node: PictureNode) => {
    camera.current!.getAnimations().forEach((animation) => animation.cancel());
    setZoom(null);
    session.openLine(node.file, node.startLine, "RIGHT");
  };
  if (!picture?.diagram.trim()) return null;
  return (
    <section id="picture">
      <h2><Icon name="map" /> The big picture</h2>
      <div className="small muted">{picture.caption} · <Icon name="magnifyPlus" size={14} /> Click a box to look inside.</div>
      <div className="picture-stage"><div className="picture-camera" ref={camera}><Mermaid source={picture.diagram} onNodeClick={open} /></div></div>
      <DiagramLegend />
      {zoom ? (
        <div className="zoom-layer" ref={layer}>
          <Backdrop onClick={() => void close()} />
          <ZoomPanel zoom={zoom} lookup={lookup} session={session} data={data} onClose={() => void close()} onGoTo={goTo} />
        </div>
      ) : null}
    </section>
  );
}
