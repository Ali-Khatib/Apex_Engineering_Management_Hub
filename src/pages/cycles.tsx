import React, { useState } from "react";
import { useStore, useToast } from "../store";
import { Icon } from "../icons";
import { Button, PersonSelect, Pill, Modal, Field, cx } from "../ui";
import { personName, fmtDateTime } from "../logic";
import type { CycleResolution, CycleStatus } from "../types";

/**
 * A dependency loop is an engineering decision, not a graph defect. This
 * records who has to decide, what they chose and why. It never edits the
 * dependency records: the loop stays exactly as the source sheet describes it
 * until somebody changes the component itself.
 */
const RESOLUTIONS: { id: CycleResolution; label: string; what: string; cost: string }[] = [
  { id: "drop_dependency", label: "Drop a dependency", what: "One of the two does not really need the other. Remove that edge on the component.", cost: "Cheapest, if the dependency was speculative. Wrong call means a rewrite later." },
  { id: "split_component", label: "Split a component", what: "Separate the part that is needed early from the part that needs the other one.", cost: "Two smaller components to own, plan and accept. Usually the honest fix." },
  { id: "introduce_interface", label: "Introduce an interface", what: "Both build against an agreed contract instead of against each other.", cost: "Someone has to own and version the contract before either can start." },
  { id: "shared_prerequisite", label: "Build a shared prerequisite", what: "Extract what both need into a third component and build that first.", cost: "Adds a component to the round and delays both." },
  { id: "resequence", label: "Change the sequence", what: "Build one with a temporary stub, then come back and complete the link.", cost: "Known rework. Only sensible when the stub is genuinely small." },
];

const STATUS_TONE: Record<CycleStatus, string> = { undecided: "warn", under_review: "info", decided: "ok", deferred: "neutral" };
const STATUS_LABEL: Record<CycleStatus, string> = { undecided: "No decision yet", under_review: "Under review", decided: "Decided", deferred: "Deferred" };

export function CycleCard({ loop }: { loop: { ids: string[]; key: string } }) {
  const { state, component, person, isAdmin, setCycleDecision } = useStore();
  const { toast } = useToast();
  const [openEdit, setOpenEdit] = useState(false);
  const [expand, setExpand] = useState(false);

  const d = state.cycleDecisions?.[loop.key];
  const status: CycleStatus = d?.status || "undecided";
  const names = loop.ids.map(id => component(id)?.name || id);
  const label = names.join(loop.ids.length === 2 ? " and " : " → ");
  const chain = [...loop.ids, loop.ids[0]];

  // Why it matters, from the records themselves.
  const members = loop.ids.map(id => component(id)).filter(Boolean) as NonNullable<ReturnType<typeof component>>[];
  const ownerless = members.filter(c => !c.ownerId).length;
  const inRound = members.filter(c => c.lib?.wave === "Now" || c.lib?.wave === "P0").length;

  return (
    <div className={cx("cyc", "st-" + status)}>
      <button className="cyc-head" onClick={() => setExpand(v => !v)} aria-expanded={expand}>
        <Icon name="chevronRight" size={13} />
        <b>{label}</b>
        <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
      </button>

      <div className="cyc-chain">
        {chain.map((id, i) => (
          <React.Fragment key={id + i}>
            <a href={"#c-" + id} className="cyc-node">{id}</a>
            {i < chain.length - 1 && <Icon name="arrowRight" size={11} />}
          </React.Fragment>
        ))}
        <span className="cyc-chain-note">{loop.ids.length === 2 ? "each needs the other" : `a ring of ${loop.ids.length}`}</span>
      </div>

      {expand && (
        <div className="cyc-body">
          <div className="cyc-why">
            <h5>Why it matters</h5>
            <p>
              Neither end can be finished first, so this loop has no valid build order on its own.
              {inRound > 0 && (inRound === members.length
                ? ` ${members.length === 2 ? "Both" : `All ${members.length}`} are selected for the current round.`
                : ` ${inRound} of the ${members.length} ${inRound === 1 ? "is" : "are"} selected for the current round.`)}
              {ownerless > 0 && ` ${ownerless} ${ownerless === 1 ? "has" : "have"} no owner, so nobody is currently positioned to resolve it.`}
            </p>
          </div>

          <div className="cyc-why">
            <h5>Ways out</h5>
            <ul className="cyc-opts">
              {RESOLUTIONS.map(r => (
                <li key={r.id} className={cx(d?.resolution === r.id && "chosen")}>
                  <b>{r.label}{d?.resolution === r.id && <em>chosen</em>}</b>
                  <span>{r.what}</span>
                  <small>{r.cost}</small>
                </li>
              ))}
            </ul>
            <p className="cyc-warn"><Icon name="alert" size={13} />These are options for a person to weigh. Recording one here does not change any dependency: the loop stays in the data until someone edits the component.</p>
          </div>

          <dl className="cyc-dl">
            <div><dt>Decision owner</dt><dd>{d?.ownerId ? personName(person(d.ownerId)) : <em>Nobody assigned</em>}</dd></div>
            <div><dt>Status</dt><dd>{STATUS_LABEL[status]}</dd></div>
            {d?.at && <div><dt>Last updated</dt><dd>{fmtDateTime(d.at)} by {personName(person(d.by))}</dd></div>}
            {d?.note && <div className="cyc-dl-wide"><dt>Note</dt><dd>{d.note}</dd></div>}
          </dl>

          {isAdmin
            ? <Button size="sm" variant="primary" icon="edit" onClick={() => setOpenEdit(true)}>Record a decision</Button>
            : <p className="cyc-warn"><Icon name="key" size={13} />Only an admin can record a decision on a dependency loop.</p>}
        </div>
      )}

      {openEdit && <CycleModal loop={loop} label={label} onClose={() => setOpenEdit(false)} onSave={(patch) => { setCycleDecision(loop.key, patch, label); toast("Decision recorded"); setOpenEdit(false); }} />}
    </div>
  );
}

function CycleModal({ loop, label, onClose, onSave }: { loop: { ids: string[]; key: string }; label: string; onClose: () => void; onSave: (p: any) => void }) {
  const { state } = useStore();
  const d = state.cycleDecisions?.[loop.key];
  const [status, setStatus] = useState<CycleStatus>(d?.status || "under_review");
  const [resolution, setResolution] = useState<CycleResolution | "">(d?.resolution || "");
  const [ownerId, setOwnerId] = useState<string | null>(d?.ownerId || null);
  const [note, setNote] = useState(d?.note || "");
  const [err, setErr] = useState("");

  const save = () => {
    if (status === "decided" && !resolution) { setErr("Pick which way out was chosen before marking this decided."); return; }
    if (status === "decided" && !note.trim()) { setErr("Record why. A decision without a reason is not reviewable later."); return; }
    onSave({ status, resolution: resolution || undefined, ownerId, note: note.trim() || undefined });
  };

  return (
    <Modal title="Record a decision" sub={label} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save decision</Button></>}>
      <div className="form-grid">
        <Field label="Status" full>
          <select value={status} onChange={e => setStatus(e.target.value as CycleStatus)}>
            <option value="undecided">No decision yet</option>
            <option value="under_review">Under review</option>
            <option value="decided">Decided</option>
            <option value="deferred">Deferred</option>
          </select>
        </Field>
        <Field label="Who decides" full>
          <PersonSelect value={ownerId} onChange={setOwnerId} emptyLabel="Nobody assigned" />
        </Field>
        <Field label="Way out" hint="Recorded only. This does not edit any dependency." full>
          <select value={resolution} onChange={e => setResolution(e.target.value as CycleResolution)}>
            <option value="">Not chosen yet</option>
            {RESOLUTIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Reasoning" error={err} full>
          <textarea rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="What was agreed, and why that option over the others" />
        </Field>
      </div>
    </Modal>
  );
}
