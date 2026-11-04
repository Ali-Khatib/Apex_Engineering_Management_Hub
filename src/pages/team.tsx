import React, { useState } from "react";
import { useStore, useToast } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, Avatar, Modal, Field, ConfirmButton, CopyText, Empty, cx } from "../ui";
import { personName, isDone, risk, fmtDate } from "../logic";
import type { Person, Role } from "../types";

export function Team() {
  const { state, me, isAdmin, updatePerson, removePerson } = useStore();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const list = state.people.filter(p => !q || (personName(p) + p.email + p.title + p.team).toLowerCase().includes(q.toLowerCase()));
  const admins = state.people.filter(p => p.role === "admin").length;
  return (
    <>
      <PageHeader title="Team & access" sub="Admins manage components, plans and approvals. Members work on components, comment and raise blockers."
        actions={isAdmin && <Button variant="primary" icon="plus" onClick={() => setAdd(true)}>Add person</Button>} />
      <div className="toolbar"><div className="input-ic grow"><Icon name="search" size={15} /><input type="search" placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" /></div></div>
      <section className="panel" style={{ overflow: "hidden" }}>
        {list.length === 0 ? <Empty icon="team" title="Nobody matches" /> :
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Person</th><th>Email</th><th>Role</th><th>Primary component</th><th className="num">Active</th><th className="num">Reviewing</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>{list.map(p => {
              const owned = state.components.filter(c => c.ownerId === p.id && !isDone(c)).sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.priority] - { critical: 0, high: 1, medium: 2, low: 3 }[b.priority]));
              const reviewing = state.components.filter(c => (c.reviewerId === p.id || c.qaId === p.id) && !isDone(c)).length;
              return (
                <tr key={p.id}>
                  <td><span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Avatar p={p} size={32} /><span><b style={{ fontWeight: 600, display: "block" }}>{personName(p)}{p.id === me?.id && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</b><small className="muted">{p.title} · {p.team}</small></span></span></td>
                  <td><CopyText text={p.email} /></td>
                  <td>{isAdmin && p.id !== me?.id ? (
                    <select value={p.role} onChange={e => { updatePerson(p.id, { role: e.target.value as Role }); toast(`${p.first} is now ${e.target.value === "admin" ? "an admin" : "a member"}`); }} style={{ width: 120, height: 32 }} aria-label={`Role for ${personName(p)}`}><option value="admin">Admin</option><option value="member">Member</option></select>
                  ) : <Pill tone={p.role === "admin" ? "brand" : "faint"}>{p.role === "admin" ? "Admin" : "Member"}</Pill>}</td>
                  <td>{owned[0] ? <a href={"#c-" + owned[0].id} className="comp-link"><code className="cid">{owned[0].id}</code><span>{owned[0].name}</span></a> : <span className="muted">—</span>}</td>
                  <td className="num">{owned.length}</td>
                  <td className="num">{reviewing}</td>
                  {isAdmin && <td style={{ textAlign: "right" }}>{p.id !== me?.id && <ConfirmButton label="Remove" confirmText="Remove" onConfirm={() => { removePerson(p.id); toast(`${p.first} removed. Their components are now unassigned.`); }} />}</td>}
                </tr>
              );
            })}</tbody>
          </table></div>}
      </section>
      <p className="muted" style={{ fontSize: 12 }}>Apex has not recorded a limit on how many components one person should own at a time, so no count here is marked high or low. Active counts what somebody owns and has not finished; Reviewing counts what is waiting on their review.</p>
      {add && <AddPerson onClose={() => setAdd(false)} />}
    </>
  );
}

function AddPerson({ onClose }: { onClose: () => void }) {
  const { state, addPerson } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState({ first: "", last: "", email: "", role: "member" as Role, title: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    const e: Record<string, string> = {};
    if (!f.first.trim()) e.first = "Required.";
    if (!f.last.trim()) e.last = "Required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = "Enter a valid email address.";
    else if (state.people.some(p => p.email === f.email.trim().toLowerCase())) e.email = "Someone with this email is already on the platform.";
    setErr(e); if (Object.keys(e).length) return;
    addPerson({ first: f.first.trim(), last: f.last.trim(), email: f.email.trim().toLowerCase(), role: f.role, title: f.title.trim() || "Engineer" });
    toast(`${f.first} added`); onClose();
  };
  return (
    <Modal title="Add person" sub="They can sign in straight away with this email." onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Add person</Button></>}>
      <div className="form-grid">
        <Field label="First name" error={err.first}><input type="text" value={f.first} onChange={e => setF({ ...f, first: e.target.value })} /></Field>
        <Field label="Last name" error={err.last}><input type="text" value={f.last} onChange={e => setF({ ...f, last: e.target.value })} /></Field>
        <Field label="Email" error={err.email} full><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="name@apexaiarabia.com" /></Field>
        <Field label="Role"><select value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}><option value="member">Member</option><option value="admin">Admin</option></select></Field>
        <Field label="Job title"><input type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Backend Engineer" /></Field>
      </div>
    </Modal>
  );
}
