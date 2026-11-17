import React, { useEffect, useRef, useState } from "react";
import * as H from "../hr";
import { Button, Field } from "../ui";
import { Icon } from "../icons";
import { LOGO } from "../logo";

/**
 * The candidate's own page. It is public: no HQ account, no HQ token, no staff data.
 * The invitation token is read from the address once and then removed from it. The session
 * token lives in memory only, so a refresh asks for a new code on purpose.
 */
const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`; };
const stamp = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
type View = Awaited<ReturnType<typeof H.candMe>>;

export function CandidatePortal() {
  const [token] = useState(() => { const m = /candidate=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : ""; });
  const [title, setTitle] = useState(""); const [gate, setGate] = useState<"checking" | "code" | "invalid">("checking");
  const [session, setSession] = useState(""); const [view, setView] = useState<View | null>(null);
  const [code, setCode] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (location.hash.includes("candidate=")) { try { history.replaceState(null, "", location.pathname + location.search + "#candidate"); } catch { /* ignore */ } }
    if (!token) { setGate("invalid"); return; }
    H.candInvitation(token).then(r => { setTitle(r.assessment_title); setGate("code"); }).catch(() => setGate("invalid"));
  }, [token]);
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await H.candVerify(token, code.trim()); setSession(r.session); setView(await H.candMe(r.session)); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="cand">
      <header className="cand-bar"><img src={LOGO} alt="" /><b>Apex AI Arabia</b></header>
      <main className="cand-main" id="main">
        {gate === "checking" && <p role="status">Checking your link…</p>}
        {gate === "invalid" && <section className="panel cand-card"><h1>This link isn't valid</h1><p>It may have expired, been replaced by a newer one, or been closed. Ask the person who invited you for a new link and code.</p></section>}
        {gate === "code" && !view && <section className="panel cand-card">
          <h1>{title}</h1><p>Enter the one-time code you were given. It works once and expires after a short time.</p>
          <form onSubmit={verify} noValidate>
            <Field label="One-time code" error={err}><input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} maxLength={8} /></Field>
            <Button variant="primary" type="submit" disabled={busy || code.trim().length < 4}>{busy ? "Checking…" : "Continue"}</Button>
          </form>
          <p className="muted cand-small">Your deadline starts the first time you sign in, and is measured by our server clock.</p>
        </section>}
        {view && <Assessment session={session} view={view} setView={setView} />}
      </main>
    </div>
  );
}

function Assessment({ session, view, setView }: { session: string; view: View; setView: (v: View) => void }) {
  const [now, setNow] = useState(0); const offset = useRef(0);
  useEffect(() => { offset.current = new Date(view.server_time).getTime() - Date.now(); const t = setInterval(() => setNow(Date.now() + offset.current), 1000); setNow(Date.now() + offset.current); return () => clearInterval(t); }, [view.server_time]);
  const [f, setF] = useState({ notes: "", repository_url: "", linkedin_url: "" }); const [op] = useState(() => H.newRequestId());
  const [errs, setErrs] = useState<Record<string, string>>({}); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const left = view.deadline_at ? new Date(view.deadline_at).getTime() - now : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErrs({}); setMsg("");
    try { await H.candSubmit(session, { operation_id: op, ...f }); setView(await H.candMe(session)); }
    catch (x: any) { setErrs(x.fields || {}); setMsg(Object.keys(x.fields || {}).length ? "Please correct the highlighted fields." : x.message); try { setView(await H.candMe(session)); } catch { /* session may have ended */ } } finally { setBusy(false); }
  };
  if (view.receipt) return <section className="panel cand-card" role="status"><h1>Submission received</h1><p>Thank you, {view.name}. Keep this receipt.</p>
    <dl className="kv-list"><div className="kv"><dt>Receipt</dt><dd><code>{view.receipt.receipt_id}</code></dd></div><div className="kv"><dt>Received</dt><dd>{stamp(view.receipt.received_at)} (server time)</dd></div></dl>
    <p className="muted cand-small">A submission can't be changed. The team will be in touch.</p></section>;
  return <>
    <section className="panel cand-card"><h1>{view.assessment_title}</h1>
      {view.state === "expired" ? <div className="hq-note hq-note-crit" role="alert"><Icon name="alert" size={15} /><span>Your assessment window has ended. Contact the person who invited you.</span></div>
        : view.state === "assessment_open" && left !== null ? <div className={left < 3600_000 ? "hq-note hq-note-warn" : "hq-note"} role="timer" aria-live="off"><Icon name="info" size={15} /><span><b>{fmt(left)}</b> left. Deadline {stamp(view.deadline_at!)}. {view.note}</span></div> : null}
      <h2 className="cand-h2">Brief</h2><p className="cand-pre">{view.brief}</p>
      {view.instructions && <><h2 className="cand-h2">Instructions</h2><p className="cand-pre">{view.instructions}</p></>}
    </section>
    {view.can_submit && <section className="panel cand-card"><h2 className="cand-h2">Your submission</h2>
      {msg && <div className="hq-note hq-note-crit" role="alert"><Icon name="alert" size={15} /><span>{msg}</span></div>}
      <form onSubmit={submit} noValidate>
        <Field label="Implementation notes" error={errs.notes} hint="Up to 10,000 characters. Add notes, a repository link, or both."><textarea rows={8} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label="GitHub repository" error={errs.repository_url} hint="https://github.com/owner/repository"><input type="url" value={f.repository_url} onChange={e => setF({ ...f, repository_url: e.target.value })} /></Field>
        <Field label="LinkedIn (optional)" error={errs.linkedin_url}><input type="url" value={f.linkedin_url} onChange={e => setF({ ...f, linkedin_url: e.target.value })} /></Field>
        <p className="muted cand-small">Files can't be uploaded here. Submit text and a repository link. You can submit once.</p>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit"}</Button>
      </form></section>}
  </>;
}
