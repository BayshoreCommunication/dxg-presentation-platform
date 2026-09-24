"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/**
 * A slide deck laid out the way presenters know it (D-075): numbered thumbnails down
 * the left, the chosen slide large on the right — rather than the browser's generic
 * PDF viewer. The slides are the version's PDF preview (D-074), drawn with pdf.js.
 *
 * Thumbnails render only once scrolled into view, so a 100-slide deck opens as fast
 * as a 5-slide one. Arrow keys, Page Up/Down, Home and End move between slides while
 * the viewer has focus.
 */
export function SlideViewer({ url, title }: { url: string; title: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const shell = useRef<HTMLDivElement>(null);

  /*
   * Full screen is the viewer covering the window, which always works; the browser's
   * own full screen is asked for on top of that where it is allowed. Relying on the
   * browser alone did nothing in embedded browsers, which leave the request unanswered —
   * and the slide area was a fixed 520 px, so even a granted request left it small.
   */
  const enter = () => {
    setExpanded(true);
    // The whole page, not the viewer: the viewer's element is replaced when it moves to
    // <body>, and a full-screen element that leaves the page ends full screen.
    const request = document.documentElement.requestFullscreen?.();
    if (request) request.catch(() => undefined);
  };
  const leave = useCallback(() => {
    setExpanded(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  // Keyboard paging keeps working after the viewer moves in or out of full screen
  // (not on first render — opening the page must not take focus).
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    shell.current?.focus({ preventScroll: true });
  }, [expanded]);

  // Leaving the browser's full screen (its own Esc) leaves ours too.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    setCurrent(1);
    (async () => {
      try {
        // Loaded on demand: pdf.js uses browser-only APIs and is only needed here.
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`The preview could not be loaded (${response.status}).`);
        const data = new Uint8Array(await response.arrayBuffer());
        loaded = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        setDoc(loaded);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "The preview could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
  }, [url]);

  const count = doc?.numPages ?? 0;
  const go = useCallback((page: number) => setCurrent((now) => Math.min(Math.max(1, page), count || now)), [count]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      leave();
      return;
    }
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      PageDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      PageUp: current - 1,
      Home: 1,
      End: count,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    go(target);
  };

  if (error) {
    return (
      <div className="err" style={{ marginBottom: 0 }}>
        {error}
      </div>
    );
  }

  const viewer = (
    <div
      ref={shell}
      tabIndex={0}
      role="region"
      aria-label={`Slides of ${title}`}
      onKeyDown={onKeyDown}
      style={{
        border: "1px solid var(--line)",
        borderRadius: expanded ? 0 : 8,
        overflow: "hidden",
        background: "var(--white)",
        outline: "none",
        display: "flex",
        flexDirection: "column",
        ...(expanded ? { position: "fixed", inset: 0, zIndex: 900 } : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--line)",
          background: "var(--white)",
        }}
      >
        <button type="button" className="btn" style={{ padding: "2px 10px" }} disabled={current <= 1} onClick={() => go(current - 1)} aria-label="Previous slide">
          ‹
        </button>
        <span className="num" style={{ fontSize: 13, minWidth: 110, textAlign: "center" }}>
          {count ? `Slide ${current} of ${count}` : "Loading slides…"}
        </span>
        <button type="button" className="btn" style={{ padding: "2px 10px" }} disabled={!count || current >= count} onClick={() => go(current + 1)} aria-label="Next slide">
          ›
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn"
          style={{ padding: "2px 10px", fontSize: 12 }}
          aria-pressed={expanded}
          onClick={() => (expanded ? leave() : enter())}
        >
          {expanded ? "Exit full screen" : "Full screen"}
        </button>
      </div>

      <div style={{ display: "flex", ...(expanded ? { flex: 1, minHeight: 0 } : { height: 520 }) }}>
        <div
          style={{
            width: 190,
            flexShrink: 0,
            overflowY: "auto",
            overflowX: "hidden",
            borderRight: "1px solid var(--line)",
            padding: "10px 8px 10px 4px",
            background: "var(--white)",
          }}
        >
          {doc &&
            Array.from({ length: count }, (_, index) => index + 1).map((page) => (
              <Thumbnail key={page} doc={doc} page={page} selected={page === current} onSelect={() => go(page)} />
            ))}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--mist)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          {doc ? <MainSlide doc={doc} page={current} /> : <span className="note">Loading slides…</span>}
        </div>
      </div>
    </div>
  );

  // Covering the window needs <body> as the parent: inside the review card, whose
  // entry animation leaves a transform, `position: fixed` covers only the card.
  return expanded ? createPortal(viewer, document.body) : viewer;
}

/** Draws one page into a canvas at the given CSS width, sharp on high-density screens. */
async function draw(
  doc: PDFDocumentProxy,
  page: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  previous: { task: RenderTask | null },
): Promise<void> {
  previous.task?.cancel();
  const pdfPage = await doc.getPage(page);
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = window.devicePixelRatio || 1;
  const viewport = pdfPage.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  const task = pdfPage.render({ canvas, viewport });
  previous.task = task;
  try {
    await task.promise;
  } catch {
    // Cancelled by a newer render of the same canvas — expected when paging quickly.
  }
}

function Thumbnail({
  doc,
  page,
  selected,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  page: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const render = useRef<{ task: RenderTask | null }>({ task: null });

  // Only draw thumbnails that have scrolled into view.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible && canvas.current) void draw(doc, page, canvas.current, 138, render.current);
  }, [visible, doc, page]);

  // Keep the chosen slide's thumbnail in sight as the reviewer pages through — by
  // scrolling the thumbnail column only. `scrollIntoView` would scroll the whole page
  // too, jumping the reviewer down to the viewer as the screen loads.
  useEffect(() => {
    const item = holder.current;
    const column = item?.parentElement;
    if (!selected || !item || !column) return;
    const top = item.offsetTop - column.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < column.scrollTop) column.scrollTop = top;
    else if (bottom > column.scrollTop + column.clientHeight) column.scrollTop = bottom - column.clientHeight;
  }, [selected]);

  return (
    <button
      ref={holder}
      type="button"
      onClick={onSelect}
      aria-label={`Slide ${page}`}
      aria-current={selected ? "true" : undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        width: "100%",
        border: "none",
        background: "none",
        padding: "4px 0",
        cursor: "pointer",
      }}
    >
      <span className="num" style={{ width: 18, textAlign: "right", fontSize: 12, color: "var(--slate)", paddingTop: 2 }}>
        {page}
      </span>
      <span
        style={{
          display: "block",
          borderRadius: 6,
          padding: 2,
          border: selected ? "2px solid var(--blueDark)" : "2px solid transparent",
          boxShadow: selected ? "none" : "0 0 0 1px var(--line)",
          background: "var(--white)",
          minHeight: 78,
          width: 142,
          boxSizing: "content-box",
        }}
      >
        <canvas ref={canvas} style={{ display: "block", borderRadius: 3 }} />
      </span>
    </button>
  );
}

function MainSlide({ doc, page }: { doc: PDFDocumentProxy; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const render = useRef<{ task: RenderTask | null }>({ task: null });
  const [width, setWidth] = useState(0);

  // Fit the slide to the space available, and redraw when that changes.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvas.current || width === 0) return;
    void (async () => {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      // Fit inside the box both ways, so a tall page never overflows.
      const height = (box.current?.clientHeight ?? 480) - 4;
      const fitted = Math.min(width, (height * base.width) / base.height);
      if (canvas.current) await draw(doc, page, canvas.current, fitted, render.current);
    })();
  }, [doc, page, width]);

  return (
    <div ref={box} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <canvas ref={canvas} style={{ display: "block", boxShadow: "0 2px 10px rgba(20, 24, 27, .18)", background: "white" }} />
    </div>
  );
}
