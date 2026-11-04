import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { useStore, useNav, useToast } from "./store";
import { Avatar, Button, Field, Menu, MenuItem, cx, Modal, PersonSelect } from "./ui";
import { LOGO } from "./logo";
import { personName, ago, openBlockers, practiceStatus, risk, OPEN_BLOCKER } from "./logic";
import type { Notice } from "./types";
import { ThemeSwitch } from "./theme";
import { DEMO_ACCOUNTS } from "./demo";
import { NewComponentModal } from "./pages/componentForms";
import { BlockerModal } from "./pages/blockers";

// ───────────── Opening sequence ─────────────
// A pre-rendered film (4K on high-density screens, 1080p otherwise) with crisp HTML type on top.
// Falls back to a lightweight CSS reveal if the video can't play quickly. Never blocks the app.
export function Intro({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false);
  const [mode, setMode] = useState<"video" | "css">("video");
  const [playing, setPlaying] = useState(false);
  const done = useRef(false);
  const reduced = useMemo(() => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const src = useMemo(() => (Math.max(screen.width, screen.height) * (devicePixelRatio || 1) >= 3000 ? "intro-4k.mp4" : "intro-1080.mp4"), []);
  const finish = () => { if (done.current) return; done.current = true; setOut(true); setTimeout(onDone, 360); };
  useEffect(() => {
    if (reduced) { const t = setTimeout(finish, 900); return () => clearTimeout(t); }
    // Give the file a real chance to arrive. The old 1600ms race abandoned the
    // video on any cold CDN fetch, which is every first visit in production.
    // Once it is playing, no fallback timer runs at all.
    if (playing) { const cap = setTimeout(finish, 6000); return () => clearTimeout(cap); }
    const slow = setTimeout(() => setMode(m => (m === "video" ? "css" : m)), 5000);
    const cap = setTimeout(finish, 9000);
    return () => { clearTimeout(slow); clearTimeout(cap); };
  }, [playing, reduced]);
  useEffect(() => { if (mode === "css") { const t = setTimeout(finish, 2200); return () => clearTimeout(t); } }, [mode]);
  const particles = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const a = (-70 + i * 9) * Math.PI / 180, d = 40 + (i * 37) % 70;
    return { left: `${72 + (i * 7) % 18}%`, top: `${6 + (i * 11) % 22}%`, size: 3 + (i % 4) * 2, dx: `${Math.cos(a) * d}px`, dy: `${Math.sin(a) * d}px`, delay: `${0.7 + (i % 7) * 0.08}s` };
  }), []);
  return (
    <div className={cx("intro", out && "out", mode === "video" && "intro-film")} role="presentation" aria-hidden={out}>
      {mode === "video" && !reduced ? (
        <>
          <video className={cx("intro-video", playing && "on")} src={src} muted playsInline autoPlay preload="auto"
            onCanPlay={() => setPlaying(true)} onPlaying={() => setPlaying(true)} onEnded={finish} onError={() => setMode("css")} />
          <div className={cx("intro-title", playing && "go")}><strong>Apex AI Arabia</strong><span>Engineering Platform</span></div>
        </>
      ) : (
        <>
          <div className="intro-glow" />
          <div className="intro-stage">
            <div className="intro-mark">
              <img src={LOGO} alt="Apex AI Arabia" draggable={false} onError={finish} />
              <span className="intro-sheen" aria-hidden style={{ WebkitMaskImage: `url(${LOGO})`, maskImage: `url(${LOGO})` } as any} />
              {particles.map((p, i) => <span key={i} className="intro-particle" style={{ left: p.left, top: p.top, width: p.size, height: p.size, ["--dx" as any]: p.dx, ["--dy" as any]: p.dy, animationDelay: p.delay }} />)}
            </div>
            <div className="intro-word"><strong>Apex AI Arabia</strong><span>Engineering Platform</span></div>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────── Sign in ─────────────
export function SignIn() {
  const { state, signIn, register } = useStore();
  const [f, setF] = useState({ first: "", last: "", email: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [form, setForm] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!f.first.trim()) er.first = "Enter your first name.";
    if (!f.last.trim()) er.last = "Enter your last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) er.email = "Enter a valid work email, like name@apexaiarabia.com.";
    setErr(er);
    if (Object.keys(er).length) return;
    const existing = state.people.find(p => p.email === f.email.trim().toLowerCase());
    if (existing) signIn(existing.id); else register(f);
  };
  const demo = DEMO_ACCOUNTS.map(a => ({ ...a, p: state.people.find(x => x.id === a.id) })).filter(a => a.p);
  const others = state.people.filter(p => !DEMO_ACCOUNTS.some(a => a.id === p.id));
  return (
    <div className="signin">
      <div className="signin-brand">
        <div className="signin-logo"><img src={LOGO} alt="" /> Apex AI Arabia</div>
        <div>
          <h1>The engineering platform</h1>
          <p>Every component Apex is building, who owns it, what it is waiting on, and whether it has passed its checks, QA and deployment approvals.</p>
          <dl className="signin-defs">
            <div><dt>Component</dt><dd>One unit of engineering work, owned by one person. The thing this platform tracks.</dd></div>
            <div><dt>Platform module</dt><dd>Something already built and reusable. SP-01 to SP-20. Most components extend one instead of starting over.</dd></div>
            <div><dt>Round</dt><dd>The set of components selected to be built next. 26 of the 127 are in the current round.</dd></div>
          </dl>
        </div>
        <span className="signin-foot"><ThemeSwitch /> <span>Light or dark. Your choice is remembered.</span></span>
      </div>
      <div className="signin-form">
        <div className="signin-card">
          <h2>Sign in</h2>
          <p className="signin-lede">Pick an account to look around with. Each one shows the platform from a different seat, and nothing you do is permanent. <b>Reset data</b> in the account menu puts it all back.</p>
          <div className="who-list">
            {demo.map(a => (
              <button key={a.id} className="who" onClick={() => signIn(a.id)}>
                <Avatar p={a.p!} size={40} />
                <span className="grow"><b>{personName(a.p!)}<em>{a.p!.role === "admin" ? "Admin" : "Member"}</em></b><small>{a.p!.title}</small><i>{a.shows}</i></span>
                <Icon name="arrowRight" size={16} />
              </button>
            ))}
            {others.map(p => (
              <button key={p.id} className="who" onClick={() => signIn(p.id)}>
                <Avatar p={p} size={40} />
                <span className="grow"><b>{personName(p)}</b><small>{p.title} · {p.email}</small></span>
                <Icon name="arrowRight" size={16} />
              </button>
            ))}
          </div>
          {!form ? <button className="btn btn-ghost btn-md" onClick={() => setForm(true)}>Someone else? Create a profile</button> : (
            <form onSubmit={submit} noValidate style={{ display: "grid", gap: 14 }}>
              <div className="form-grid">
                <Field label="First name" error={err.first}><input type="text" autoComplete="given-name" value={f.first} onChange={e => setF({ ...f, first: e.target.value })} /></Field>
                <Field label="Last name" error={err.last}><input type="text" autoComplete="family-name" value={f.last} onChange={e => setF({ ...f, last: e.target.value })} /></Field>
                <Field label="Work email" error={err.email} full><input type="email" autoComplete="email" placeholder="name@apexaiarabia.com" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
              </div>
              <Button variant="primary" type="submit" iconRight="arrowRight">Create profile</Button>
              <p className="muted" style={{ fontSize: 12 }}>New profiles join as members with nothing assigned. Admins can change roles under Team.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────── Navigation ─────────────
export const NAV = [
  { group: "Workspace", items: [
    { id: "home", label: "Overview", sub: "What needs attention today", icon: "overview" },
    { id: "mywork", label: "My work", sub: "The components assigned to you", icon: "mywork" },
    { id: "library", label: "Components", sub: "All 127, grouped by platform layer", icon: "components" },
    { id: "blockers", label: "Blockers", sub: "Work that has stopped, and who can unstick it", icon: "blockers" },
    { id: "qa", label: "QA reviews", sub: "What is waiting on a QA decision", icon: "readiness" },
  ] },
  { group: "Planning", items: [
    { id: "roadmap", label: "Roadmap", sub: "What is selected for now, next and later", icon: "plan" },
    { id: "map", label: "Dependencies", sub: "Loops that need a decision before work can be sequenced", icon: "graph" },
  ] },
  { group: "Reference", items: [
    { id: "knowledge", label: "Engineering knowledge", sub: "How Apex builds, and where it is written down", icon: "about" },
    { id: "architecture", label: "Architecture & modules", sub: "SP-01 to SP-20 and how everything fits together", icon: "layers" },
    { id: "repos", label: "Repositories", sub: "Where each component's code lives", icon: "repo" },
    { id: "practices", label: "Best practices", sub: "How we agreed to build", icon: "practices" },
    { id: "team", label: "Team", sub: "People and what they own", icon: "team" },
    { id: "about", label: "About & contacts", sub: "What Apex does, and who to ask", icon: "about" },
  ] },
];
export const routeBase = (r: string) => r.startsWith("c-") ? "library" : r.startsWith("m-") ? "architecture" : r.startsWith("p-") ? "practices" : r === "" || r === "overview" ? "home" : r;

/** Pages reachable outside the sidebar, so the breadcrumb can still name them. */
export const OFF_NAV: Record<string, string> = { settings: "Settings" };

const NOTICE_ICON: Record<Notice["kind"], string> = { assignment: "mywork", review: "readiness", blocker: "blockers", deadline: "clock", handoff: "handoff", comment: "message" };

export function Rail({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { state, me } = useStore();
  const { route } = useNav();
  const base = routeBase(route);
  const openBl = state.blockers.filter(OPEN_BLOCKER).length;
  return (
    <nav className={cx("side", open && "open")} aria-label="Main">
      <a href="#home" className="side-brand" onClick={onNavigate}><img src={LOGO} alt="" /><b>Apex AI Arabia</b></a>
      <div className="side-scope">
        <Icon name="layers" size={15} />
        <span><b>Engineering platform</b><small>{state.components.length} components · {state.modules.length} modules</small></span>
      </div>
      <div className="side-scroll">
        {NAV.map(g => (
          <div className="side-group" key={g.group}>
            <span className="side-label">{g.group}</span>
            {g.items.map(it => (
              <a key={it.id} href={"#" + it.id} className={cx("side-item", base === it.id && "on")} onClick={onNavigate} aria-current={base === it.id ? "page" : undefined} title={it.sub}>
                <Icon name={it.icon} size={16} /><span className="side-text">{it.label}</span>
                {it.id === "blockers" && openBl > 0 && <i className="side-count hot">{openBl}</i>}
              </a>
            ))}
          </div>
        ))}
      </div>
      {me && <div className="side-user"><Avatar p={me} size={28} /><span className="side-text"><b>{personName(me)}</b><small>{me.title}</small></span></div>}
    </nav>
  );
}

export function Topbar({ onSearch, onMenu }: { onSearch: () => void; onMenu: () => void }) {
  const { state, me, isAdmin, signOut, resetDemo, markRead, markAllRead, component } = useStore();
  const { route, go } = useNav();
  const { toast } = useToast();
  const base = routeBase(route);
  const section = NAV.flatMap(g => g.items).find(i => i.id === base);
  const leaf = route.startsWith("c-") ? component(route.slice(2))?.id : route.startsWith("m-") ? route.slice(2) : route.startsWith("p-") ? state.practices.find(p => p.id === route.slice(2))?.title : null;
  const mine = state.notices.filter(n => n.to === me?.id);
  const unread = mine.filter(n => !n.read).length;
  return (
    <header className="bar">
      <button className="bar-icon bar-menu" onClick={onMenu} aria-label="Open menu"><Icon name="menu" size={18} /></button>
      <nav className="bar-crumb" aria-label="Breadcrumb">{leaf ? <><a href={"#" + base}>{section?.label}</a><Icon name="chevronRight" size={12} /><b>{leaf}</b></> : <b>{section?.label || OFF_NAV[base] || "Overview"}</b>}</nav>
      <button className="bar-search" onClick={onSearch}><Icon name="search" size={15} /><span>Search components, modules, people…</span><kbd>Ctrl K</kbd></button>
      <ThemeSwitch />
      <Menu trigger={(o, t) => <button className="bar-icon" onClick={t} aria-label={`Notifications, ${unread} unread`} aria-expanded={o}><Icon name="activity" size={18} />{unread > 0 && <span className="bar-dot" />}</button>}>
        {close => <div className="notif-pop">
          <div className="notif-head"><b>Notifications</b>{unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button>}</div>
          <div className="notif-list">
            {mine.length === 0 && <div className="empty"><strong>You're all caught up</strong></div>}
            {mine.slice(0, 8).map(n => (
              <button key={n.id} className="notif" onClick={() => { markRead(n.id); close(); if (n.componentId) go("c-" + n.componentId); }}>
                <span className={cx("notif-ic", "k-" + n.kind)}><Icon name={NOTICE_ICON[n.kind]} size={15} /></span>
                <span style={{ minWidth: 0 }}><b>{n.title}</b><small>{n.body}</small><time>{ago(n.at)}</time></span>
                {!n.read ? <i className="unread-dot" /> : <i />}
              </button>
            ))}
          </div>
        </div>}
      </Menu>
      <Menu trigger={(o, t) => <button className="bar-avatar" onClick={t} aria-label="Account" aria-expanded={o}><Avatar p={me} size={30} /></button>}>
        {close => <>
          <div style={{ padding: "8px 10px 10px", display: "flex", gap: 10, alignItems: "center" }}><Avatar p={me} size={34} /><div style={{ minWidth: 0 }}><b style={{ display: "block" }}>{personName(me)}</b><small className="muted">{me?.title} · {isAdmin ? "Admin" : "Member"}</small></div></div>
          <div className="menu-sep" />
          <MenuItem icon="settings" onClick={() => { close(); go("settings"); }}>Settings</MenuItem>
          <MenuItem icon="mywork" onClick={() => { close(); signOut(); }}>Switch account</MenuItem>
          <MenuItem icon="refresh" onClick={() => { close(); resetDemo(); toast("Data reset to the starting state"); }}>Reset data</MenuItem>
          <MenuItem icon="logout" onClick={() => { close(); signOut(); }}>Sign out</MenuItem>
        </>}
      </Menu>
    </header>
  );
}

// ───────────── Command palette ─────────────
export function Palette({ onClose }: { onClose: () => void }) {
  const { state, person } = useStore();
  const { go } = useNav();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const m = (...f: (string | undefined | null)[]) => !s || f.some(x => x && x.toLowerCase().includes(s));
    const out: { group: string; icon: string; title: string; sub: string; to: string }[] = [];
    NAV.flatMap(g => g.items).filter(it => m(it.label)).slice(0, s ? 4 : 6).forEach(it => out.push({ group: "Pages", icon: it.icon, title: it.label, sub: "Go to page", to: it.id }));
    state.modules.filter(x => m(x.id, x.name, x.description)).slice(0, s ? 6 : 0).forEach(x => out.push({ group: "Platform modules", icon: "layers", title: `${x.id} · ${x.name}`, sub: x.description, to: "m-" + x.id }));
    state.components.filter(c => m(c.id, c.name, c.summary, c.category, personName(person(c.ownerId)))).slice(0, 8).forEach(c => out.push({ group: "Components", icon: "components", title: `${c.id} · ${c.name}`, sub: c.summary, to: "c-" + c.id }));
    if (s) state.people.filter(p => m(personName(p), p.email, p.title)).slice(0, 5).forEach(p => out.push({ group: "People", icon: "mywork", title: personName(p), sub: `${p.title} · ${p.email}`, to: "team" }));
    if (s) state.repos.filter(r => m(r.name, r.description)).slice(0, 4).forEach(r => out.push({ group: "Repositories", icon: "repo", title: r.name, sub: r.description, to: "repos" }));
    if (s) state.practices.filter(p => m(p.title, p.category, p.summary)).slice(0, 4).forEach(p => out.push({ group: "Best practices", icon: "practices", title: p.title, sub: p.category, to: "p-" + p.id }));
    return out;
  }, [q, state]);
  useEffect(() => setI(0), [q]);
  const pick = (k: number) => { const r = results[k]; if (r) { go(r.to); onClose(); } };
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-in"><Icon name="search" size={18} />
          <input ref={input} type="text" placeholder="Search components, people, repositories, practices…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search"
            onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setI(x => Math.min(x + 1, results.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI(x => Math.max(x - 1, 0)); } if (e.key === "Enter") pick(i); if (e.key === "Escape") onClose(); }} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {results.length === 0 && <div className="empty"><strong>No matches for “{q}”</strong><p>Try a component ID like APX-101, a person's name, or a repository.</p></div>}
          {results.map((r, k) => (
            <React.Fragment key={k}>
              {(k === 0 || results[k - 1].group !== r.group) && <div className="palette-group">{r.group}</div>}
              <button className={cx("palette-item", k === i && "on")} onMouseEnter={() => setI(k)} onClick={() => pick(k)}>
                <span className="feed-ic"><Icon name={r.icon} size={14} /></span>
                <span style={{ minWidth: 0 }}><b>{r.title}</b><small>{r.sub}</small></span>
                {k === i && <Icon name="arrowRight" size={14} />}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div>
      </div>
    </div>
  );
}
