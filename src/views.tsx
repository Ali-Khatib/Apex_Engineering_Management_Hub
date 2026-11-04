import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

/**
 * One switcher, used by both the roadmap and the dependency pages, so the two
 * read as the same product. A view is a question, not a chart type, so each
 * one carries the sentence it answers and the switcher never shows two
 * visualisations at once.
 */
export interface ViewDef<T extends string> { id: T; label: string; icon: string; answers: string }

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const VIEW_MS = 280;

export function ViewSwitch<T extends string>({ views, value, onChange, label }: {
  views: ViewDef<T>[]; value: T; onChange: (v: T) => void; label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  // The thumb is measured rather than assumed, so labels of different widths
  // stay correct at every breakpoint and in every language.
  useLayoutEffect(() => {
    const place = () => {
      const el = wrap.current?.querySelector<HTMLElement>(`[data-v="${value}"]`);
      if (!el || !wrap.current) return;
      const a = el.getBoundingClientRect(), b = wrap.current.getBoundingClientRect();
      setThumb({ x: a.left - b.left, w: a.width });
    };
    place();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    if (ro && wrap.current) ro.observe(wrap.current);
    window.addEventListener("resize", place);
    return () => { ro?.disconnect(); window.removeEventListener("resize", place); };
  }, [value, views]);

  const key = (e: React.KeyboardEvent) => {
    const i = views.findIndex(v => v.id === value);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = (i + (e.key === "ArrowRight" ? 1 : views.length - 1)) % views.length;
      onChange(views[n].id);
      wrap.current?.querySelector<HTMLElement>(`[data-v="${views[n].id}"]`)?.focus();
    }
  };

  const active = views.find(v => v.id === value)!;

  return (
    <div className="vsw">
      <div className="vsw-track" ref={wrap} role="tablist" aria-label={label} onKeyDown={key}>
        {thumb && <span className="vsw-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} aria-hidden />}
        {views.map(v => (
          <button
            key={v.id} data-v={v.id} role="tab" type="button"
            aria-selected={v.id === value} tabIndex={v.id === value ? 0 : -1} aria-label={v.label}
            className={cx("vsw-tab", v.id === value && "on")}
            onClick={() => onChange(v.id)}>
            <Icon name={v.icon} size={14} />
            <span>{v.label}</span>
          </button>
        ))}
      </div>
      <p className="vsw-answers" aria-live="polite">{active.answers}</p>
    </div>
  );
}

/**
 * Crossfades between views, keeping both on screen for one transition so
 * nothing jumps: the outgoing copy is taken out of flow and the container's
 * height is animated from the old measurement to the new one. Without this the
 * page snaps by several hundred pixels whenever the view changes.
 *
 * `render` takes the view rather than children, because both the old and the
 * new view have to exist at the same time for a frame.
 */
export function ViewPane<T extends string>({ view, order, render }: {
  view: T; order: T[]; render: (v: T) => React.ReactNode;
}) {
  const [cur, setCur] = useState<T>(view);
  const [out, setOut] = useState<T | null>(null);
  const [dir, setDir] = useState(1);
  const [h, setH] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (view === cur) return;
    if (reduced()) { setCur(view); return; }
    setDir(order.indexOf(view) >= order.indexOf(cur) ? 1 : -1);
    setH(live.current?.offsetHeight ?? null);   // freeze the height we are leaving
    setOut(cur);
    setCur(view);
  }, [view]);               // eslint-disable-line react-hooks/exhaustive-deps

  // Once the new view has laid out, animate the container to its height.
  useLayoutEffect(() => {
    if (out === null) return;
    const to = live.current?.offsetHeight ?? null;
    const id = requestAnimationFrame(() => setH(to));
    const t = setTimeout(() => { setOut(null); setH(null); }, VIEW_MS);
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
  }, [out, cur]);

  return (
    <div className={cx("vpane", out !== null && "moving")} ref={box} style={h !== null ? { height: h } : undefined}>
      {out !== null && (
        <div className="vpane-layer out" style={{ ["--d" as any]: dir }} aria-hidden>{render(out)}</div>
      )}
      <div className={cx("vpane-layer", out !== null && "in")} style={{ ["--d" as any]: dir }} ref={live} key={cur}>
        {render(cur)}
      </div>
    </div>
  );
}

/** Remembers a view per page for the length of the session, so a round trip to a component keeps your place. */
export function useView<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { return (sessionStorage.getItem("apex-view-" + key) as T) || initial; } catch { return initial; }
  });
  useEffect(() => { try { sessionStorage.setItem("apex-view-" + key, v); } catch { /* private mode */ } }, [key, v]);
  return [v, setV];
}
