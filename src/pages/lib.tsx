import React from "react";
import { useStore } from "../store";
import { LAYERS, WAVES, layerOf } from "../seed";
import { cx } from "../ui";
import type { Component } from "../types";

/** The platform layer, as a word. Nine layers cannot be told apart by colour, so they are not. */
export function LayerTag({ code, short }: { code: string; short?: boolean }) {
  const L = LAYERS[code] || LAYERS.PL06;
  return <span className="ltag" title={L.name}>{short ? L.short : L.name}</span>;
}
export const LayerOfTag = ({ c, short }: { c: Component; short?: boolean }) => <LayerTag code={c.lib?.layer || layerOf(c)} short={short} />;

/** Rounds. Only the few that need a decision carry colour; "Now" is on 54 rows, so it stays quiet. */
const WAVE_TONE: Record<string, string> = {
  "Now": "now", "P0": "must", "Next": "next", "P1": "next",
  "Later": "later", "Gated": "hold", "Architecture decision": "decide", "Not selected": "out",
};
export function WaveTag({ wave }: { wave?: string }) {
  if (!wave) return null;
  const w = WAVES.find(x => x.id === wave);
  return <span className={cx("wtag", "w-" + (WAVE_TONE[wave] || "out"))} title={w?.hint}>{w?.label || wave}</span>;
}

export function SpChip({ id, link = true }: { id: string; link?: boolean }) {
  const { state } = useStore();
  const m = state.modules.find(x => x.id === id);
  const inner = <><b>{id}</b>{m && <span>{m.name}</span>}</>;
  return link ? <a href={"#m-" + id} className="spchip" title={m?.description}>{inner}</a> : <span className="spchip">{inner}</span>;
}
export const SOURCE_LABEL: Record<string, string> = { catalog: "Catalog", add: "Addition", pn: "Platform Next", app: "App generation" };

/**
 * A ranked bar list. One hue at most, on the leading row; the rest are grey, so the
 * ranking is seen rather than decoded. Counts are tabular and right-aligned.
 */
export function BarChart({ rows, onPick, unit }: { rows: { key: string; label: React.ReactNode; value: number; color?: string }[]; onPick?: (k: string) => void; unit?: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const top = max;
  return (
    <div className="hbars">
      {rows.map(r => (
        <button key={r.key} className="hbar" onClick={() => onPick?.(r.key)} disabled={!onPick}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><i className={cx(r.value === top && "lead")} style={{ width: `${Math.max(r.value / max * 100, r.value ? 2 : 0)}%` }} /></span>
          <span className="hbar-v num">{r.value}{unit && <small>{unit}</small>}</span>
        </button>
      ))}
    </div>
  );
}
