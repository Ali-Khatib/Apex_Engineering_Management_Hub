import React, { useEffect, useRef, useState, useMemo, useId } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Icon } from "./icons";
import { useStore, useNav, useToast } from "./store";
import type { Person, Status, Priority, ChecksState, QAState, DeployState, Component } from "./types";
import { initials, personName, STATUS_LABEL, risk, stage, STAGE_LABEL, fmtDate, daysUntil, relDays, ownership, OWNERSHIP, lifecycle, LIFECYCLE_LABEL, LIFECYCLE_TONE, LIFECYCLE } from "./logic";

export const cx = (...a: any[]) => a.filter(Boolean).join(" ");

// ───────────── Buttons ─────────────
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "dark"; size?: "sm" | "md"; icon?: string; iconRight?: string; };
export function Button({ variant = "secondary", size = "md", icon, iconRight, className, children, ...rest }: BtnProps) {
  return (
    <button type="button" className={cx("btn", `btn-${variant}`, `btn-${size}`, !children && "btn-icon", className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

// ───────────── Pills ─────────────
export function Pill({ tone = "neutral", children, dot, title, className }: { tone?: string; children: React.ReactNode; dot?: boolean; title?: string; className?: string }) {
  return <span className={cx("pill", `t-${tone}`, className)} title={title}>{dot && <i className="pill-dot" />}{children}</span>;
}
const STATUS_TONE: Record<Status, string> = { not_started: "neutral", in_progress: "info", blocked: "crit", under_review: "review", completed: "ok" };
export const StatusPill = ({ s }: { s: Status }) => <Pill tone={STATUS_TONE[s]} dot>{STATUS_LABEL[s]}</Pill>;
/**
 * Ownership, shown as its own thing alongside status — never instead of it.
 * Each of the four reads differently at a glance without relying on colour:
 * unassigned is an open dashed outline, mine is filled and brand-coloured,
 * someone else's carries their face, completed is a closed check.
 */
export function OwnerState({ c, size = 20 }: { c: Component; size?: number }) {
  const { state, person } = useStore();
  const o = ownership(c, state.me);
  const meta = OWNERSHIP[o];
  if (o === "unassigned") return <span className="ost ost-unassigned" title={meta.help}><i className="ost-ring" aria-hidden />Unassigned</span>;
  const p = person(c.ownerId);
  // Completed still names who built it — the status pill already says "Done",
  // so this column earns its place by carrying the person, not repeating it.
  if (o === "completed") return <span className="ost ost-completed" title={p ? `Completed by ${personName(p)}` : meta.help}>{p ? <Avatar p={p} size={size} /> : <Icon name="check" size={12} />}Completed</span>;
  if (o === "mine") return <span className="ost ost-mine" title={meta.help}><Avatar p={p} size={size} />You</span>;
  return <span className="ost ost-theirs" title={meta.help}><Avatar p={p} size={size} /><span className="ost-name">{personName(p)}</span></span>;
}

/**
 * Lifecycle: how far the work has actually got. Shown wherever a component
 * appears on its own. It is a different question from the wave, which is the
 * source sheet's planning classification, so the two never replace each other.
 */
export function LifecyclePill({ c, help }: { c: Component; help?: boolean }) {
  const { state } = useStore();
  const l = lifecycle(state, c);
  const meta = LIFECYCLE.find(x => x.id === l)!;
  return <Pill tone={LIFECYCLE_TONE[l]} dot title={help ? meta.help : undefined}>{LIFECYCLE_LABEL[l]}</Pill>;
}

const PRI_TONE: Record<Priority, string> = { critical: "crit-solid", high: "warn", medium: "neutral", low: "faint" };
export const PriorityPill = ({ p }: { p: Priority }) => <Pill tone={PRI_TONE[p]}><PriorityGlyph p={p} />{p[0].toUpperCase() + p.slice(1)}</Pill>;
export function PriorityGlyph({ p }: { p: Priority }) {
  const n = { critical: 4, high: 3, medium: 2, low: 1 }[p];
  return <svg width="10" height="10" viewBox="0 0 10 10" className="pri-glyph" aria-hidden>{[0, 1, 2, 3].map(i => <rect key={i} x={i * 2.6} y={8 - i * 2.3} width="1.8" height={2 + i * 2.3} rx=".5" fill="currentColor" opacity={i < n ? 1 : 0.22} />)}</svg>;
}
export function RiskPill({ c }: { c: Component }) {
  const { state } = useStore();
  const r = risk(state, c);
  if (r.level === "done") return <Pill tone="ok">Done</Pill>;
  if (r.level === "on_track") return <Pill tone="faint">On track</Pill>;
  return <Pill tone={r.level === "blocked" ? "crit" : "warn"} title={r.reasons.join("\n")} dot>{r.level === "blocked" ? "Blocked" : "At risk"}</Pill>;
}

export const CHECK_TONE: Record<ChecksState, string> = { passed: "ok", failed: "crit", running: "info", pending: "neutral", skipped: "faint", unknown: "faint" };
export const QA_TONE: Record<QAState, string> = { accepted: "ok", rejected: "crit", changes_requested: "warn", in_progress: "info", awaiting: "review", not_submitted: "faint" };
export const DEPLOY_TONE: Record<DeployState, string> = { deployed: "ok", ready: "ok", scheduled: "info", pending_review: "review", not_ready: "faint", failed: "crit", rolled_back: "warn" };
export const label = (s: string) => s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

/** Three independent gate dots: checks · QA · deploy */
export function GateDots({ c, showLabel }: { c: Component; showLabel?: boolean }) {
  const g = c.gates;
  const items: [string, string, string][] = [
    ["Checks", CHECK_TONE[g.checks.state], label(g.checks.state)],
    ["QA", QA_TONE[g.qa.state], label(g.qa.state)],
    ["Deploy", DEPLOY_TONE[g.deploy.state], label(g.deploy.state)],
  ];
  return (
    <span className="gates" title={items.map(i => `${i[0]}: ${i[2]}`).join("\n")} aria-label={items.map(i => `${i[0]}: ${i[2]}`).join(", ")}>
      {items.map(([k, tone]) => <span key={k} className={cx("gate", `g-${tone}`)}><i />{showLabel ? k : k[0]}</span>)}
    </span>
  );
}
export function StagePill({ c }: { c: Component }) {
  const s = stage(c);
  const tone = { no_checks: "faint", checks_pending: "neutral", checks_failed: "crit", awaiting_qa: "review", qa_changes: "warn", awaiting_deploy: "info", ready: "ok", deployed: "ok-solid" }[s];
  return <Pill tone={tone}>{STAGE_LABEL[s]}</Pill>;
}

// ───────────── People ─────────────
export function Avatar({ p, size = 24 }: { p?: Person | null; size?: number }) {
  if (!p) return <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned"><Icon name="plus" size={size * 0.5} /></span>;
  return <span className="avatar" title={personName(p)} style={{ width: size, height: size, fontSize: size * 0.4, ["--h" as any]: p.hue }}>{initials(p)}</span>;
}
export function PersonChip({ id, sub, size = 22, empty = "Unassigned" }: { id?: string | null; sub?: string; size?: number; empty?: string }) {
  const { person } = useStore();
  const p = person(id);
  return (
    <span className={cx("pchip", !p && "pchip-empty")}>
      <Avatar p={p} size={size} />
      <span className="pchip-text"><span className="pchip-name">{p ? personName(p) : empty}</span>{sub && <span className="pchip-sub">{sub}</span>}</span>
    </span>
  );
}

export function DueText({ c }: { c: Component }) {
  if (!c.due) return <span className="due muted">No date yet</span>;
  const d = daysUntil(c.due);
  const done = c.status === "completed";
  return <span className={cx("due", !done && d < 0 && "due-over", !done && d >= 0 && d <= 7 && "due-soon")} title={fmtDate(c.due)}>{fmtDate(c.due)}{!done && <small>{relDays(c.due)}</small>}</span>;
}

export function CompLink({ id, showId = true, className }: { id: string; showId?: boolean; className?: string }) {
  const { component } = useStore();
  const c = component(id);
  if (!c) return <span className="muted">{id} (deleted)</span>;
  return <a href={"#c-" + c.id} className={cx("comp-link", className)}>{showId && <code className="cid">{c.id}</code>}<span>{c.name}</span></a>;
}

// ───────────── Layout helpers ─────────────
export function PageHeader({ eyebrow, title, sub, actions, children }: { eyebrow?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
export function Section({ title, sub, actions, children, className, id }: { title?: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section className={cx("panel", className)} id={id}>
      {(title || actions) && <div className="panel-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{actions && <div className="panel-actions">{actions}</div>}</div>}
      {children}
    </section>
  );
}
export function Empty({ icon = "layers", title, children, action }: { icon?: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><span className="empty-ic"><Icon name={icon} size={20} /></span><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>;
}
export function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="kv"><dt>{k}</dt><dd>{children}</dd></div>;
}

// ───────────── Tabs ─────────────
export function Tabs({ tabs, value, onChange, size }: { tabs: { id: string; label: string; count?: number; icon?: string }[]; value: string; onChange: (id: string) => void; size?: "sm" }) {
  return (
    <div className={cx("tabs", size === "sm" && "tabs-sm")} role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={cx("tab", value === t.id && "on")} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={14} />}{t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string; icon?: string }[]; value: T; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(o => <button key={o.id} type="button" className={cx(value === o.id && "on")} onClick={() => onChange(o.id)} aria-pressed={value === o.id}>{o.icon && <Icon name={o.icon} size={14} />}{o.label}</button>)}</div>;
}

// ───────────── Modal & drawer ─────────────
export function Modal({ title, sub, onClose, children, footer, wide }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not(.modal-x)");
    first?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    document.body.classList.add("no-scroll");
    return () => { window.removeEventListener("keydown", k); document.body.classList.remove("no-scroll"); prev?.focus?.(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx("modal", wide && "modal-wide")} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div><button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function Drawer({ title, sub, onClose, children, footer }: { title: React.ReactNode; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="overlay overlay-drawer" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head"><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div><button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </aside>
    </div>
  );
}

/** Inline two-step confirmation (the viewer cannot show confirm() dialogs). */
export function ConfirmButton({ label: text, confirmText = "Delete", onConfirm, icon = "trash", size = "sm", variant = "ghost" }: { label: string; confirmText?: string; onConfirm: () => void; icon?: string; size?: "sm" | "md"; variant?: BtnProps["variant"] }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  if (!armed) return <Button size={size} variant={variant} icon={icon} onClick={() => setArmed(true)}>{text}</Button>;
  return <span className="confirm"><span>Sure?</span><Button size="sm" variant="danger" onClick={() => { setArmed(false); onConfirm(); }}>{confirmText}</Button><Button size="sm" variant="ghost" onClick={() => setArmed(false)}>Cancel</Button></span>;
}

// ───────────── Menu ─────────────
export function Menu({ trigger, children, align = "right" }: { trigger: (open: boolean, toggle: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); window.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [open]);
  return <div className="menu-wrap" ref={ref}>{trigger(open, () => setOpen(o => !o))}{open && <div className={cx("menu", `menu-${align}`)} role="menu">{children(() => setOpen(false))}</div>}</div>;
}
export const MenuItem = ({ icon, children, onClick, danger, disabled, hint }: { icon?: string; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }) =>
  <button type="button" role="menuitem" className={cx("menu-item", danger && "danger")} onClick={onClick} disabled={disabled} title={hint}>{icon && <Icon name={icon} size={15} />}<span>{children}</span></button>;

// ───────────── Form fields ─────────────
export function Field({ label: l, hint, error, children, full }: { label: string; hint?: string; error?: string; children: React.ReactElement; full?: boolean }) {
  const id = useId();
  return (
    <div className={cx("field", full && "field-full", error && "has-err")}>
      <label htmlFor={id}>{l}</label>
      {React.cloneElement(children, { id, "aria-invalid": !!error || undefined })}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
export function PersonSelect({ value, onChange, allowEmpty = true, emptyLabel = "Unassigned", id, filter }: { value: string | null; onChange: (v: string | null) => void; allowEmpty?: boolean; emptyLabel?: string; id?: string; filter?: (p: Person) => boolean }) {
  const { state } = useStore();
  return (
    <select id={id} value={value || ""} onChange={e => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {state.people.filter(filter || (() => true)).map(p => <option key={p.id} value={p.id}>{personName(p)} · {p.title}</option>)}
    </select>
  );
}

// ───────────── Markdown ─────────────
// Both are real module imports. They used to be read off `window`, which only
// worked in the old CDN build; under Vite the globals were never set, so every
// markdown block on the site silently fell back to escaped plain text.
function basicSanitize(html: string) {
  const t = document.createElement("template"); t.innerHTML = html;
  t.content.querySelectorAll("script,style,iframe,object,embed,form").forEach(n => n.remove());
  t.content.querySelectorAll("*").forEach(el => [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) el.removeAttribute(a.name); }));
  return t.innerHTML;
}
export function renderMd(src: string) {
  let html: string;
  try { html = marked.parse(src || "", { gfm: true, breaks: false, async: false }) as string; }
  catch { html = "<p>Could not render this content.</p>"; }
  try { html = DOMPurify.sanitize(html); } catch { html = basicSanitize(html); }
  return html.replace(/<a href="http/g, '<a target="_blank" rel="noopener" href="http').replace(/<table>/g, '<div class="md-table"><table>').replace(/<\/table>/g, "</table></div>");
}
export function Markdown({ src, className }: { src: string; className?: string }) {
  const html = useMemo(() => renderMd(src), [src]);
  return <div className={cx("md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
export function MarkdownEditor({ value, onChange, rows = 14, id }: { value: string; onChange: (v: string) => void; rows?: number; id?: string }) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const ta = useRef<HTMLTextAreaElement>(null);
  const wrap = (a: string, b = a) => {
    const el = ta.current; if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const next = value.slice(0, s) + a + value.slice(s, e) + b + value.slice(e);
    onChange(next); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + a.length, e + a.length); });
  };
  return (
    <div className="mde">
      <div className="mde-bar">
        <Segmented options={[{ id: "write", label: "Write" }, { id: "preview", label: "Preview" }]} value={mode} onChange={setMode} />
        {mode === "write" && <div className="mde-tools">
          <button type="button" onClick={() => wrap("**")} title="Bold"><b>B</b></button>
          <button type="button" onClick={() => wrap("_")} title="Italic"><i>I</i></button>
          <button type="button" onClick={() => wrap("`")} title="Inline code"><code>{"<>"}</code></button>
          <button type="button" onClick={() => wrap("\n## ", "")} title="Heading">H</button>
          <button type="button" onClick={() => wrap("\n- ", "")} title="List">•</button>
          <button type="button" onClick={() => wrap("\n| Column | Column |\n|---|---|\n| ", " |  |\n")} title="Table">▦</button>
        </div>}
        <span className="mde-hint">Markdown supported</span>
      </div>
      {mode === "write"
        ? <textarea id={id} ref={ta} value={value} onChange={e => onChange(e.target.value)} rows={rows} className="mono-area" spellCheck />
        : <div className="mde-preview"><Markdown src={value || "_Nothing to preview yet._"} /></div>}
    </div>
  );
}

// ───────────── Toasts ─────────────
export function Toasts() {
  const { toasts, dismiss } = useToast();
  return <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={cx("toast", `toast-${t.tone}`)}><Icon name={t.tone === "ok" ? "check" : t.tone === "crit" ? "alert" : "issue"} size={16} /><span>{t.text}</span><button onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="x" size={14} /></button></div>)}</div>;
}

// ───────────── Copy ─────────────
export function CopyText({ text, children }: { text: string; children?: React.ReactNode }) {
  const { toast } = useToast();
  const ref = useRef<HTMLElement>(null);
  return (
    <span className="copy">
      <code ref={ref as any}>{children || text}</code>
      <button type="button" aria-label="Copy" title="Copy" onClick={() => {
        navigator.clipboard?.writeText(text).then(() => toast("Copied")).catch(() => {
          const r = document.createRange(); if (ref.current) { r.selectNodeContents(ref.current); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); } toast("Selected — press Ctrl+C to copy", "info");
        });
      }}><Icon name="copy" size={13} /></button>
    </span>
  );
}

/** Admin-only wrapper that explains why a control is unavailable rather than hiding it silently. */
export function useCan() {
  const { me, isAdmin, component } = useStore();
  return {
    admin: isAdmin,
    editComponent: isAdmin,
    ownerOrAdmin: (c: Component) => isAdmin || c.ownerId === me?.id,
    reviewOrAdmin: (c: Component) => isAdmin || c.reviewerId === me?.id || c.qaId === me?.id,
    qaOrAdmin: (c: Component) => isAdmin || c.qaId === me?.id,
    /**
     * Granting QA acceptance belongs to the named QA contact, not to anyone
     * holding admin. An admin can manage assignments and still not be able to
     * sign off quality on a component they do not QA.
     */
    qaDecide: (c: Component) => !!me && c.qaId === me.id,
    /** Deployment approval is its own authority, held by admins. */
    deployApprove: () => isAdmin,
  };
}

export function useOutsideNav() { return useNav(); }
