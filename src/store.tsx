// The local demo mutates a browser copy; API mode persists only supported backend operations.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { AppState, Component, Person, Repo, Blocker, Handoff, Practice, Milestone, Evidence, Criterion, Contact, HistoryEntry, Notice, ArchFile, ExtLink, QAState, DeployState, Status } from "./types";
import { seedState } from "./seed";
import { nowIso, iso, today, addDays, personName, STATUS_LABEL } from "./logic";
import {
  ApiError, CodeIndex, addComponentComment as postComment, addDependency as postDependency,
  apiEnabled, createComponent as postComponent, deleteComponent as deleteServerComponent,
  deleteDependency as deleteServerDependency, getComponent, getGraph, getToken,
  listBlockers, addServerBlocker, resolveServerBlocker,
  listComponents, listRepositories, listUsers, login as apiLogin, logout as apiLogout,
  me as getCurrentUser, patchComponent, recordAcceptance, requestComponentReview,
  setComponentGate, toComponent, toPerson, fromPriority, fromStatus,
} from "./api";
import type { ServerBlocker, ServerComponentDetail, ServerRepo } from "./api";

const KEY = "apex-eip-v8";
let n = 0; const uid = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

function load(): AppState {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.version === 8) return s; } } catch { /* storage unavailable */ }
  return seedState();
}

function toRepo(r: ServerRepo): Repo {
  const [org, ...name] = r.full_name.split("/");
  const ci: Repo["ci"] = r.ci === "success" ? "passed" : r.ci === "failure" ? "failed" : r.ci === "running" ? "running" : "unknown";
  return {
    id: String(r.id), name: name.join("/") || r.full_name, org, url: r.url, description: r.description,
    defaultBranch: r.default_branch, visibility: "unknown", languages: [], frameworks: [],
    ownerId: null, reviewerId: null, pmId: null, access: "unknown",
    accessNote: "GitHub App access is not exposed by this API response.",
    ci, workflow: "", env: { dev: "", staging: "", prod: "" }, build: "", test: "",
    products: [], services: [], createdAt: "", githubActivityLoaded: false,
    github: { readme: "", commits: [], prs: [], issues: [], runs: [], branches: [], contributors: [] },
  };
}

function toBlocker(b: ServerBlocker): Blocker {
  const severity = ["critical", "high", "medium", "low"].includes(b.severity ?? "")
    ? b.severity as Blocker["severity"] : "unspecified";
  return {
    id: `BLK-${String(b.id).padStart(3, "0")}`,
    componentId: b.component_code,
    title: b.title || b.description.slice(0, 100) || "Blocker",
    description: b.description,
    category: b.category || "Unspecified",
    severity,
    responsibleId: b.responsible_id === null ? null : String(b.responsible_id),
    reportedBy: b.raised_by ? String(b.raised_by.id) : "",
    nextAction: b.next_action || "",
    target: b.target_date || "",
    status: b.resolved ? "resolved" : "open",
    createdAt: b.created_at,
    updatedAt: b.resolved_at || b.created_at,
    resolvedAt: b.resolved_at || undefined,
    slack: b.slack || undefined,
  };
}

type Ctx = ReturnType<typeof useProvideStore>;
const StoreCtx = createContext<Ctx | null>(null);
export const useStore = () => useContext(StoreCtx)!;

// ───────────── toasts ─────────────
export interface Toast { id: string; text: string; tone: "ok" | "warn" | "crit" | "info"; }
const ToastCtx = createContext<{ toasts: Toast[]; toast: (text: string, tone?: Toast["tone"]) => void; dismiss: (id: string) => void }>(null as any);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, set] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => set(t => t.filter(x => x.id !== id)), []);
  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = uid("t"); set(t => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);
  return <ToastCtx.Provider value={{ toasts, toast, dismiss }}>{children}</ToastCtx.Provider>;
}

const FIELD_LABEL: Record<string, string> = { ownerId: "owner", reviewerId: "reviewer", qaId: "QA contact", priority: "priority", status: "status", due: "due date", eta: "ETA", start: "start date", repoId: "repository", projectId: "project", category: "category", name: "name", deliverable: "expected deliverable" };

function useProvideStore() {
  const [state, setState] = useState<AppState>(() => {
    const initial = load();
    if (apiEnabled()) initial.me = null;
    return initial;
  });
  const [saveError, setSaveError] = useState(false);
  const [authLoading, setAuthLoading] = useState(apiEnabled() && Boolean(getToken()));
  const [authError, setAuthError] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const { toast } = useToast();
  const codeIndex = useRef(new CodeIndex());
  const edgeIndex = useRef(new Map<string, number>());
  const libraryIndex = useRef(new Map<string, Component>());

  useEffect(() => {
    if (apiEnabled()) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); setSaveError(false); } catch { setSaveError(true); }
    }, 250);
  }, [state]);

  const hydrateApi = useCallback(async () => {
    const [currentUser, users, serverComponents, graph, serverRepos, serverBlockers] = await Promise.all([
      getCurrentUser(), listUsers(), listComponents(), getGraph(), listRepositories(), listBlockers(),
    ]);
    const local = seedState();
    const libraryByCode = new Map(local.components.map(c => [c.id, c]));
    const codeById = new Map(serverComponents.map(c => [c.id, c.code]));
    codeIndex.current.load(serverComponents);
    edgeIndex.current = new Map(graph.edges.map(edge => [`${edge.from}:${edge.to}`, edge.id]));
    libraryIndex.current = libraryByCode;
    const components = serverComponents.map(server => {
      const component = toComponent(server);
      const libraryComponent = libraryByCode.get(server.code);
      component.lib = libraryComponent?.lib ?? null;
      component.projectId = libraryComponent?.projectId ?? "";
      component.purpose = libraryComponent?.purpose ?? component.summary;
      component.details = libraryComponent?.details ?? "";
      component.deps = graph.edges
        .filter(edge => edge.from === server.id)
        .map(edge => codeById.get(edge.to))
        .filter((code): code is string => Boolean(code));
      return component;
    });
    setState({
      ...local,
      people: users.map(toPerson),
      components,
      repos: serverRepos.map(toRepo),
      blockers: serverBlockers.map(toBlocker),
      handoffs: [],
      milestones: [],
      history: [],
      notices: [],
      me: String(currentUser.id),
    });
  }, []);

  const refreshApiGraph = useCallback(async () => {
    const graph = await getGraph();
    const codeById = new Map(graph.nodes.map(node => [node.id, node.code]));
    edgeIndex.current = new Map(graph.edges.map(edge => [`${edge.from}:${edge.to}`, edge.id]));
    setState(prev => ({
      ...prev,
      components: prev.components.map(component => ({
        ...component,
        deps: graph.edges
          .filter(edge => edge.from === codeIndex.current.id(component.id))
          .map(edge => codeById.get(edge.to))
          .filter((code): code is string => Boolean(code)),
      })),
    }));
  }, []);

  const refreshApiBlockers = useCallback(async () => {
    const blockers = await listBlockers();
    setState(prev => ({ ...prev, blockers: blockers.map(toBlocker) }));
  }, []);

  const refreshApiComponent = useCallback(async (code: string) => {
    const serverId = codeIndex.current.requireId(code);
    const detail: ServerComponentDetail = await getComponent(serverId);
    const component = toComponent(detail);
    const library = libraryIndex.current.get(code);
    component.lib = library?.lib ?? null;
    component.projectId = library?.projectId ?? "";
    component.purpose = library?.purpose ?? component.summary;
    component.details = detail.docs_md ?? "";
    component.deliverable = detail.acceptance_criteria ?? "";
    component.links = Object.entries(detail.links ?? {}).map(([kind, url]) => ({
      id: `${code}-${kind}`, kind: kind as ExtLink["kind"], label: kind, url, ref: url,
    })).filter(link => ["github", "erpnext", "slack", "drive", "sheets"].includes(link.kind));
    component.deps = detail.dependencies?.map(dependency => dependency.code) ?? [];
    component.comments = (detail.comments ?? []).map(comment => ({
      id: String(comment.id), body: comment.body, at: comment.created_at,
      by: String(comment.author.id),
    }));
    const acceptance = detail.acceptances?.[0];
    if (acceptance) {
      component.gates.qa = {
        state: acceptance.decision === "accepted" ? "accepted" : acceptance.decision,
        at: acceptance.created_at, by: String(acceptance.reviewer.id), note: acceptance.evidence,
      };
    } else if (detail.review_requested) {
      component.gates.qa = { state: "awaiting" };
    }
    component.gates.deploy = {
      state: detail.status === "deployed" ? "deployed" : detail.gates.ready_for_deploy ? "ready" : "not_ready",
    };
    component.review = detail.review_requested ? "in_review" : "none";
    const history = (detail.history ?? []).map(entry => ({
      id: String(entry.id), entity: "component", entityId: code, action: entry.action,
      to: entry.detail, by: entry.actor ? String(entry.actor.id) : "system",
      at: entry.created_at, source: "apex",
    } as HistoryEntry));
    setState(prev => ({
      ...prev,
      components: prev.components.map(existing => existing.id === code ? component : existing),
      history: [
        ...history,
        ...prev.history.filter(entry => entry.entity !== "component" || entry.entityId !== code),
      ],
    }));
  }, []);

  const runApiWrite = useCallback(async (code: string, operation: () => Promise<void>, refreshGraph = false) => {
    try {
      await operation();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        apiLogout();
        setState(prev => ({ ...prev, me: null }));
      }
      try {
        if (refreshGraph) await refreshApiGraph();
        await refreshApiComponent(code);
      } catch (refreshError) {
        toast(`The write failed and the latest backend data could not be reloaded: ${refreshError instanceof Error ? refreshError.message : "unknown error"}`, "warn");
      }
      toast(error instanceof Error ? error.message : "The backend write failed.", "crit");
      return false;
    }
    try {
      if (refreshGraph) await refreshApiGraph();
      await refreshApiComponent(code);
    } catch (error) {
      toast(`Saved, but the latest backend data could not be reloaded: ${error instanceof Error ? error.message : "unknown error"}`, "warn");
    }
    return true;
  }, [refreshApiComponent, refreshApiGraph, toast]);

  const loadComponentDetail = useCallback(async (code: string) => {
    if (!apiEnabled()) return;
    try {
      await refreshApiComponent(code);
    } catch (error) {
      toast(`Could not load component details: ${error instanceof Error ? error.message : "unknown backend error"}`, "crit");
    }
  }, [refreshApiComponent, toast]);

  useEffect(() => {
    if (!apiEnabled() || !getToken()) return;
    setAuthLoading(true);
    setAuthError(null);
    hydrateApi().catch(error => {
      if (error instanceof ApiError && error.status === 401) apiLogout();
      setAuthError(error instanceof Error ? error.message : "Could not load data from the backend.");
    }).finally(() => setAuthLoading(false));
  }, [hydrateApi]);

  const mutate = useCallback((fn: (d: AppState) => void) => {
    setState(prev => { const d = structuredClone(prev); fn(d); return d; });
  }, []);

  const authenticate = useCallback(async (email: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await apiLogin(email, password);
      await hydrateApi();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) apiLogout();
      const message = error instanceof Error ? error.message : "Could not sign in.";
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  }, [hydrateApi]);

  const pname = (d: AppState, id?: string | null) => personName(d.people.find(p => p.id === id));
  const log = (d: AppState, e: Omit<HistoryEntry, "id" | "at" | "by" | "source"> & { by?: string }) =>
    d.history.unshift({ id: uid("h"), at: nowIso(), by: e.by || d.me || "system", source: "apex", ...e } as HistoryEntry);
  const notify = (d: AppState, to: string | null | undefined, kind: Notice["kind"], title: string, body: string, componentId?: string) => {
    if (!to || to === d.me) return;
    // Preferences are real: an unticked kind is never delivered.
    if (d.people.find(p => p.id === to)?.prefs?.[kind] === false) return;
    d.notices.unshift({ id: uid("n"), to, kind, title, body, componentId, at: nowIso(), read: false });
  };
  const comp = (d: AppState, id: string) => d.components.find(c => c.id === id)!;
  const touch = (c: Component) => { c.updatedAt = nowIso(); };
  const serverUserId = (id: string | null) => {
    if (id === null) return null;
    const parsed = Number(id);
    if (!Number.isInteger(parsed) || parsed < 1) throw new ApiError(422, "This account cannot be assigned by the configured backend.");
    return parsed;
  };
  const serverRepoId = (id: string | null) => {
    if (id === null) return null;
    const parsed = Number(id);
    if (!Number.isInteger(parsed) || parsed < 1) throw new ApiError(422, "Select a repository loaded from the backend.");
    return parsed;
  };

  const actions = {
    // ── identity
    signIn: (id: string) => {
      if (apiEnabled()) return;
      mutate(d => { d.me = id; });
    },
    signOut: () => {
      if (apiEnabled()) {
        apiLogout();
        const fresh = seedState();
        fresh.me = null;
        setState(fresh);
        return;
      }
      setState(prev => ({ ...prev, me: null }));
    },
    register: (p: { first: string; last: string; email: string }) => {
      const id = uid("u");
      mutate(d => {
        d.people.push({ id, first: p.first.trim(), last: p.last.trim(), email: p.email.trim().toLowerCase(), role: "member", title: "Engineer", team: "—", skills: [], hue: Math.floor(Math.random() * 360), joined: iso(today()), active: true });
        d.me = id;
        log(d, { entity: "person", entityId: id, action: "Joined the platform", by: id });
      });
      return id;
    },
    addPerson: (p: Omit<Person, "id" | "hue" | "joined" | "active" | "skills" | "team"> & { team?: string }) => mutate(d => {
      const id = uid("u");
      d.people.push({ ...p, team: p.team || "—", id, skills: [], hue: Math.floor(Math.random() * 360), joined: iso(today()), active: true });
      log(d, { entity: "person", entityId: id, action: `Added ${p.first} ${p.last} as ${p.role}` });
    }),
    updatePerson: (id: string, patch: Partial<Person>) => mutate(d => {
      const p = d.people.find(x => x.id === id)!;
      if (patch.role && patch.role !== p.role) log(d, { entity: "person", entityId: id, action: "Role changed", field: "role", from: p.role, to: patch.role });
      Object.assign(p, patch);
    }),
    removePerson: (id: string) => mutate(d => {
      const p = d.people.find(x => x.id === id)!;
      for (const c of d.components) {
        if (c.ownerId === id) { c.ownerId = null; log(d, { entity: "component", entityId: c.id, action: "Owner removed", field: "owner", from: id, to: "Unassigned", reason: `${p.first} ${p.last} was removed from the platform` }); }
        if (c.reviewerId === id) c.reviewerId = null;
        if (c.qaId === id) c.qaId = null;
      }
      d.people = d.people.filter(x => x.id !== id);
      log(d, { entity: "person", entityId: id, action: `Removed ${p.first} ${p.last}` });
    }),

    // ── components
    createComponent: async (c: Component): Promise<boolean> => {
      if (apiEnabled()) {
        let created: { id: number; code: string } | null = null;
        try {
          if (c.reviewerId || c.qaId) throw new ApiError(409, "Reviewer and QA assignments are not supported by the backend yet.");
          const serverComponent = await postComponent({
            code: c.id, name: c.name, category: c.category, layer: c.lib?.layer ?? c.category,
            description: c.summary, spec_md: c.purpose, docs_md: c.details,
            acceptance_criteria: c.deliverable, status: fromStatus(c.status),
            priority: fromPriority(c.priority), due_date: c.due || null,
            owner_id: serverUserId(c.ownerId), repo_id: serverRepoId(c.repoId),
            links: Object.fromEntries(c.links.map(link => [link.kind, link.url])),
          });
          created = serverComponent;
          codeIndex.current.add(serverComponent);
          for (const dependency of c.deps) {
            await postDependency(serverComponent.id, codeIndex.current.requireId(dependency));
          }
          await hydrateApi();
          await refreshApiComponent(c.id);
          return true;
        } catch (error) {
          let refreshError: unknown;
          if (created) {
            try { await hydrateApi(); } catch (failure) { refreshError = failure; }
          }
          if (error instanceof ApiError && error.status === 401) {
            apiLogout();
            setState(prev => ({ ...prev, me: null }));
          }
          toast(created
            ? `Component ${c.id} was created, but a related step failed: ${error instanceof Error ? error.message : "unknown backend error"}${refreshError instanceof Error ? `; refreshing backend data also failed: ${refreshError.message}` : ""}`
            : error instanceof Error ? error.message : "Could not create the component.", "crit");
          return created !== null;
        }
      }
      mutate(d => {
        d.components.push(c);
        log(d, { entity: "component", entityId: c.id, action: "Component created" });
        if (c.ownerId) { log(d, { entity: "component", entityId: c.id, action: "Owner assigned", field: "owner", from: "Unassigned", to: c.ownerId }); notify(d, c.ownerId, "assignment", `You own ${c.name}`, "Your onboarding pack is ready on the component page.", c.id); }
        if (c.reviewerId) notify(d, c.reviewerId, "review", `You are reviewer for ${c.name}`, `${c.id} · due ${c.due}`, c.id);
      });
      return true;
    },
    updateComponent: async (id: string, patch: Partial<Component>, reason?: string): Promise<boolean> => {
      if (apiEnabled()) {
        const current = state.components.find(component => component.id === id);
        if (!current) {
          toast(`Component ${id} is not loaded. Refresh and try again.`, "crit");
          return false;
        }
        const supported = new Set<keyof Component>([
          "name", "category", "summary", "purpose", "details", "ownerId",
          "reviewerId", "qaId", "priority", "status", "due", "repoId", "deps", "deliverable",
        ]);
        const unsupported = (Object.keys(patch) as (keyof Component)[])
          .filter(key => !supported.has(key) && JSON.stringify(current[key]) !== JSON.stringify(patch[key]));
        if (unsupported.length) {
          toast(`The backend cannot save these fields yet: ${unsupported.join(", ")}. No changes were made.`, "warn");
          return false;
        }
        return runApiWrite(id, async () => {
          const body: Record<string, unknown> = {};
          if (patch.name !== undefined) body.name = patch.name;
          if (patch.category !== undefined) { body.category = patch.category; body.layer = patch.category; }
          if (patch.summary !== undefined) body.description = patch.summary;
          if (patch.purpose !== undefined) body.spec_md = patch.purpose;
          if (patch.details !== undefined) body.docs_md = patch.details;
          if (patch.deliverable !== undefined) body.acceptance_criteria = patch.deliverable;
          if (patch.ownerId !== undefined) body.owner_id = serverUserId(patch.ownerId);
          if (patch.reviewerId !== undefined) body.reviewer_id = serverUserId(patch.reviewerId);
          if (patch.qaId !== undefined) body.qa_id = serverUserId(patch.qaId);
          if (patch.priority !== undefined) body.priority = fromPriority(patch.priority);
          if (patch.status !== undefined) body.status = fromStatus(patch.status);
          if (patch.due !== undefined) body.due_date = patch.due || null;
          if (patch.repoId !== undefined) body.repo_id = serverRepoId(patch.repoId);
          if (Object.keys(body).length) await patchComponent(codeIndex.current.requireId(id), body);
          if (patch.deps !== undefined) {
            const before = new Set(current.deps);
            const after = new Set(patch.deps);
            for (const dependency of before) {
              if (!after.has(dependency)) {
                const edgeId = edgeIndex.current.get(`${codeIndex.current.requireId(id)}:${codeIndex.current.requireId(dependency)}`);
                if (edgeId === undefined) throw new ApiError(409, `Dependency edge ${id} → ${dependency} is not loaded.`);
                await deleteServerDependency(edgeId);
              }
            }
            for (const dependency of after) {
              if (!before.has(dependency)) {
                await postDependency(codeIndex.current.requireId(id), codeIndex.current.requireId(dependency));
              }
            }
          }
          if (reason?.trim()) toast("The backend does not store change reasons; the field updates were saved without that note.", "warn");
        }, patch.deps !== undefined);
      }
      mutate(d => {
      const c = comp(d, id);
      for (const k of Object.keys(patch) as (keyof Component)[]) {
        const before = c[k] as any, after = patch[k] as any;
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        if (k in FIELD_LABEL) {
          const show = (v: any) => k === "ownerId" || k === "reviewerId" || k === "qaId" ? (v ? v : "Unassigned") : k === "status" ? STATUS_LABEL[v as Status] : String(v ?? "—");
          const action = k === "ownerId" ? (before ? "Owner changed" : "Owner assigned") : k === "eta" || k === "due" || k === "start" ? "Plan changed" : `${FIELD_LABEL[k][0].toUpperCase()}${FIELD_LABEL[k].slice(1)} changed`;
          log(d, { entity: "component", entityId: id, action, field: FIELD_LABEL[k], from: show(before), to: show(after), reason });
        } else if (k === "deps") {
          log(d, { entity: "component", entityId: id, action: "Dependencies changed", from: (before as string[]).join(", ") || "none", to: (after as string[]).join(", ") || "none", reason });
        } else if (k === "details") {
          log(d, { entity: "component", entityId: id, action: "Details updated" });
        }
      }
      if (patch.ownerId && patch.ownerId !== c.ownerId) notify(d, patch.ownerId, "assignment", `You own ${patch.name || c.name}`, "Your onboarding pack is ready on the component page.", id);
      if (patch.ownerId !== undefined && c.ownerId && patch.ownerId !== c.ownerId) notify(d, c.ownerId, "assignment", `${c.name} was reassigned`, reason || "Ownership moved to another engineer.", id);
      if (patch.reviewerId && patch.reviewerId !== c.reviewerId) notify(d, patch.reviewerId, "review", `You are reviewer for ${c.name}`, `${c.id} · due ${c.due}`, id);
      if ((patch.due && patch.due !== c.due) || (patch.eta && patch.eta !== c.eta)) notify(d, c.ownerId, "deadline", `Plan changed for ${c.name}`, `Due ${patch.due || c.due} · ETA ${patch.eta || c.eta}`, id);
      Object.assign(c, patch); touch(c);
      });
      return true;
    },
    deleteComponent: async (id: string): Promise<boolean> => {
      if (apiEnabled()) {
        try {
          await deleteServerComponent(codeIndex.current.requireId(id));
          setState(prev => ({ ...prev, components: prev.components.filter(component => component.id !== id) }));
          try {
            await hydrateApi();
          } catch (error) {
            toast(`Component ${id} was deleted, but the latest backend data could not be reloaded: ${error instanceof Error ? error.message : "unknown error"}`, "warn");
          }
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            apiLogout();
            setState(prev => ({ ...prev, me: null }));
          }
          toast(error instanceof Error ? error.message : "Could not delete the component.", "crit");
          return false;
        }
      }
      mutate(d => {
      const c = comp(d, id);
      d.components = d.components.filter(x => x.id !== id);
      for (const x of d.components) x.deps = x.deps.filter(z => z !== id);
      d.blockers = d.blockers.filter(b => b.componentId !== id);
      d.handoffs = d.handoffs.filter(h => h.componentId !== id);
      for (const m of d.milestones) m.componentIds = m.componentIds.filter(z => z !== id);
      log(d, { entity: "component", entityId: id, action: `Deleted component ${id} ${c.name}` });
      });
      return true;
    },
    submitForReview: async (id: string): Promise<boolean> => {
      if (apiEnabled()) return runApiWrite(id, async () => {
        await requestComponentReview(codeIndex.current.requireId(id));
      });
      mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: "Submitted for review", field: "status", from: STATUS_LABEL[c.status], to: STATUS_LABEL.under_review });
      c.status = "under_review"; c.review = "in_review";
      if (c.gates.qa.state === "not_submitted" || c.gates.qa.state === "changes_requested") c.gates.qa = { state: "awaiting", at: nowIso() };
      notify(d, c.reviewerId, "review", `Review requested: ${c.name}`, `${pname(d, d.me)} submitted ${c.id} for review.`, id);
      notify(d, c.qaId, "review", `QA requested: ${c.name}`, "Ready for QA once required checks pass.", id);
      touch(c);
      });
      return true;
    },
    setReview: (id: string, review: Component["review"], note?: string) => {
      if (apiEnabled()) {
        toast("Code-review decisions are not supported by the backend yet. No changes were made.", "warn");
        return false;
      }
      mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: review === "accepted" ? "Code review accepted" : review === "changes_requested" ? "Code review: changes requested" : "Review started", reason: note });
      c.review = review;
      if (review === "changes_requested") { c.status = "in_progress"; notify(d, c.ownerId, "review", `Changes requested on ${c.name}`, note || "See the component page.", id); }
      if (review === "accepted") notify(d, c.ownerId, "review", `Review accepted: ${c.name}`, note || "", id);
      touch(c);
      });
      return true;
    },
    setQA: async (id: string, state: QAState, note?: string): Promise<boolean> => {
      if (apiEnabled()) {
        const decision = state === "accepted" ? "accepted" : state === "rejected" ? "rejected" : state === "changes_requested" ? "changes_requested" : null;
        if (!decision) {
          toast("The backend records QA decisions, not intermediate QA states. No changes were made.", "warn");
          return false;
        }
        return runApiWrite(id, async () => {
          await recordAcceptance(codeIndex.current.requireId(id), decision, note || "");
        });
      }
      mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: state === "accepted" ? "QA accepted" : state === "changes_requested" ? "QA changes requested" : state === "rejected" ? "QA rejected" : "QA started", field: "qa", from: c.gates.qa.state, to: state, reason: note });
      c.gates.qa = { state, by: d.me || undefined, at: nowIso(), note };
      if (state === "changes_requested" || state === "rejected") { c.status = "in_progress"; if (c.gates.deploy.state !== "deployed") c.gates.deploy = { state: "not_ready" }; }
      notify(d, c.ownerId, "review", state === "accepted" ? `QA accepted ${c.name}` : `QA update on ${c.name}`, note || state.replace(/_/g, " "), id);
      touch(c);
      });
      return true;
    },
    setDeploy: async (id: string, state: DeployState, note?: string): Promise<boolean> => {
      if (apiEnabled()) {
        if (state !== "ready" && state !== "not_ready" && state !== "deployed") {
          toast("The backend does not support this deployment transition yet. No changes were made.", "warn");
          return false;
        }
        return runApiWrite(id, async () => {
          const serverId = codeIndex.current.requireId(id);
          if (state === "deployed") {
            await patchComponent(serverId, { status: "deployed" });
          } else {
            await setComponentGate(serverId, "ready_for_deploy", state === "ready");
          }
          if (note?.trim()) toast("The deployment change was saved, but its note is not stored by the backend.", "warn");
        });
      }
      mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: state === "ready" ? "Approved for deployment" : state === "deployed" ? "Deployed" : `Deployment: ${state.replace(/_/g, " ")}`, field: "deploy", from: c.gates.deploy.state, to: state, reason: note });
      c.gates.deploy = { state, by: d.me || undefined, at: nowIso(), note };
      if (state === "deployed" && c.status !== "completed") { c.status = "completed"; log(d, { entity: "component", entityId: id, action: "Status changed", field: "status", from: "Under review", to: "Completed" }); }
      notify(d, c.ownerId, "review", state === "ready" ? `${c.name} approved for deployment` : `Deployment update: ${c.name}`, note || "", id);
      touch(c);
      });
      return true;
    },

    // ── acceptance criteria & evidence
    addCriterion: (id: string, k: Omit<Criterion, "id" | "status" | "evidence">) => mutate(d => {
      const c = comp(d, id);
      c.criteria.push({ ...k, id: `${id}-AC${c.criteria.length + 1}-${(n++).toString(36)}`, status: "not_started", evidence: [] });
      log(d, { entity: "component", entityId: id, action: "Acceptance criterion added", to: k.text }); touch(c);
    }),
    updateCriterion: (id: string, kid: string, patch: Partial<Criterion>) => mutate(d => {
      const k = comp(d, id).criteria.find(x => x.id === kid)!; Object.assign(k, patch);
      log(d, { entity: "component", entityId: id, action: "Acceptance criterion edited", to: k.text });
    }),
    removeCriterion: (id: string, kid: string) => mutate(d => {
      const c = comp(d, id); const k = c.criteria.find(x => x.id === kid)!;
      c.criteria = c.criteria.filter(x => x.id !== kid);
      log(d, { entity: "component", entityId: id, action: "Acceptance criterion removed", from: k.text });
    }),
    addEvidence: (id: string, kid: string, ev: Omit<Evidence, "id" | "by" | "at" | "version">) => mutate(d => {
      const c = comp(d, id); const k = c.criteria.find(x => x.id === kid)!;
      k.evidence.push({ ...ev, id: uid("ev"), by: d.me!, at: nowIso(), version: k.evidence.length + 1 });
      k.status = "submitted";
      log(d, { entity: "component", entityId: id, action: "Evidence submitted", to: `${kid.split("-").slice(0, 3).join("-")}: ${ev.label}` });
      notify(d, c.reviewerId, "review", `Evidence submitted on ${c.name}`, k.text, id);
      notify(d, c.qaId, "review", `Evidence submitted on ${c.name}`, k.text, id);
      touch(c);
    }),
    reviewEvidence: (id: string, kid: string, evid: string, decision: "approved" | "rejected" | "changes", note: string) => mutate(d => {
      const c = comp(d, id); const k = c.criteria.find(x => x.id === kid)!; const e = k.evidence.find(x => x.id === evid)!;
      Object.assign(e, { decision, note, reviewerId: d.me, reviewedAt: nowIso() });
      k.status = decision === "approved" ? "accepted" : decision === "rejected" ? "rejected" : "changes_requested";
      log(d, { entity: "component", entityId: id, action: decision === "approved" ? "Evidence approved" : decision === "rejected" ? "Evidence rejected" : "More evidence requested", to: k.text, reason: note });
      notify(d, e.by, "review", decision === "approved" ? "Evidence approved" : "Evidence needs changes", `${c.name}: ${k.text}`, id);
    }),

    // ── comments
    addComment: (id: string, body: string) => {
      if (apiEnabled()) return runApiWrite(id, async () => {
        await postComment(codeIndex.current.requireId(id), body);
      });
      mutate(d => {
      const c = comp(d, id);
      c.comments.push({ id: uid("cm"), by: d.me!, at: nowIso(), body });
      const who = pname(d, d.me);
      new Set([c.ownerId, c.reviewerId]).forEach(to => notify(d, to, "comment", `${who} commented on ${c.name}`, body.slice(0, 120), id));
      for (const p of d.people) if (body.toLowerCase().includes("@" + p.first.toLowerCase())) notify(d, p.id, "comment", `${who} mentioned you`, body.slice(0, 120), id);
      });
      return true;
    },
    editComment: (id: string, cid: string, body: string) => mutate(d => { const k = comp(d, id).comments.find(x => x.id === cid)!; k.body = body; k.edited = true; }),
    deleteComment: (id: string, cid: string) => mutate(d => { const c = comp(d, id); c.comments = c.comments.filter(x => x.id !== cid); }),

    // ── links & architecture
    addLink: async (id: string, l: Omit<ExtLink, "id">): Promise<boolean> => {
      if (apiEnabled()) {
        const current = state.components.find(component => component.id === id);
        if (!current) { toast(`Component ${id} is not loaded. Refresh and try again.`, "crit"); return false; }
        if (current.links.some(link => link.kind === l.kind)) {
          toast(`The backend supports one link per system. Remove the existing ${l.kind} link first.`, "warn");
          return false;
        }
        return runApiWrite(id, async () => {
          await patchComponent(codeIndex.current.requireId(id), {
            links: Object.fromEntries([...current.links, l].map(link => [link.kind, link.url])),
          });
        });
      }
      mutate(d => { comp(d, id).links.push({ ...l, id: uid("ln") }); log(d, { entity: "component", entityId: id, action: `Linked ${l.kind} record`, to: l.label }); });
      return true;
    },
    removeLink: async (id: string, lid: string): Promise<boolean> => {
      if (apiEnabled()) {
        const current = state.components.find(component => component.id === id);
        const link = current?.links.find(item => item.id === lid);
        if (!current || !link) { toast("That link is no longer available. Refresh and try again.", "crit"); return false; }
        return runApiWrite(id, async () => {
          await patchComponent(codeIndex.current.requireId(id), {
            links: Object.fromEntries(current.links.filter(item => item.id !== lid).map(item => [item.kind, item.url])),
          });
        });
      }
      mutate(d => { const c = comp(d, id); const l = c.links.find(x => x.id === lid)!; c.links = c.links.filter(x => x.id !== lid); log(d, { entity: "component", entityId: id, action: `Unlinked ${l.kind} record`, from: l.label }); });
      return true;
    },
    addArch: (id: string, f: Omit<ArchFile, "id" | "by" | "at" | "version">) => mutate(d => {
      const c = comp(d, id); const prev = c.architecture.filter(a => a.name === f.name).length;
      c.architecture.unshift({ ...f, id: uid("af"), by: d.me!, at: nowIso(), version: prev + 1 });
      log(d, { entity: "component", entityId: id, action: "Architecture file uploaded", to: f.name });
    }),
    removeArch: (id: string, aid: string) => mutate(d => { const c = comp(d, id); const a = c.architecture.find(x => x.id === aid)!; c.architecture = c.architecture.filter(x => x.id !== aid); log(d, { entity: "component", entityId: id, action: "Architecture file removed", from: a.name }); }),

    // ── blockers & handoffs
    addBlocker: async (b: Omit<Blocker, "id" | "createdAt" | "updatedAt" | "reportedBy" | "status">): Promise<boolean> => {
      if (apiEnabled()) {
        const saved = await runApiWrite(b.componentId, async () => {
          await addServerBlocker(codeIndex.current.requireId(b.componentId), {
            title: b.title, description: b.description, category: b.category,
            severity: b.severity, responsible_id: serverUserId(b.responsibleId),
            next_action: b.nextAction, target_date: b.target || null, slack: b.slack || null,
          });
        });
        if (saved) {
          try { await refreshApiBlockers(); }
          catch (error) { toast(`Blocker saved, but the blocker list could not be refreshed: ${error instanceof Error ? error.message : "unknown error"}`, "warn"); }
        }
        return saved;
      }
      mutate(d => {
        const num = Math.max(...d.blockers.map(x => parseInt(x.id.slice(4))), 0) + 1;
        const id = `BLK-${String(num).padStart(3, "0")}`;
        d.blockers.unshift({ ...b, id, status: "open", reportedBy: d.me!, createdAt: nowIso(), updatedAt: nowIso() });
        const c = comp(d, b.componentId);
        log(d, { entity: "component", entityId: b.componentId, action: `Blocker ${id} raised`, to: b.title });
        notify(d, b.responsibleId, "blocker", "Blocker assigned to you", `${id} ${b.title}`, b.componentId);
        notify(d, c.ownerId, "blocker", `New blocker on ${c.name}`, `${id} ${b.title}`, b.componentId);
      });
      return true;
    },
    updateBlocker: async (id: string, patch: Partial<Blocker>, note?: string): Promise<boolean> => {
      if (apiEnabled()) {
        if (patch.status !== "resolved" && patch.status !== "closed") {
          toast("The backend currently supports resolving blockers, but not reopening or editing them.", "warn");
          return false;
        }
        const blocker = state.blockers.find(item => item.id === id);
        if (!blocker) {
          toast(`Blocker ${id} is not loaded. Refresh and try again.`, "crit");
          return false;
        }
        const match = /^BLK-(\d+)$/.exec(id);
        if (!match) {
          toast(`Blocker ${id} has an invalid backend identifier.`, "crit");
          return false;
        }
        const saved = await runApiWrite(blocker.componentId, async () => {
          await resolveServerBlocker(Number(match[1]));
        });
        if (saved) {
          try { await refreshApiBlockers(); }
          catch (error) { toast(`Blocker resolved, but the blocker list could not be refreshed: ${error instanceof Error ? error.message : "unknown error"}`, "warn"); }
        }
        return saved;
      }
      mutate(d => {
      const b = d.blockers.find(x => x.id === id)!;
      if (patch.status && patch.status !== b.status) {
        log(d, { entity: "component", entityId: b.componentId, action: `Blocker ${id} ${patch.status === "resolved" ? "resolved" : patch.status === "escalated" ? "escalated" : "updated"}`, field: "blocker", from: b.status.replace(/_/g, " "), to: patch.status.replace(/_/g, " "), reason: note });
        if (patch.status === "resolved" || patch.status === "closed") patch.resolvedAt = nowIso();
        const c = comp(d, b.componentId);
        notify(d, c.ownerId, "blocker", `Blocker ${patch.status.replace(/_/g, " ")}`, `${id} ${b.title}`, b.componentId);
      }
      if (patch.responsibleId && patch.responsibleId !== b.responsibleId) notify(d, patch.responsibleId, "blocker", "Blocker assigned to you", `${id} ${b.title}`, b.componentId);
      if (patch.target && patch.target !== b.target) log(d, { entity: "component", entityId: b.componentId, action: `Blocker ${id} target changed`, from: b.target, to: patch.target });
      Object.assign(b, patch, { updatedAt: nowIso() });
      });
      return true;
    },
    startHandoff: (h: Omit<Handoff, "id" | "status" | "createdAt" | "by">) => mutate(d => {
      const num = Math.max(...d.handoffs.map(x => parseInt(x.id.slice(3))), 0) + 1;
      const id = `HO-${String(num).padStart(3, "0")}`;
      d.handoffs.unshift({ ...h, id, status: "awaiting_ack", createdAt: nowIso(), by: d.me! });
      const c = comp(d, h.componentId);
      log(d, { entity: "component", entityId: c.id, action: "Owner changed", field: "owner", from: h.fromId, to: h.toId, reason: `Handoff ${id}: ${h.reason}` });
      c.ownerId = h.toId; touch(c);
      notify(d, h.toId, "handoff", `Handoff to you: ${c.name}`, "Review the checklist and acknowledge it.", c.id);
      notify(d, h.fromId, "handoff", `Handoff started: ${c.name}`, `To ${pname(d, h.toId)}`, c.id);
    }),
    toggleHandoffItem: (id: string, item: string) => mutate(d => { const h = d.handoffs.find(x => x.id === id)!; const it = h.checklist.find(x => x.id === item)!; it.done = !it.done; }),
    ackHandoff: (id: string) => mutate(d => {
      const h = d.handoffs.find(x => x.id === id)!; h.status = "completed"; h.ackAt = nowIso();
      log(d, { entity: "component", entityId: h.componentId, action: `Handoff ${id} acknowledged`, by: d.me! });
      notify(d, h.fromId, "handoff", "Handoff acknowledged", `${pname(d, h.toId)} acknowledged ${id}`, h.componentId);
      notify(d, h.by, "handoff", "Handoff acknowledged", `${pname(d, h.toId)} acknowledged ${id}`, h.componentId);
    }),

    // ── best practices
    savePractice: (p: Practice, isNew: boolean) => mutate(d => {
      const now = nowIso();
      if (isNew) { d.practices.push({ ...p, updatedAt: now, updatedBy: d.me!, reviewedAt: now }); log(d, { entity: "practice", entityId: p.id, action: "Page created", to: p.title }); return; }
      const i = d.practices.findIndex(x => x.id === p.id);
      if (d.practices[i].ownerId !== p.ownerId) notify(d, p.ownerId, "review", `You now own “${p.title}”`, "Keep it current; you'll be reminded before each review date.");
      d.practices[i] = { ...p, updatedAt: now, updatedBy: d.me! };
      log(d, { entity: "practice", entityId: p.id, action: "Page updated", to: p.title });
    }),
    reviewPractice: (id: string) => mutate(d => {
      const p = d.practices.find(x => x.id === id)!; p.reviewedAt = nowIso(); p.nextReview = addDays(iso(today()), 90);
      if (p.override === "under_revision") p.override = null;
      log(d, { entity: "practice", entityId: id, action: "Page reviewed", to: p.title });
    }),
    setPracticeOverride: (id: string, o: Practice["override"]) => mutate(d => { const p = d.practices.find(x => x.id === id)!; p.override = o; log(d, { entity: "practice", entityId: id, action: o === "archived" ? "Page archived" : o === "under_revision" ? "Marked under revision" : "Restored", to: p.title }); }),

    // ── plan, milestones, about, contacts
    savePlanNotes: (notes: string) => mutate(d => { d.plan = { notes, updatedAt: nowIso(), updatedBy: d.me! }; log(d, { entity: "plan", entityId: "plan", action: "Development plan notes updated" }); }),
    saveMilestone: (m: Milestone) => mutate(d => {
      const i = d.milestones.findIndex(x => x.id === m.id);
      if (i >= 0) { const before = d.milestones[i]; if (before.date !== m.date) log(d, { entity: "plan", entityId: m.id, action: `Milestone “${m.name}” moved`, from: before.date, to: m.date }); d.milestones[i] = m; }
      else { d.milestones.push(m); log(d, { entity: "plan", entityId: m.id, action: `Milestone “${m.name}” added`, to: m.date }); }
      d.milestones.sort((a, b) => a.date.localeCompare(b.date));
    }),
    deleteMilestone: (id: string) => mutate(d => { const m = d.milestones.find(x => x.id === id)!; d.milestones = d.milestones.filter(x => x.id !== id); log(d, { entity: "plan", entityId: id, action: `Milestone “${m.name}” removed` }); }),
    saveAbout: (vision: string, overview: string) => mutate(d => { d.about = { vision, overview, updatedAt: nowIso(), updatedBy: d.me! }; log(d, { entity: "about", entityId: "about", action: "Vision page updated" }); }),
    saveContact: (c: Contact) => mutate(d => { const i = d.contacts.findIndex(x => x.id === c.id); if (i >= 0) d.contacts[i] = c; else d.contacts.push(c); }),
    deleteContact: (id: string) => mutate(d => { d.contacts = d.contacts.filter(x => x.id !== id); }),
    updateRepo: (id: string, patch: Partial<AppState["repos"][number]>) => mutate(d => { const r = d.repos.find(x => x.id === id)!; Object.assign(r, patch); log(d, { entity: "repo", entityId: id, action: "Repository details updated", to: r.name }); }),

    // ── dependency cycle decisions (recorded, never applied to deps)
    setCycleDecision: (key: string, patch: Partial<import("./types").CycleDecision>, label: string) => mutate(d => {
      d.cycleDecisions = d.cycleDecisions || {};
      const prev = d.cycleDecisions[key] || { key, status: "undecided" as const };
      const next = { ...prev, ...patch, key, at: nowIso(), by: d.me || "system" };
      d.cycleDecisions[key] = next;
      log(d, { entity: "plan", entityId: "cycle:" + key, action: `Dependency loop: ${label}`, from: prev.status, to: next.status, reason: patch.note });
      if (patch.ownerId && patch.ownerId !== prev.ownerId) notify(d, patch.ownerId, "review", "A dependency loop needs your decision", label);
    }),

    // ── graph
    setPos: (id: string, x: number, y: number) => mutate(d => { d.graphPos[id] = { x, y }; }),
    resetPos: () => mutate(d => { d.graphPos = {}; }),
    addDep: async (from: string, to: string): Promise<boolean> => {
      if (apiEnabled()) return runApiWrite(from, async () => {
        await postDependency(codeIndex.current.requireId(from), codeIndex.current.requireId(to));
      }, true);
      mutate(d => { const c = comp(d, from); if (!c.deps.includes(to)) { log(d, { entity: "component", entityId: from, action: "Dependency added", to: `${to} ${comp(d, to).name}` }); c.deps.push(to); touch(c); } });
      return true;
    },
    removeDep: async (from: string, to: string): Promise<boolean> => {
      if (apiEnabled()) return runApiWrite(from, async () => {
        const edgeId = edgeIndex.current.get(`${codeIndex.current.requireId(from)}:${codeIndex.current.requireId(to)}`);
        if (edgeId === undefined) throw new ApiError(404, `Dependency edge ${from} → ${to} was not found.`);
        await deleteServerDependency(edgeId);
      }, true);
      mutate(d => { const c = comp(d, from); c.deps = c.deps.filter(x => x !== to); log(d, { entity: "component", entityId: from, action: "Dependency removed", from: `${to} ${comp(d, to).name}` }); touch(c); });
      return true;
    },

    // ── notifications
    markRead: (id: string) => mutate(d => { const x = d.notices.find(n => n.id === id); if (x) x.read = true; }),
    markAllRead: () => mutate(d => { for (const x of d.notices) if (x.to === d.me) x.read = true; }),

    resetDemo: () => { const me = state.me; const fresh = seedState(); fresh.me = me && fresh.people.some(p => p.id === me) ? me : null; setState(fresh); },
  };

  const me = state.people.find(p => p.id === state.me) || null;
  const isAdmin = me?.role === "admin";
  const person = (id?: string | null) => state.people.find(p => p.id === id) || null;
  const component = (id?: string | null) => state.components.find(c => c.id === id) || null;
  return { state, me, isAdmin, person, component, saveError, apiMode: apiEnabled(), authLoading, authError, authenticate, loadComponentDetail, ...actions };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const v = useProvideStore();
  return <StoreCtx.Provider value={v}>{children}</StoreCtx.Provider>;
}

// ───────────── routing (plain #name hashes only) ─────────────
export interface CompFilter { quick: string; project: string; priority: string; status: string; owner: string; stage: string; category: string; q: string; sp: string; wave: string; }
export const EMPTY_FILTER: CompFilter = { quick: "all", project: "", priority: "", status: "", owner: "", stage: "", category: "", q: "", sp: "", wave: "" };
const NavCtx = createContext<{ route: string; go: (r: string) => void; filter: CompFilter; setFilter: (f: CompFilter) => void; openComponents: (f: Partial<CompFilter>) => void }>(null as any);
export const useNav = () => useContext(NavCtx);
const readHash = () => (location.hash || "").replace(/^#/, "") || "home";
const toTop = () => {
  window.scrollTo(0, 0);
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  document.body.scrollTop = 0;
};

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState(readHash);
  const [filter, setFilter] = useState<CompFilter>(EMPTY_FILTER);
  useEffect(() => {
    // Which element actually scrolls depends on the overflow rules in play, so
    // reset all three rather than assume. Landing part-way down a page you have
    // not seen reads as a broken link.
    const on = () => { setRoute(readHash()); toTop(); };
    window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: string) => { if (readHash() === r) { setRoute(r); toTop(); } else location.hash = r; }, []);
  const openComponents = useCallback((f: Partial<CompFilter>) => { setFilter({ ...EMPTY_FILTER, ...f }); go("library"); }, [go]);
  const v = useMemo(() => ({ route, go, filter, setFilter, openComponents }), [route, go, filter, openComponents]);
  return <NavCtx.Provider value={v}>{children}</NavCtx.Provider>;
}
