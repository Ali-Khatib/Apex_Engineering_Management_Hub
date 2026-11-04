// Domain model for the Apex Engineering Platform.
// In production these map 1:1 to Postgres tables (see brief §12); here they live in a local store.

export type Role = "admin" | "member";
export type Status = "not_started" | "in_progress" | "blocked" | "under_review" | "completed";
export type Priority = "critical" | "high" | "medium" | "low";
export type ChecksState = "pending" | "running" | "passed" | "failed" | "skipped" | "unknown";
export type QAState = "not_submitted" | "awaiting" | "in_progress" | "changes_requested" | "rejected" | "accepted";
export type DeployState = "not_ready" | "pending_review" | "ready" | "scheduled" | "deployed" | "failed" | "rolled_back";
export type ReviewState = "none" | "ready" | "in_review" | "changes_requested" | "accepted";
export type CritStatus = "not_started" | "in_progress" | "submitted" | "accepted" | "rejected" | "changes_requested";
export type LinkKind = "github" | "erpnext" | "slack" | "drive" | "sheets";

export interface NotifyPrefs { assignment: boolean; review: boolean; blocker: boolean; deadline: boolean; handoff: boolean; comment: boolean; }
export const DEFAULT_NOTIFY: NotifyPrefs = { assignment: true, review: true, blocker: true, deadline: true, handoff: true, comment: true };

export interface Person {
  id: string; first: string; last: string; email: string; role: Role;
  title: string; team: string; skills: string[]; hue: number; joined: string; active: boolean;
  /** Which notifications this person wants. Absent means all of them. */
  prefs?: Partial<NotifyPrefs>;
}
export interface Project {
  id: string; code: string; name: string; client: string; sector: string; summary: string; leadId: string;
  problem: string; outcome: string; how: { title: string; text: string }[]; stack: string[]; users: string; external: string[];
}

export interface Evidence {
  id: string; kind: "link" | "file" | "pr" | "commit" | "test" | "screenshot" | "recording";
  label: string; ref: string; by: string; at: string; version: number;
  decision?: "approved" | "rejected" | "changes"; reviewerId?: string; reviewedAt?: string; note?: string;
}
export interface Criterion {
  id: string; text: string; verification: string; evidenceType: string;
  status: CritStatus; evidence: Evidence[];
}
export interface Gate<S> { state: S; at?: string; by?: string; note?: string; commit?: string; }
export interface ArchFile { id: string; name: string; kind: "svg" | "image"; content: string; by: string; at: string; version: number; note?: string; }
export interface Comment { id: string; by: string; at: string; body: string; edited?: boolean; }
export interface ExtLink { id: string; kind: LinkKind; label: string; url: string; ref: string; }
export interface EnvVar { name: string; purpose: string; }

export interface LibInfo {
  group: string; layer: string; wave: string; sps: string[]; users: string; source: string; mapping: string;
  op: string; inputs: string[]; outputs: string[]; entities: string[]; trigger: string; constraints: string; metric: string; test: string;
  overlap: string; folder: string; diagrams: { n: string; title: string; caption: string }[];
}
export interface Module { id: string; name: string; description: string; url: string; }

export interface Component {
  lib: LibInfo | null;
  id: string; name: string; category: string; projectId: string;
  summary: string; purpose: string; deliverable: string; details: string;
  ownerId: string | null; reviewerId: string | null; qaId: string | null;
  priority: Priority; status: Status; review: ReviewState;
  start: string; due: string; eta: string;
  deps: string[]; repoId: string | null; products: string[]; skills: string[];
  criteria: Criterion[];
  gates: { checks: Gate<ChecksState>; qa: Gate<QAState>; deploy: Gate<DeployState> };
  onboarding: { branch: string; folders: string[]; setup: string; env: EnvVar[]; tools: string[] };
  links: ExtLink[];
  architecture: ArchFile[];
  comments: Comment[];
  createdAt: string; updatedAt: string;
}

export interface Commit { sha: string; message: string; author: string; at: string; branch: string; }
export interface PullRequest { number: number; title: string; state: "open" | "merged" | "closed" | "draft"; author: string; at: string; checks: ChecksState; reviewers: string[]; }
export interface Issue { number: number; title: string; state: "open" | "closed"; labels: string[]; author: string; at: string; }
export interface CheckRun { name: string; state: ChecksState; at: string; commit: string; duration: string; required: boolean; detail?: string; }

export interface Repo {
  id: string; name: string; org: string; url: string; description: string;
  defaultBranch: string; visibility: "private" | "internal" | "public";
  languages: string[]; frameworks: string[];
  ownerId: string | null; reviewerId: string | null; pmId: string | null;
  access: "connected" | "pending_install" | "no_access" | "error"; accessNote: string;
  ci: ChecksState; workflow: string;
  env: { dev: string; staging: string; prod: string };
  build: string; test: string; products: string[]; services: string[];
  createdAt: string;
  github: { readme: string; commits: Commit[]; prs: PullRequest[]; issues: Issue[]; runs: CheckRun[]; branches: string[]; contributors: string[] };
}

export type BlockerStatus = "open" | "acknowledged" | "in_progress" | "waiting_external" | "escalated" | "resolved" | "closed";
export interface Blocker {
  id: string; componentId: string; title: string; description: string; category: string;
  severity: "critical" | "high" | "medium" | "low";
  responsibleId: string | null; reportedBy: string; nextAction: string; target: string;
  status: BlockerStatus; createdAt: string; updatedAt: string; resolvedAt?: string; slack?: string;
}

export interface Handoff {
  id: string; componentId: string; fromId: string; toId: string;
  status: "awaiting_ack" | "completed";
  reason: string; completed: string; outstanding: string; knownIssues: string;
  checklist: { id: string; text: string; done: boolean }[];
  target: string; createdAt: string; by: string; ackAt?: string;
}

export interface Practice {
  id: string; title: string; category: string; ownerId: string; summary: string; body: string;
  technologies: string[]; updatedAt: string; updatedBy: string; reviewedAt: string; nextReview: string;
  override: "under_revision" | "archived" | null;
}

export interface Milestone { id: string; name: string; date: string; description: string; componentIds: string[]; }

export interface HistoryEntry {
  id: string; entity: "component" | "practice" | "blocker" | "handoff" | "person" | "plan" | "repo" | "about";
  entityId: string; action: string; field?: string; from?: string; to?: string;
  by: string; at: string; reason?: string; source: "apex" | "github";
}

export interface Notice {
  id: string; to: string; kind: "assignment" | "review" | "blocker" | "deadline" | "handoff" | "comment";
  title: string; body: string; componentId?: string; at: string; read: boolean;
}

export interface Contact { id: string; topic: string; description: string; personId: string; channel: string; }

export interface AppState {
  version: number;
  people: Person[]; projects: Project[]; modules: Module[]; components: Component[]; repos: Repo[];
  blockers: Blocker[]; handoffs: Handoff[]; practices: Practice[]; milestones: Milestone[];
  history: HistoryEntry[]; notices: Notice[];
  about: { vision: string; overview: string; updatedAt: string; updatedBy: string };
  contacts: Contact[];
  plan: { notes: string; updatedAt: string; updatedBy: string };
  graphPos: Record<string, { x: number; y: number }>;
  me: string | null;
}
