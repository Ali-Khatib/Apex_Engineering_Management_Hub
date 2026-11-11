/**
 * Client for the Apex HQ governance and people APIs: users, the Engineering
 * Constitution, component templates, specs, AI Build Contracts and compliance
 * reviews. Every call needs a configured backend (VITE_API_URL); in demo mode
 * the pages that use these show read-only demo copies instead.
 */
import { api, ApiError } from "./api";

export interface HqUser {
  id: number; first_name: string; last_name: string; email: string; role: "admin" | "member";
  designation: string; department: string; github_id: string; website_url: string;
  is_active: boolean; created_at: string | null; updated_at: string | null; onboarding_notes: string;
  /** Present only when the signed-in person is an admin or this is their own record. */
  phone?: string; linkedin_url?: string; vpn_id?: string;
}
export interface NewHqUser {
  first_name: string; last_name: string; designation: string; department: string; email: string; phone: string;
  linkedin_url: string; vpn_id: string; github_id: string; website_url: string; role: "admin" | "member"; password: string;
}
export type HqUserPatch = Partial<Omit<NewHqUser, "password">>;

export interface ConstitutionRule { id: string; text: string; group?: "core" | "ai_slop" }
export interface Constitution {
  version: number; rules: ConstitutionRule[]; note: string;
  history: { version: number; note: string; created_at: string; rules: number }[];
}
export interface TemplateSection { key: string; label: string; required: boolean; hint: string; boilerplate?: string }
export interface Template {
  id: number; name: string; description: string; is_default: boolean; is_active: boolean; version: number;
  sections: TemplateSection[]; versions?: { version: number; note: string; created_at: string }[];
}
export interface SpecSection extends TemplateSection {
  storage: "derived" | "component" | "spec"; admin_only: boolean; content?: string;
  items?: { code: string; name: string; status: string }[];
}
export interface Spec {
  component: { id: number; code: string; name: string };
  template: { id: number; name: string; version: number; latest_version: number };
  sections: SpecSection[]; dependents: { code: string; name: string; status: string }[];
  missing_required: string[]; updated_at: string | null;
}
export interface Contract {
  schema: string;
  trusted: { constitution: { version: number; rules: ConstitutionRule[] }; platform_policy: string[]; template_baseline: { key: string; label: string; text: string }[] };
  untrusted: { component: { code: string; name: string }; acceptance_criteria: string[] };
  template: { id: number | null; name: string | null; version: number | null };
  warnings: { section: string; message: string }[]; missing_required_sections: string[];
  complete: boolean; content_hash: string; context_errors: string[]; prompt?: string;
}
export type CheckStatus = "passed" | "failed" | "needs_review";
export type Verdict = "met" | "not_met" | "unknown";
export interface ReviewCheck { id: string; label: string; status: CheckStatus; detail: string }
export interface ReviewCriterion { text: string; verdict: Verdict; note: string }
export interface Review {
  id: number; component_id: number; status: "advisory" | "approved" | "rejected"; contract_hash: string;
  constitution_version: number; checks: ReviewCheck[]; criteria: ReviewCriterion[]; created_at: string;
  decided_at: string | null; decision_note: string; advisory: boolean; current?: boolean;
}

export interface Problems { message: string; fields: Record<string, string>; list: string[] }

/** Field-level messages from a 422, or the plain message for anything else. */
export function apiProblems(e: unknown): Problems {
  if (!(e instanceof ApiError)) return { message: e instanceof Error ? e.message : "Something went wrong", fields: {}, list: [] };
  try {
    const d = JSON.parse(e.message);
    if (d && typeof d === "object") {
      const list: string[] = [...(d.errors || []), ...(d.reasons || [])];
      return { message: d.message || list[0] || e.message, fields: d.fields || {}, list };
    }
  } catch { /* plain text */ }
  return { message: e.message, fields: {}, list: [] };
}

/* people */
export const hqUsers = (includeInactive = false) => api<HqUser[]>(`/users${includeInactive ? "?include_inactive=true" : ""}`);
export const hqUser = (id: number) => api<HqUser>(`/users/${id}`);
export const createHqUser = (b: NewHqUser) => api<HqUser>("/users", { method: "POST", body: b });
export const updateHqUser = (id: number, b: HqUserPatch & { role?: "admin" | "member" }) => api<HqUser>(`/users/${id}`, { method: "PATCH", body: b });
export const updateMyContact = (b: Partial<Pick<NewHqUser, "phone" | "linkedin_url" | "github_id" | "website_url">>) => api<HqUser>("/me", { method: "PATCH", body: b });
export const deactivateHqUser = (id: number) => api<HqUser>(`/users/${id}/deactivate`, { method: "POST" });
export const reactivateHqUser = (id: number) => api<HqUser>(`/users/${id}/reactivate`, { method: "POST" });

/* constitution and templates */
export const getConstitution = () => api<Constitution>("/constitution");
export const getConstitutionVersion = (v: number) => api<{ version: number; rules: ConstitutionRule[]; note: string }>(`/constitution/${v}`);
export const publishConstitution = (rules: { id?: string; text: string; group?: "core" | "ai_slop" }[], note: string) =>
  api<Constitution>("/constitution", { method: "PUT", body: { rules, note } });
export const listTemplates = () => api<Template[]>("/templates");
export const getTemplate = (id: number) => api<Template>(`/templates/${id}`);
export const createTemplate = (b: { name: string; description: string; sections: TemplateSection[]; is_default?: boolean }) =>
  api<Template>("/templates", { method: "POST", body: b });
export const updateTemplate = (id: number, b: { sections?: TemplateSection[]; description?: string; note?: string; is_default?: boolean; is_active?: boolean }) =>
  api<Template>(`/templates/${id}`, { method: "PATCH", body: b });

/* components: the API uses numeric ids, the app uses codes */
let codeToId: Map<string, number> | null = null;
export async function componentApiId(code: string): Promise<number> {
  if (!codeToId || !codeToId.has(code)) {
    const all = await api<{ id: number; code: string }[]>("/components");
    codeToId = new Map(all.map(c => [c.code, c.id]));
  }
  const id = codeToId.get(code);
  if (id === undefined) throw new ApiError(404, `No component with code ${code}`);
  return id;
}
export const getSpec = (cid: number) => api<Spec>(`/components/${cid}/spec`);
export const saveSpec = (cid: number, sections: Record<string, string>) => api<Spec>(`/components/${cid}/spec`, { method: "PUT", body: { sections } });
export const getContract = (cid: number) => api<Contract>(`/components/${cid}/build-contract?format=prompt`);
export const listReviews = (cid: number) => api<Review[]>(`/components/${cid}/compliance-reviews`);
export const runReview = (cid: number) => api<Review>(`/components/${cid}/compliance-reviews`, { method: "POST" });
export const setVerdicts = (rid: number, verdicts: { index: number; verdict: Verdict; note?: string }[]) =>
  api<Review>(`/compliance-reviews/${rid}/criteria`, { method: "PATCH", body: { verdicts } });
export const decideReview = (rid: number, decision: "approve" | "reject", note: string) =>
  api<Review>(`/compliance-reviews/${rid}/decision`, { method: "POST", body: { decision, note } });

/** Demo copies, shown read-only when no backend is configured. The backend is the source of truth. */
export const DEMO_CONSTITUTION: ConstitutionRule[] = [
  "Never fabricate requirements, APIs, dependencies or implementation details.",
  "Never represent placeholder code or mocked functionality as production-ready.",
  "Inspect existing architecture before proposing or implementing changes.",
  "Follow established project conventions and existing patterns.",
  "Avoid unnecessary abstractions, dependencies and architectural complexity.",
  "Enforce authentication, authorization and data protection.",
  "Never hardcode credentials or expose secrets.",
  "Write meaningful tests for actual behavior.",
  "Never silently remove existing functionality or dependencies.",
  "Keep implementation within the approved component scope.",
  "Update documentation when implementation changes.",
  "Verify builds, tests and relevant integration workflows.",
  "Explicitly report incomplete work, assumptions and unresolved issues.",
  "Never claim a feature is implemented or verified unless evidence supports that claim.",
].map((text, i) => ({ id: `R${String(i + 1).padStart(2, "0")}`, text }));

/** Demo copy of the company-wide AI slop blockers. The server holds the real list. */
const DEMO_SLOP: string[] = [
  "No filler. Never ship placeholder text, lorem ipsum, TODO stubs, invented sample data or mocked responses as real behaviour. Anything unfinished is labelled unfinished.",
  "No invented references. Never use an API, function, package, version, config key, file or document you have not confirmed exists in this repository or its lockfile.",
  "No decorative code. No comments that restate the code, dead code, unused parameters, speculative features or wrapper layers the component does not need.",
  "No swallowed failures. Never catch and ignore an error, return fake success, or silence a failing test, lint or type check to make output look green.",
  "No theatre tests. A test must fail when the behaviour it covers breaks. No always-true assertions, no tests that only mock the thing under test, and no tests deleted, skipped or loosened to get a pass.",
  "No unverifiable claims. Words such as works, complete, fixed or production-ready need the command and result that prove them in the same report.",
  "No generic output. Copy, UI text, documentation and commit messages must be specific to this component. Nothing that could be pasted unchanged into another component.",
  "No unrequested rewrites. Change only what the component needs. Do not reformat, rename, restructure or modernise unrelated code, and keep the diff reviewable.",
  "No duplicated logic. Reuse the module that already exists instead of writing a second copy of it.",
  "No unvetted dependencies. Add a package only when unavoidable, after confirming it exists, is maintained and is needed.",
  "No silent guessing. When a requirement is missing or ambiguous, stop and ask, or record the assumption in the report. Never fill the gap with a plausible guess.",
  "No unread output. The owner must have read and understood every AI-written change, and be able to explain it, before review is requested.",
];
DEMO_CONSTITUTION.push(...DEMO_SLOP.map((text, i) => ({ id: `R${String(DEMO_CONSTITUTION.length + i + 1).padStart(2, "0")}`, text, group: "ai_slop" as const })));

export const DEMO_TEMPLATE_SECTIONS: TemplateSection[] = [
  { key: "purpose", label: "Description and purpose", required: true, hint: "What the component is for and who uses it." },
  { key: "functional_requirements", label: "Functional requirements", required: true, hint: "What it must do, one requirement per line." },
  { key: "technical_architecture", label: "Technical architecture", required: true, hint: "How it is built: modules, data flow, boundaries." },
  { key: "api_contracts", label: "API specifications and contracts", required: true, hint: "Inputs, outputs and error behaviour of each interface." },
  { key: "dependencies", label: "Dependencies and relationships", required: false, hint: "Derived from the dependency graph." },
  { key: "guardrails", label: "Guardrails and technical constraints", required: true, hint: "What must never happen: security, data, scope limits." },
  { key: "acceptance_criteria", label: "Acceptance criteria", required: true, hint: "One verifiable criterion per line." },
  { key: "testing_requirements", label: "Testing requirements", required: true, hint: "What tests must exist and what they must prove." },
  { key: "documentation_refs", label: "Documentation and implementation references", required: false, hint: "Docs, repositories and pull requests." },
  { key: "ai_baseline", label: "Component AI baseline", required: false, hint: "What a builder must know about this component first: files to read, commands to run, conventions. Added to the template baseline.", boilerplate: "Before writing code\n- Read this specification in full, then the existing code, tests and documentation for this component and the components it depends on. Do not work from memory or from a guess about what the code probably looks like.\n- List what already exists that you will reuse. Prefer the existing module, helper or pattern over a new one.\n- Write down your assumptions and open questions. Ask before guessing. A recorded assumption is acceptable; a silent one is not.\n\nWhile building\n- Stay inside this component's scope. If a file outside it must change, say which and why before changing it.\n- Match the project's structure, naming, error handling and test style.\n- Add a dependency only when unavoidable, and only after confirming the package and version exist.\n\nBefore you say it is done\n- Run the build, tests, lint and type checks that apply, and report the commands with their results.\n- Mark every acceptance criterion met, not met or unknown, with the evidence for each.\n- Update the documentation this change affects.\n- Report what you did not do, what you could not verify and what you assumed." },
  { key: "slop_defender", label: "Component AI slop defender", required: false, hint: "Slop likely on THIS component, one per line, such as invented fields for this API or fake rows on this screen. Added to the template defender.", boilerplate: "Before you hand work back, check your own output. Reject it and fix it if any of these is true:\n- It contains placeholder or sample content (lorem ipsum, TODO, example.com, hard-coded fake records, stubbed functions) that your report does not call out as unfinished.\n- It names a function, endpoint, package, config key, file or document you did not confirm exists.\n- A test would still pass if the feature were broken, or a test was removed, skipped or loosened to get a pass.\n- An error is caught and ignored, or a failure path returns success.\n- A comment, name or message only restates the code, or could be pasted unchanged into another component.\n- The diff touches code unrelated to this component, or reformats code you had no need to change.\n- Your report says works, complete or production-ready without naming the command or evidence behind it.\nAny component-specific slop listed under this component is a blocker too. Report each defence you applied and each one you could not." },
  { key: "ai_instructions", label: "Component-specific AI instructions", required: false, hint: "Extra guidance for an AI builder. It cannot override the Constitution or permissions." },
];
/** The ten sections no template may drop. The baseline and slop defender are template sections, not core ones. */
export const CORE_SECTION_KEYS = ["purpose", "functional_requirements", "technical_architecture", "api_contracts", "dependencies", "guardrails", "acceptance_criteria", "testing_requirements", "documentation_refs", "ai_instructions"];
