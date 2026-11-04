/**
 * API client and adapters for the Apex backend.
 *
 * This is the integration layer described in docs/backend-integration-map.md:
 * a typed client plus explicit adapters, so no working UI component has to be
 * rewritten to talk to a server whose shapes differ from ours.
 *
 * IT IS OPT-IN. With no VITE_API_URL set the application behaves exactly as it
 * does today, reading from the local store. Nothing here runs unless a backend
 * is configured, so adding this file cannot break the deployed product.
 *
 * Conventions are taken from the backend's own client, not invented:
 *   - every route is under /api
 *   - the token lives in localStorage as `apex_token`
 *   - auth is `Authorization: Bearer <token>`
 *   - errors come back as { detail: string | object }
 *   - a 401 means the token is dead
 *   - live updates arrive on /api/events?token=<token>
 */
import type { Component, Person, Priority, Status } from "./types";

const BASE: string = (import.meta as any).env?.VITE_API_URL ?? "";
const TOKEN_KEY = "apex_token";

/** True when a backend is configured. Everything else here assumes it. */
export const apiEnabled = () => BASE.length > 0;

export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
const setToken = (t: string | null) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "ApiError"; }
}

export async function api<T = unknown>(path: string, opts: RequestInit & { body?: unknown } = {}): Promise<T> {
  if (!apiEnabled()) throw new ApiError(0, "No backend configured. Set VITE_API_URL to enable it.");
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // A dead token is cleared, but the caller decides what to do about it. The
  // reference client redirected to /login from inside the fetch helper, which
  // makes every call capable of navigating the page out from under you.
  if (res.status === 401 && !path.startsWith("/auth")) setToken(null);

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (null as T) : res.json();
}

/* ───────────────────────── auth ───────────────────────── */

export async function login(email: string, password: string): Promise<void> {
  const r = await api<{ token: string }>("/auth/login", { method: "POST", body: { email, password } });
  setToken(r.token);
}
export const logout = () => setToken(null);
export const me = () => api<ServerUser>("/me");

/** Live updates. Returns an unsubscribe function. */
export function connectEvents(onEvent: (e: unknown) => void): () => void {
  if (!apiEnabled()) return () => {};
  const es = new EventSource(`${BASE}/api/events?token=${encodeURIComponent(getToken() ?? "")}`);
  es.onmessage = (ev) => { try { onEvent(JSON.parse(ev.data)); } catch { /* keepalive */ } };
  return () => es.close();
}

/* ───────────────────── server shapes ───────────────────── */
// Transcribed from backend/app/serializers.py. Not guessed.

export interface ServerUser {
  id: number; first_name: string; last_name: string; email: string;
  role: "admin" | "member"; title: string; onboarding_notes: string;
}
export interface ServerComponent {
  id: number; code: string; name: string; category: string; layer: string;
  status: string; approval_state?: string; priority: string;
  due_date: string | null; owner: ServerUser | null;
  repo: { id: number; full_name: string; url: string } | null;
  milestone_id: number | null; open_blockers: number; at_risk: boolean;
  unassigned: boolean; review_requested: boolean;
  gates: { checks_passed: boolean; qa_accepted: boolean; ready_for_deploy: boolean };
  ready_for_review: boolean; description: string;
  spec_md?: string; docs_md?: string; architecture_md?: string;
  acceptance_criteria?: string; links?: Record<string, string>; updated_at?: string;
}
/** The sidecar from migration 0002. Keyed by code, never rewritten by the app. */
export interface ServerProvenance {
  code: string; namespace: string; group: string; layer: string; wave: string;
  sps: string[]; source: string; source_url: string; mapping: string;
  overlap: string; folder: string;
  diagrams: { n: string; title: string; caption: string }[];
  users: string; op: string; inputs: string[]; outputs: string[];
  entities: string[]; trigger: string; constraints: string;
  metric: string; test: string; library_state: string;
}

/* ─────────────────────── vocabularies ─────────────────────── */
// The mapping is documented in docs/status-vocabulary.md. It is deliberately
// explicit: two legacy values collapse into one of ours, so this cannot be a
// rename and must not be applied to stored records without review.

const PRIORITY_IN: Record<string, Priority> = { P0: "critical", P1: "high", P2: "medium", P3: "low" };
const PRIORITY_OUT: Record<Priority, string> = { critical: "P0", high: "P1", medium: "P2", low: "P3" };

const STATUS_IN: Record<string, Status> = {
  not_started: "not_started", proposed: "not_started",
  in_progress: "in_progress", blocked: "blocked",
  in_review: "under_review", under_review: "under_review",
  done: "completed", completed: "completed", deployed: "completed",
};
const STATUS_OUT: Record<Status, string> = {
  not_started: "not_started", in_progress: "in_progress", blocked: "blocked",
  under_review: "in_review", completed: "completed",
};

export const toPriority = (p: string): Priority => PRIORITY_IN[p] ?? "medium";
export const fromPriority = (p: Priority): string => PRIORITY_OUT[p];
export const toStatus = (s: string): Status => STATUS_IN[s] ?? "not_started";
export const fromStatus = (s: Status): string => STATUS_OUT[s];

/**
 * Decision 1: the code is the identity our URLs and documents use; the integer
 * id is an internal join key. This index is the explicit mapping between them
 * and is the only place the two are allowed to meet.
 */
export class CodeIndex {
  private byCode = new Map<string, number>();
  private byId = new Map<number, string>();
  load(components: { id: number; code: string }[]) {
    this.byCode.clear(); this.byId.clear();
    for (const c of components) { this.byCode.set(c.code, c.id); this.byId.set(c.id, c.code); }
    return this;
  }
  id(code: string): number | undefined { return this.byCode.get(code); }
  code(id: number): string | undefined { return this.byId.get(id); }
  /** Throws rather than silently calling a missing component 0. */
  requireId(code: string): number {
    const id = this.byCode.get(code);
    if (id === undefined) throw new ApiError(404, `No component with code ${code}`);
    return id;
  }
}

/* ───────────────────────── adapters ───────────────────────── */

export const toPerson = (u: ServerUser): Person => ({
  id: String(u.id), first: u.first_name, last: u.last_name, email: u.email,
  role: u.role, title: u.title,
  // Not on the server. docs/backend-integration-map.md §2.2 lists these as
  // missing columns; they are left empty rather than invented.
  team: "", skills: [], hue: 0, joined: "", active: true,
});

/**
 * One server component plus its provenance row becomes one of ours.
 *
 * Fields the backend does not carry are left empty rather than filled with a
 * plausible value: reviewer, QA contact, start and ETA dates, acceptance
 * criteria as structured records, and the gate state machines. The three gates
 * arrive as booleans, so a true maps to the settled state and a false to the
 * unstarted one. That loses the actor and the timestamp, which the backend
 * does not record.
 */
export function toComponent(c: ServerComponent, prov?: ServerProvenance): Component {
  return {
    id: c.code,                       // decision 1: the code is the identity
    name: c.name,
    category: c.category,
    projectId: prov?.namespace ?? "",
    summary: c.description ?? "",
    purpose: c.spec_md ?? "",
    deliverable: "",
    details: c.docs_md ?? "",
    ownerId: c.owner ? String(c.owner.id) : null,
    reviewerId: null,                 // no column on the server
    qaId: null,                       // no column on the server
    priority: toPriority(c.priority),
    status: toStatus(c.status),
    review: c.review_requested ? "in_review" : "none",
    start: "", due: c.due_date ?? "", eta: "",
    deps: [],                         // filled from GET /graph, not this shape
    repoId: c.repo ? String(c.repo.id) : null,
    products: [], skills: [],
    criteria: [],                     // server stores prose, not records
    gates: {
      checks: { state: c.gates.checks_passed ? "passed" : "unknown" },
      qa: { state: c.gates.qa_accepted ? "accepted" : "not_submitted" },
      deploy: { state: c.gates.ready_for_deploy ? "ready" : "not_ready" },
    },
    onboarding: { branch: "—", folders: [], setup: "", env: [], tools: [] },
    links: [], architecture: [], comments: [],
    createdAt: "", updatedAt: c.updated_at ?? "",
    lib: prov
      ? {
          group: prov.group, layer: prov.layer, wave: prov.wave, sps: prov.sps ?? [],
          users: prov.users, source: prov.source, mapping: prov.mapping,
          op: prov.op, inputs: prov.inputs ?? [], outputs: prov.outputs ?? [],
          entities: prov.entities ?? [], trigger: prov.trigger,
          constraints: prov.constraints, metric: prov.metric, test: prov.test,
          overlap: prov.overlap, folder: prov.folder, diagrams: prov.diagrams ?? [],
        }
      : null,
  };
}

/* ───────────────────────── endpoints ───────────────────────── */
// Only routes confirmed to exist in backend/app/api.py.

export const listComponents = () => api<ServerComponent[]>("/components");
export const getComponent = (id: number) => api<ServerComponent>(`/components/${id}`);
export const patchComponent = (id: number, patch: Record<string, unknown>) =>
  api<ServerComponent>(`/components/${id}`, { method: "PATCH", body: patch });
export const listUsers = () => api<ServerUser[]>("/users");
export const getPortfolio = () => api<Record<string, unknown>>("/portfolio");
export const getGraph = () =>
  api<{ cycles: number[][]; nodes: { id: number; code: string }[]; edges: { id: number; from: number; to: number }[] }>("/graph");
export const listNotifications = () => api<unknown[]>("/notifications");
export const markNotificationsRead = () => api("/notifications/read", { method: "POST" });
export const listAudit = () => api<unknown[]>("/audit");
export const listRepos = () => api<unknown[]>("/repos");
export const listKb = () => api<unknown[]>("/kb");

// Deliberately absent: /repos/{id}/simulate. It fabricates GitHub activity and
// is gated off on the server; the frontend must never call it.
