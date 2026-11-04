import type { AppState, Component } from "./types";
import { isDone } from "./logic";

/** A set of components that each need one of the others, so none can be finished first. */
export type Loop = { ids: string[]; key: string };

export interface DepModel {
  deps: Map<string, string[]>;        // id → what it needs finished first
  neededBy: Map<string, string[]>;    // id → what is waiting on it
  loops: Loop[];
  loopEdges: Set<string>;             // "from>to" for every edge that closes a loop
  inLoop: Set<string>;
  noPrereq: Component[];
  /** Strongly connected components of more than one member, largest first. */
  sccs: string[][];
  sccOf: Map<string, number>;         // id → index into sccs
}

/**
 * Tarjan's strongly connected components, written iteratively so depth is never
 * a question. An SCC of more than one member is a tangle: every component in it
 * can reach every other, so none of them can be sequenced against the rest.
 *
 * This is a different count from `loops` below, and the two are often confused.
 * A tangle of 41 components contains many distinct minimal loops; the tangle is
 * the thing you reason about, each loop is a decision you can take.
 */
function tarjan(ids: string[], deps: Map<string, string[]>): string[][] {
  let n = 0;
  const index: Record<string, number> = {}, low: Record<string, number> = {}, on: Record<string, boolean> = {};
  const st: string[] = [], out: string[][] = [];
  for (const root of ids) {
    if (index[root] !== undefined) continue;
    const work: [string, number][] = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      if (frame[1] === 0) { index[v] = low[v] = n++; st.push(v); on[v] = true; }
      let descended = false;
      const adj = deps.get(v) || [];
      while (frame[1] < adj.length) {
        const w = adj[frame[1]++];
        if (index[w] === undefined) { work.push([w, 0]); descended = true; break; }
        if (on[w]) low[v] = Math.min(low[v], index[w]);
      }
      if (descended) continue;
      if (low[v] === index[v]) {
        const comp: string[] = []; let w: string;
        do { w = st.pop()!; on[w] = false; comp.push(w); } while (w !== v);
        if (comp.length > 1) out.push(comp.sort());
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1][0]; low[p] = Math.min(low[p], low[v]); }
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Reads the dependency records as a graph. Nothing is modified: a loop stays
 * exactly as the source sheet describes it, and this only reports what is
 * there.
 */
export function analyse(cs: Component[]): DepModel {
  const ids = new Set(cs.map(c => c.id));
  const deps = new Map(cs.map(c => [c.id, c.deps.filter(d => ids.has(d))]));

  const neededBy = new Map<string, string[]>();
  cs.forEach(c => deps.get(c.id)!.forEach(d => {
    const a = neededBy.get(d) || []; a.push(c.id); neededBy.set(d, a);
  }));

  // Shortest loop through each component, de-duplicated by its member set.
  const loops = new Map<string, Loop>();
  const colour = new Map<string, number>();
  const stack: string[] = [];
  const walk = (u: string) => {
    colour.set(u, 1); stack.push(u);
    for (const v of deps.get(u) || []) {
      if (!colour.has(v)) walk(v);
      else if (colour.get(v) === 1) {
        const ring = stack.slice(stack.indexOf(v));
        const key = [...ring].sort().join("|");
        const cur = loops.get(key);
        if (!cur || ring.length < cur.ids.length) loops.set(key, { ids: ring, key });
      }
    }
    colour.set(u, 2); stack.pop();
  };
  cs.forEach(c => { if (!colour.has(c.id)) walk(c.id); });

  const list = [...loops.values()].sort((a, b) => a.ids.length - b.ids.length || a.ids[0].localeCompare(b.ids[0]));
  const loopEdges = new Set<string>();
  for (const l of list) l.ids.forEach((id, i) => loopEdges.add(`${l.ids[(i + 1) % l.ids.length]}>${id}`));

  const sccs = tarjan(cs.map(c => c.id), deps);
  const sccOf = new Map<string, number>();
  sccs.forEach((s, i) => s.forEach(id => sccOf.set(id, i)));

  return {
    deps, neededBy, loops: list, loopEdges, sccs, sccOf,
    inLoop: new Set(list.flatMap(l => l.ids)),
    noPrereq: cs.filter(c => deps.get(c.id)!.length === 0),
  };
}

/** Is this prerequisite already finished? Used to say whether an edge is satisfied. */
export const edgeSatisfied = (s: AppState, depId: string) => {
  const d = s.components.find(x => x.id === depId);
  return !!d && isDone(d);
};
