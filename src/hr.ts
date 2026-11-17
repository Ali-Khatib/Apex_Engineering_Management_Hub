/**
 * Client for People / HR. Every call needs the backend; nothing here is stored in the browser.
 * The only browser storage involved is the HQ sign-in token (api.ts). A candidate's session token
 * lives in memory only and is gone on refresh.
 */
import { api } from "./api";

export type Kind = "onboarding" | "offboarding";
export interface Ref { id: number; name: string }
export interface Progress { done: number; total: number; required_done: number; required_total: number; percent: number }
export interface CaseRow {
  id: number; kind: Kind; stage: string; stage_label: string; version: number;
  person: { user_id: number | null; candidate_id: number | null; name: string };
  role_title: string; department: string; manager: Ref | null; owner: Ref | null; anchor_date: string | null;
  progress: Progress | null; next_action: { task_id: number; title: string; owner: Ref | null; due_date: string | null; blocked: boolean } | null;
  overdue: number; blocked: number; pending_handover: number; access: "full" | "limited"; created_at: string;
}
export interface Task {
  id: number; key: string; title: string; instructions: string; category: string; required: boolean; owner: Ref | null; due_date: string | null;
  status: string; version: number; integration: string; confirmation: string; confirmed_by: string | null; confirmed_at: string | null;
  evidence_note: string; blocked_reason: string; skip_reason: string; completed_by: string | null; completed_at: string | null;
  system_key: string | null; overdue: boolean; mine: boolean; editable: boolean; can_manage: boolean;
}
export interface HandoverItem {
  id: number; type: "component" | "blocker"; role: string; status: "pending" | "reassigned" | "accepted" | "exception";
  component: { id: number; code: string; name: string; status: string } | null; blocker: { id: number; title: string } | null;
  from: Ref | null; to: Ref | null; exception_reason: string; decided_by: string | null; decided_at: string | null; accepted_by: string | null; accepted_at: string | null;
}
export interface CaseAction { action: string; label: string; enabled: boolean; why: string[]; needs_reason: boolean; to: string | null }
export interface HrEvent { id: number; action: string; actor: string; from_stage: string | null; to_stage: string | null; detail: string; restricted: boolean; created_at: string }
export interface CaseDetail extends CaseRow {
  tasks: Task[]; status_text: string; limited: boolean; actions?: CaseAction[]; blockers_to_complete?: string[];
  approval?: { approved: boolean; by: string | null; at: string | null };
  handover?: { items: HandoverItem[]; pending: number; reassigned: number; accepted: number; exceptions: number } | null;
  events?: HrEvent[]; can_edit?: boolean; can_reassign?: boolean; can_manage?: boolean; person_account?: { active: boolean } | null;
  restricted?: { reason_category: string; notes: string; closed_reason: string };
  candidate?: { id: number; name: string; stage: string; stage_label: string; route: string } | null;
}
export interface Attention { rank: number; what: string; person: string; owner: Ref | null; due: string | null; reason: string; route: string }
export interface Overview {
  counts: { onboarding: number; offboarding: number; awaiting_approval: number; overdue_tasks: number; blocked_tasks: number; candidates_awaiting_review: number; candidates_open: number };
  attention: Attention[]; attention_total: number; can: { start: boolean; review_candidates: boolean }; scope: "all" | "yours";
}
export interface CaseList { items: CaseRow[]; total: number; page: number; per: number }
export interface TemplateTask { key: string; title: string; instructions: string; category: string; required: boolean; integration: string; owner: string; offset_days: number; system?: string }
export interface CandidateRow {
  id: number; name: string; email: string; role_title: string; stage: string; view: string; stage_label: string; version: number;
  assessment_title: string; assessment_hours: number; first_sign_in_at: string | null; deadline_at: string | null; submitted: boolean;
  received_at: string | null; created_at: string; onboarding_case_id: number | null;
}
export interface CandidateDetail extends CandidateRow {
  assessment_brief: string; assessment_instructions: string; decision_reason: string; decided_by: string | null; decided_at: string | null;
  submission: { notes: string; repository_url: string; linkedin_url: string; receipt_id: string; checksum: string; received_at: string } | null;
  actions: { action: string; label: string; enabled: boolean; needs_reason: boolean }[];
  events: { id: number; action: string; actor: string; detail: string; created_at: string; from_stage: string | null; to_stage: string | null }[];
}
export interface Access { invitation_path: string; code: string; code_valid_minutes: number; delivery: string }
export interface LifecycleRow { user_id: number; lifecycle: string; lifecycle_label: string }
export interface PersonContext {
  user_id: number; lifecycle: string | null; lifecycle_label: string | null; cases: { id: number; kind: Kind; stage: string; stage_label: string; route: string }[];
  engineering: { owner: EngRow[]; reviewer: EngRow[]; qa: EngRow[]; open_blockers: number }; manager: Ref | null;
  account: { active: boolean; note: string };
}
export interface EngRow { id: number; code: string; name: string; status: string; historical: boolean }

export const newRequestId = () => (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v)); }); const s = p.toString(); return s ? "?" + s : ""; };

export const overview = () => api<Overview>("/hr/overview");
export const lifecycle = () => api<LifecycleRow[]>("/hr/lifecycle");
export const personContext = (id: number) => api<PersonContext>(`/hr/people/${id}`);
export const integrations = () => api<{ items: { system: string; state: string; detail: string }[]; note: string }>("/hr/integrations");
export const cases = (f: Record<string, unknown>) => api<CaseList>("/hr/cases" + qs(f));
export const getCase = (id: number) => api<CaseDetail>(`/hr/cases/${id}`);
export const startCase = (b: Record<string, unknown>) => api<CaseDetail>("/hr/cases", { method: "POST", body: b });
export const caseAction = (id: number, b: { action: string; version: number; reason?: string }) => api<CaseDetail>(`/hr/cases/${id}/actions`, { method: "POST", body: { ...b, request_id: newRequestId() } });
export const patchTask = (cid: number, tid: number, b: Record<string, unknown>) => api<CaseDetail>(`/hr/cases/${cid}/tasks/${tid}`, { method: "PATCH", body: { ...b, request_id: newRequestId() } });
export const addTask = (cid: number, b: Record<string, unknown>) => api<CaseDetail>(`/hr/cases/${cid}/tasks`, { method: "POST", body: b });
export const syncHandover = (cid: number) => api<{ added: number; reopened: number; case: CaseDetail }>(`/hr/cases/${cid}/handover/sync`, { method: "POST" });
export const reassign = (cid: number, hid: number, to: number | null, note: string) => api<CaseDetail>(`/hr/cases/${cid}/handover/${hid}/reassign`, { method: "POST", body: { to_user_id: to, note, request_id: newRequestId() } });
export const acceptItem = (cid: number, hid: number) => api<CaseDetail | { ok: true }>(`/hr/cases/${cid}/handover/${hid}/accept`, { method: "POST", body: { request_id: newRequestId() } });
export const exceptItem = (cid: number, hid: number, reason: string) => api<CaseDetail>(`/hr/cases/${cid}/handover/${hid}/exception`, { method: "POST", body: { reason, request_id: newRequestId() } });
export const templates = () => api<Record<Kind, { name: string; tasks: TemplateTask[]; version: number }>>("/hr/templates");
export const saveTemplate = (kind: Kind, tasks: TemplateTask[], version: number) => api<{ tasks: TemplateTask[]; version: number; note: string }>(`/hr/templates/${kind}`, { method: "PUT", body: { tasks, version } });
export const candidates = () => api<{ items: CandidateRow[]; total: number }>("/hr/candidates");
export const candidate = (id: number) => api<CandidateDetail>(`/hr/candidates/${id}`);
export const invite = (b: Record<string, unknown>) => api<{ candidate: CandidateDetail; access: Access }>("/hr/candidates", { method: "POST", body: b });
export const candidateAction = (id: number, b: Record<string, unknown>) => api<{ candidate: CandidateDetail; access: Access | null }>(`/hr/candidates/${id}/actions`, { method: "POST", body: { ...b, request_id: newRequestId() } });

/* The candidate side uses its own header and never an HQ token. */
const BASE = (((import.meta as any).env?.VITE_API_URL as string) ?? "").replace(/^\.$/, "").replace(/\/$/, "");
async function pub<T>(path: string, opts: { method?: string; body?: unknown; session?: string } = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/candidate${path}`, { method: opts.method || "GET", headers: { "Content-Type": "application/json", ...(opts.session ? { "X-Candidate-Session": opts.session } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const d = body?.detail; throw Object.assign(new Error(typeof d === "string" ? d : d?.message || "Something went wrong"), { status: res.status, fields: d?.fields || {} }); }
  return body as T;
}
export const candInvitation = (token: string) => pub<{ assessment_title: string }>(`/invitation?token=${encodeURIComponent(token)}`);
export const candVerify = (invitation: string, code: string) => pub<{ session: string; expires_in_minutes: number }>("/verify", { method: "POST", body: { invitation, code } });
export const candMe = (session: string) => pub<{ name: string; assessment_title: string; brief: string; instructions: string; deadline_at: string | null; server_time: string; state: string; can_submit: boolean; receipt: { receipt_id: string; received_at: string; checksum: string } | null; note: string }>("/me", { session });
export const candSubmit = (session: string, b: { operation_id: string; notes: string; repository_url: string; linkedin_url: string }) => pub<{ receipt_id: string; received_at: string; checksum: string; repeat: boolean }>("/submit", { method: "POST", body: b, session });
