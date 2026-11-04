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

  return {
    deps, neededBy, loops: list, loopEdges,
    inLoop: new Set(list.flatMap(l => l.ids)),
    noPrereq: cs.filter(c => deps.get(c.id)!.length === 0),
  };
}

/** Is this prerequisite already finished? Used to say whether an edge is satisfied. */
export const edgeSatisfied = (s: AppState, depId: string) => {
  const d = s.components.find(x => x.id === depId);
  return !!d && isDone(d);
};
