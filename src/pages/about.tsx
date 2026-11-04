import React, { useState } from "react";
import { useStore, useToast } from "../store";
import { Icon } from "../icons";
import { Button, Section, Markdown, MarkdownEditor, Modal, Field, PersonSelect, Avatar, CopyText, ConfirmButton, Pill } from "../ui";
import { personName, ago } from "../logic";
import { LOGO } from "../logo";
import type { Contact } from "../types";

const SYSTEMS = [
  { icon: "github", name: "GitHub", owns: "Source code, branches, pull requests, reviews, Actions results", here: "Linked per component; commits, PRs and checks shown read-only" },
  { icon: "erpnext", name: "ERPNext", owns: "Projects, tasks, employees, customers, timesheets", here: "Record references and links; no financial data copied" },
  { icon: "slack", name: "Slack", owns: "Conversations and decisions", here: "Links to channels and threads; notifications in v1.1" },
  { icon: "drive", name: "Google Drive", owns: "Specifications, presentations, reports", here: "Folder and document links per component" },
  { icon: "sheets", name: "Google Sheets", owns: "Existing trackers and allocation sheets", here: "Links; the sheet stays the source for its own data" },
  { icon: "overview", name: "This platform", owns: "Components, ownership, assignments, readiness gates, evidence, blockers, handoffs, best practices", here: "Source of truth" },
];

export function About() {
  const { state, isAdmin, person, saveAbout, deleteContact } = useStore();
  const { toast } = useToast();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(state.about.vision);
  const [o, setO] = useState(state.about.overview);
  const [ct, setCt] = useState<Contact | null | "new">(null);
  return (
    <>
      <section className="about-hero">
        <img src={LOGO} alt="" className="about-mark" />
        <div style={{ position: "relative" }}>
          <h1>About this platform</h1>
        </div>
        <div style={{ position: "relative" }}><Markdown src={state.about.vision} /></div>
      </section>

      {edit ? (
        <Section title="Edit vision & overview" actions={<><Button variant="ghost" onClick={() => setEdit(false)}>Cancel</Button><Button variant="primary" onClick={() => { saveAbout(v, o); setEdit(false); toast("Page updated"); }}>Save</Button></>}>
          <div className="panel-body" style={{ display: "grid", gap: 16 }}>
            <Field label="Vision"><textarea rows={5} value={v} onChange={e => setV(e.target.value)} /></Field>
            <div className="field"><label>The project & how we work</label><MarkdownEditor value={o} onChange={setO} rows={18} /></div>
          </div>
        </Section>
      ) : (
        <div className="split">
          <Section title="The project & how we work" sub={`Updated ${ago(state.about.updatedAt)} by ${personName(person(state.about.updatedBy))}`} actions={isAdmin && <Button size="sm" icon="edit" onClick={() => { setV(state.about.vision); setO(state.about.overview); setEdit(true); }}>Edit</Button>}>
            <div className="panel-body"><Markdown src={state.about.overview} /></div>
          </Section>
          <Section title="Projects">
            <div className="list-plain">{state.projects.map(p => (
              <div key={p.id} style={{ display: "grid", gap: 4 }}>
                <div className="row-between"><b>{p.name}</b><Pill tone="faint">{p.code}</Pill></div>
                <span className="muted" style={{ fontSize: 13 }}>{p.summary}</span>
                <span style={{ fontSize: 12.5 }} className="muted">{p.client} · lead {personName(person(p.leadId))} · {state.components.filter(c => c.projectId === p.id).length} components</span>
              </div>
            ))}</div>
          </Section>
        </div>
      )}

      <Section title="Who to contact" sub="The right person for each kind of question" actions={isAdmin && <Button size="sm" icon="plus" onClick={() => setCt("new")}>Add contact</Button>}>
        <div className="panel-body"><div className="contacts">
          {state.contacts.map(c => { const p = person(c.personId); return (
            <div key={c.id} className="contact">
              <div className="row-between" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}><div><h4>{c.topic}</h4><p>{c.description}</p></div>{isAdmin && <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${c.topic}`} onClick={() => setCt(c)} />}</div>
              <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Avatar p={p} size={34} /><div style={{ minWidth: 0 }}><b style={{ display: "block", fontWeight: 600 }}>{personName(p)}</b><small className="muted">{p?.title}</small></div></div>
              <div className="row" style={{ gap: 6 }}>{p && <CopyText text={p.email} />}<Pill tone="neutral"><Icon name="slack" size={12} />{c.channel}</Pill></div>
            </div>
          ); })}
        </div></div>
      </Section>

      <Section title="Which system owns what" sub="This platform connects existing tools; it doesn't replace them.">
        <div className="table-wrap"><table className="sor">
          <thead><tr><th>System</th><th>Owns</th><th>What you see here</th></tr></thead>
          <tbody>{SYSTEMS.map(s => <tr key={s.name}><td><span className="sys"><Icon name={s.icon} size={16} />{s.name}</span></td><td>{s.owns}</td><td className="muted">{s.here}</td></tr>)}</tbody>
        </table></div>
      </Section>
      {ct && <ContactModal c={ct === "new" ? null : ct} onClose={() => setCt(null)} onDelete={id => { deleteContact(id); toast("Contact removed"); }} />}
    </>
  );
}

function ContactModal({ c, onClose, onDelete }: { c: Contact | null; onClose: () => void; onDelete: (id: string) => void }) {
  const { saveContact } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState<Contact>(c || { id: "ct" + Date.now().toString(36), topic: "", description: "", personId: "ali", channel: "#" });
  const [err, setErr] = useState("");
  return (
    <Modal title={c ? "Edit contact" : "Add contact"} onClose={onClose} footer={<>
      {c && <span style={{ marginRight: "auto" }}><ConfirmButton label="Remove" confirmText="Remove" onConfirm={() => { onDelete(c.id); onClose(); }} /></span>}
      <Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { if (!f.topic.trim()) { setErr("Name the topic."); return; } saveContact(f); toast("Contact saved"); onClose(); }}>Save</Button></>}>
      <Field label="Topic" error={err}><input type="text" value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} placeholder="e.g. Security reviews" /></Field>
      <Field label="When to reach out"><input type="text" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Person"><PersonSelect value={f.personId} onChange={v => setF({ ...f, personId: v || f.personId })} allowEmpty={false} /></Field>
      <Field label="Slack channel"><input type="text" value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })} /></Field>
    </Modal>
  );
}
