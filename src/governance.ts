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
  "Placeholder content is prohibited. No placeholder text, lorem ipsum, TODO stub, invented sample data or mocked response shall be delivered as working behaviour. Unfinished work shall be identified as unfinished.",
  "Unverified references are prohibited. No API, function, package, version, configuration key, file or document shall be used unless its existence has been confirmed in this repository or its lockfile.",
  "Unnecessary code is prohibited. Comments that restate the code, dead code, unused parameters, speculative features and superfluous wrapper layers shall not be introduced.",
  "Failures shall not be concealed. Errors shall not be caught and ignored, failure shall not be reported as success, and no failing test, lint or type check shall be silenced to produce a passing result.",
  "Tests shall be meaningful. Each test shall fail when the behaviour it covers is broken. Always-true assertions, tests that mock only the subject under test, and tests deleted, skipped or weakened to obtain a pass are prohibited.",
  "Claims shall be evidenced. A statement that work is complete, working, fixed or production-ready shall be accompanied, in the same report, by the command and result that substantiate it.",
  "Output shall be specific. Copy, interface text, documentation and commit messages shall be specific to the component. Content that could be reused unchanged on another component is not acceptable.",
  "Changes shall be confined. Only what the component requires shall be modified. Unrelated code shall not be reformatted, renamed, restructured or modernised, and every change shall remain reviewable.",
  "Existing logic shall be reused. Logic that already exists in the codebase shall be reused and not reimplemented.",
  "Dependencies shall be vetted. A package shall be added only where unavoidable, and only after its existence, maintenance status and necessity have been confirmed.",
  "Gaps shall be raised, not guessed. Where a requirement is missing or ambiguous, work shall pause for clarification, or the assumption shall be recorded in the report. A plausible guess shall not fill the gap.",
  "Every change shall be understood. The owner shall have read and understood each AI-written change, and shall be able to explain it, before review is requested.",
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
  { key: "ai_baseline", label: "Component AI baseline", required: false, hint: "What a builder must know about this component first: files to read, commands to run, conventions. Added to the template baseline.", boilerplate: "Prior to implementation\n- Read this specification in full, followed by the existing code, tests and documentation for this component and the components on which it depends. Do not rely on recollection or on assumptions about the code.\n- Identify the existing modules, helpers and patterns that will be reused, and prefer them to new constructs.\n- Record all assumptions and open questions. Seek clarification before guessing: a recorded assumption is acceptable; an unstated assumption is not.\n\nDuring implementation\n- Remain within the scope of this component. Where a file outside that scope must change, state which file and why before changing it.\n- Conform to the structure, naming, error handling and test style of the project.\n- Add a dependency only where unavoidable, and only after confirming that the package and version exist.\n\nPrior to declaring the work complete\n- Run the build, tests, lint and type checks that apply, and report each command together with its result.\n- Mark every acceptance criterion as met, not met or unknown, and supply the evidence for each.\n- Update the documentation affected by the change.\n- Report what was not done, what could not be verified and what was assumed." },
  { key: "slop_defender", label: "Component AI slop defender", required: false, hint: "Slop specific to THIS component, one item per line, such as invented fields for this API or fictitious rows on this screen. Added to the template defender.", boilerplate: "Before returning any work, review your own output against the conditions below. If any condition applies, the output shall be rejected and corrected.\n- It contains placeholder or sample content (lorem ipsum, TODO, example.com, hard-coded fictitious records, stubbed functions) that the report does not identify as unfinished.\n- It refers to a function, endpoint, package, configuration key, file or document whose existence has not been confirmed.\n- A test would still pass if the feature were broken, or a test was removed, skipped or weakened to obtain a pass.\n- An error is caught and ignored, or a failure path returns success.\n- A comment, name or message merely restates the code, or could be reused unchanged on another component.\n- The change touches code unrelated to this component, or reformats code that did not require it.\n- The report states that the work is working, complete or production-ready without naming the command or evidence that supports it.\nAny slop listed below for this specific component is likewise a blocker. The report shall state each defence applied and each defence that could not be applied." },
  { key: "ai_instructions", label: "Component-specific AI instructions", required: false, hint: "Extra guidance for an AI builder. It cannot override the Constitution or permissions." },
];
/** The ten sections no template may drop. The baseline and slop defender are template sections, not core ones. */
export const CORE_SECTION_KEYS = ["purpose", "functional_requirements", "technical_architecture", "api_contracts", "dependencies", "guardrails", "acceptance_criteria", "testing_requirements", "documentation_refs", "ai_instructions"];
