import React, { useState } from "react";
import { useStore, useToast } from "../store";
import { Icon } from "../icons";
import { Button, Section, Field, Avatar, Pill, cx } from "../ui";
import { useTheme, ThemeSwitch } from "../theme";
import { personName, fmtDate } from "../logic";
import { DEFAULT_NOTIFY, type NotifyPrefs } from "../types";

const NOTIFY_COPY: { key: keyof NotifyPrefs; label: string; detail: string }[] = [
  { key: "assignment", label: "Assignments", detail: "A component is assigned to you, or its owner changes." },
  { key: "review", label: "Reviews and QA", detail: "Work is submitted for your review, or a decision lands on your work." },
  { key: "blocker", label: "Blockers", detail: "A blocker is raised on your work, assigned to you, or escalated." },
  { key: "deadline", label: "Deadlines", detail: "A due date or ETA on your work changes." },
  { key: "handoff", label: "Handoffs", detail: "A component is handed to you, or your handoff is acknowledged." },
  { key: "comment", label: "Comments", detail: "Someone comments on your component or mentions you." },
];

/** What this role can actually do, read straight off the permission rules. */
const CAN: { label: string; admin: boolean; member: boolean }[] = [
  { label: "View every component, module and repository", admin: true, member: true },
  { label: "Edit components you own", admin: true, member: true },
  { label: "Raise blockers and submit evidence", admin: true, member: true },
  { label: "Assign and reassign owners", admin: true, member: false },
  { label: "Create and delete components", admin: true, member: false },
  { label: "Manage people and roles", admin: true, member: false },
];

export function Settings() {
  const { state, me, isAdmin, updatePerson, resetDemo, signOut } = useStore();
  const { toast } = useToast();
  const { theme } = useTheme();
  const [f, setF] = useState({ first: me?.first || "", last: me?.last || "", title: me?.title || "", team: me?.team || "" });
  const [err, setErr] = useState<Record<string, string>>({});
  if (!me) return null;

  const prefs: NotifyPrefs = { ...DEFAULT_NOTIFY, ...(me.prefs || {}) };
  const setPref = (k: keyof NotifyPrefs, v: boolean) => {
    updatePerson(me.id, { prefs: { ...me.prefs, [k]: v } });
    toast(v ? `${NOTIFY_COPY.find(n => n.key === k)!.label} turned on` : `${NOTIFY_COPY.find(n => n.key === k)!.label} turned off`);
  };

  const saveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!f.first.trim()) er.first = "Enter your first name.";
    if (!f.last.trim()) er.last = "Enter your last name.";
    if (!f.title.trim()) er.title = "Enter your job title.";
    setErr(er);
    if (Object.keys(er).length) return;
    updatePerson(me.id, { first: f.first.trim(), last: f.last.trim(), title: f.title.trim(), team: f.team.trim() || "—" });
    toast("Profile saved");
  };

  const replayIntro = () => {
    try { sessionStorage.removeItem("apex-intro-v2"); } catch { /* private mode */ }
    location.reload();
  };

  const owned = state.components.filter(c => c.ownerId === me.id).length;
  const reviewing = state.components.filter(c => c.reviewerId === me.id).length;

  return (
    <>
      <header className="ph">
        <h1>Settings</h1>
        <p className="lede">Your profile, how this workspace looks, and which notifications reach you. Changes apply straight away.</p>
      </header>

      <Section title="Profile" sub="How your name appears to everyone else on the platform">
        <div className="panel-body">
          <div className="set-id">
            <Avatar p={me} size={52} />
            <div>
              <b>{personName(me)}</b>
              <small>{me.email}</small>
              <small>Joined {fmtDate(me.joined)} · owns {owned} component{owned === 1 ? "" : "s"} · reviews {reviewing}</small>
            </div>
            <Pill tone={isAdmin ? "ok" : "neutral"}>{isAdmin ? "Admin" : "Member"}</Pill>
          </div>
          <form onSubmit={saveProfile} className="set-form" noValidate>
            <div className="form-grid">
              <Field label="First name" error={err.first}><input type="text" value={f.first} onChange={e => setF({ ...f, first: e.target.value })} /></Field>
              <Field label="Last name" error={err.last}><input type="text" value={f.last} onChange={e => setF({ ...f, last: e.target.value })} /></Field>
              <Field label="Job title" error={err.title}><input type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Team"><input type="text" value={f.team} onChange={e => setF({ ...f, team: e.target.value })} /></Field>
            </div>
            <p className="set-note">Your work email is how you sign in and cannot be changed here. An admin can change it under Team.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button variant="primary" type="submit">Save profile</Button>
            </div>
          </form>
        </div>
      </Section>

      <Section title="Appearance" sub="Remembered in this browser only, not shared with your team">
        <div className="panel-body">
          <div className="set-row">
            <div><b>Theme</b><small>Light is the default. Your choice is remembered and never follows your operating system, so the workspace will not change appearance on its own.</small></div>
            <div className="row" style={{ gap: 10 }}><ThemeSwitch /><span className="muted" style={{ fontSize: 13 }}>{theme === "dark" ? "Dark" : "Light"}</span></div>
          </div>
          <div className="set-row">
            <div><b>Opening sequence</b><small>The Apex title sequence plays once each time you open the platform in a new browser tab.</small></div>
            <Button icon="play" onClick={replayIntro}>Play it now</Button>
          </div>
        </div>
      </Section>

      <Section title="Notifications" sub="Which of these reach your notification bell">
        <div className="set-list">
          {NOTIFY_COPY.map(n => (
            <label key={n.key} className="set-check">
              <input type="checkbox" checked={prefs[n.key]} onChange={e => setPref(n.key, e.target.checked)} />
              <span><b>{n.label}</b><small>{n.detail}</small></span>
            </label>
          ))}
        </div>
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <p className="set-note">Turning one off stops it being created, so it will not appear later. Notifications about work you own are the ones most people keep on.</p>
        </div>
      </Section>

      <Section title="Your access" sub={isAdmin ? "What an admin account can do here" : "What a member account can do here"}>
        <ul className="set-can">
          {CAN.map(c => {
            const allowed = isAdmin ? c.admin : c.member;
            return (
              <li key={c.label} className={cx(!allowed && "no")}>
                <Icon name={allowed ? "check" : "x"} size={14} />
                <span>{c.label}</span>
                {!allowed && <em>Admins only</em>}
              </li>
            );
          })}
        </ul>
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <p className="set-note">Being an admin does not grant QA acceptance or deployment approval. Those belong to the named QA contact and the approver on each component.</p>
        </div>
      </Section>

      <Section title="This demo workspace" sub="The component library is real. The team and their work in flight are not.">
        <div className="panel-body">
          <div className="set-row">
            <div><b>Reset the data</b><small>Puts every component, blocker, handoff and notification back to its starting state. Anything you changed while looking around is discarded. You stay signed in.</small></div>
            <Button onClick={() => { resetDemo(); toast("Data reset to the starting state"); }}>Reset data</Button>
          </div>
          <div className="set-row">
            <div><b>Switch account</b><small>Sign out and pick a different person, to see the platform from their seat.</small></div>
            <Button onClick={signOut}>Switch account</Button>
          </div>
        </div>
      </Section>
    </>
  );
}
