import React, { useMemo, useState } from "react";
import { useStore, useNav, EMPTY_FILTER, CompFilter } from "../store";
import { Icon } from "../icons";
import { Button, StatusPill, OwnerState, Empty, cx } from "../ui";
import { personName, ownership, ownershipCounts, OWNERSHIP, OWNERSHIP_ORDER, type Ownership } from "../logic";
import { LAYERS, LAYER_ORDER, WAVES } from "../seed";
import { LayerTag, WaveTag, SOURCE_LABEL } from "./lib";
import { NewComponentModal } from "./componentForms";

export function applyFilter(state: ReturnType<typeof useStore>["state"], f: CompFilter) {
  const q = f.q.trim().toLowerCase();
  return state.components.filter(c => {
    // Ownership is a partition: every component is in exactly one of the four,
    // so these are matched against the derived state rather than re-tested here.
    if (OWNERSHIP_ORDER.includes(f.quick as Ownership) && ownership(c, state.me) !== f.quick) return false;
    if (f.quick === "at_risk") return false;
    if (f.project && c.projectId !== f.project) return false;
    if (f.category && c.category !== f.category) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.owner === "__none" ? !!c.ownerId : f.owner && c.ownerId !== f.owner) return false;
    if (f.sp && !c.lib?.sps.includes(f.sp)) return false;
    if (f.wave && c.lib?.wave !== f.wave) return false;
    if (q && ![c.id, c.name, c.summary, c.lib?.mapping, c.lib?.op].some(x => x && x.toLowerCase().includes(q))) return false;
    return true;
  });
}

export function Components() {
  const { state, isAdmin } = useStore();
  const { filter: f, setFilter } = useNav();
  const [newOpen, setNewOpen] = useState(false);
  const [more, setMore] = useState(false);
  const narrowed = [f.category, f.sp, f.wave, f.project, f.owner].filter(Boolean).length;
  const set = (p: Partial<CompFilter>) => setFilter({ ...f, ...p });
  const list = useMemo(() => applyFilter(state, f), [state, f]);
  const own = useMemo(() => ownershipCounts(state.components, state.me), [state.components, state.me]);
  const active = Object.entries(f).some(([k, v]) => k === "quick" ? v !== "all" : !!v);
  const order = (c: any) => WAVES.findIndex(w => w.id === c.lib?.wave);
  return (
    <>
      <header className="ph ph-row">
        <div><h1>Components</h1><p className="lede">All 127 components, grouped by platform layer. Start with who owns each one, because unassigned work is the only kind that cannot move. Then narrow by layer, module or roadmap stage.</p></div>
        {isAdmin && <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>Add a component</Button>}
      </header>

      {/* The same filter bar the Roadmap uses. Two list pages with two
          different filter grammars read as two products. */}
      <div className="fbar">
        <div className="fbar-att" role="group" aria-label="Who owns it">
          <button className={cx("fchip", f.quick === "all" && "on")} aria-pressed={f.quick === "all"} onClick={() => set({ quick: "all" })}>All<b>{state.components.length}</b></button>
          {OWNERSHIP_ORDER.map(o => (
            <button key={o} className={cx("fchip", "a-" + (o === "unassigned" ? "warn" : "neutral"), f.quick === o && "on")}
              aria-pressed={f.quick === o} onClick={() => set({ quick: f.quick === o ? "all" : o })} title={OWNERSHIP[o].help}>
              {OWNERSHIP[o].label}<b>{own[o]}</b>
            </button>
          ))}
        </div>

        {/* On a phone the layer chips and four selects ran to about 900px
            before the first component. They collapse behind one control there
            and stay open at every width that has room for them. */}
        {/* Search stays out of the fold. On a phone it is the control people
            reach for first, and burying it behind a toggle would be the
            opposite of adapting the layout. */}
        <div className="fbar-row fbar-find">
          <label className="fsearch">
            <Icon name="search" size={14} />
            <input type="search" placeholder="Search by name, ID or SP number" value={f.q} onChange={e => set({ q: e.target.value })} aria-label="Search the library" />
            {f.q && <button onClick={() => set({ q: "" })} aria-label="Clear search"><Icon name="x" size={12} /></button>}
          </label>
          <button className="fbar-more-btn" onClick={() => setMore(v => !v)} aria-expanded={more}>
            <Icon name="filter" size={13} />
            {more ? "Hide filters" : "More filters"}{narrowed > 0 && <b>{narrowed}</b>}
          </button>
        </div>

        <div className={cx("fbar-more", more && "open")}>
        <div className="fbar-att fbar-layers" role="group" aria-label="Platform layer">
          {LAYER_ORDER.map(k => {
            const n = state.components.filter(c => c.lib?.layer === k).length; if (!n) return null;
            const on = f.category === LAYERS[k].name;
            return <button key={k} className={cx("fchip", on && "on")} onClick={() => set({ category: on ? "" : LAYERS[k].name })} aria-pressed={on}>{LAYERS[k].name}<b>{n}</b></button>;
          })}
        </div>

        <div className="fbar-row">
          <label className="fsel"><span>Platform module</span>
            <select value={f.sp} onChange={e => set({ sp: e.target.value })}><option value="">Any module</option>{state.modules.map(m => <option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}</select>
          </label>
          <label className="fsel"><span>Planning wave</span>
            <select value={f.wave} onChange={e => set({ wave: e.target.value })}><option value="">Any wave</option>{WAVES.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
          </label>
          <label className="fsel"><span>Source list</span>
            <select value={f.project} onChange={e => set({ project: e.target.value })}><option value="">All source lists</option>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="fsel"><span>Owner</span>
            <select value={f.owner} onChange={e => set({ owner: e.target.value })}><option value="">Anyone</option><option value="__none">No owner yet</option>{state.people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}</select>
          </label>
          {active && <button className="fclear" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</button>}
        </div>
        </div>

        <p className="fbar-sum">
          <b>{list.length}</b> of {state.components.length} components
          {f.quick !== "all" && OWNERSHIP[f.quick as Ownership] && <> · {OWNERSHIP[f.quick as Ownership].help}</>}
        </p>
      </div>
      {list.length === 0 ? <Empty icon="filter" title="Nothing matches" action={<Button onClick={() => setFilter(EMPTY_FILTER)}>Show everything</Button>} /> : (
        <div className="table-card">
          {LAYER_ORDER.map(k => {
            const items = list.filter(c => c.lib?.layer === k || (!c.lib && c.category === LAYERS[k].name)).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
            if (!items.length) return null;
            return (
              <div key={k} className="lgroup">
                <div className="lgroup-head">{LAYERS[k].name}<span>{items.length}</span></div>
                {items.map(c => (
                  <a key={c.id} href={"#c-" + c.id} className="lrow">
                    <code className="cid">{c.id}</code>
                    <span className="lrow-main"><b>{c.name}</b><small>{c.summary}</small></span>
                    <span className="lrow-sp">{c.lib?.sps.slice(0, 3).map(s => <span key={s} className="sptag">{s}</span>)}{(c.lib?.sps.length || 0) > 3 && <span className="sptag">+{c.lib!.sps.length - 3}</span>}</span>
                    <WaveTag wave={c.lib?.wave} />
                    <span className="lrow-state"><OwnerState c={c} /></span>
                    <span className="lrow-owner"><StatusPill s={c.status} /></span>
                  </a>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {newOpen && <NewComponentModal onClose={() => setNewOpen(false)} />}
    </>
  );
}
