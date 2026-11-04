import React from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { cx } from "../ui";
import { practiceStatus } from "../logic";

/**
 * The Knowledge Center.
 *
 * §14 asks for a place that teaches a new engineer how Apex builds software.
 * Most of that is content Apex has to write: its own standards, its own
 * architecture, its own policies. Inventing them would put fabricated company
 * policy in front of engineers, which the brief forbids and which would be
 * worse than an empty page.
 *
 * So this is the structure, wired to what genuinely exists (the best-practice
 * pages, the module register, the component library, the glossary the platform
 * already enforces), with every gap named and attributable. Nothing is
 * generated to fill a section.
 */

type Area = {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  items: { label: string; state: "live" | "partial" | "missing"; detail: string; to?: string }[];
};

export function Knowledge() {
  const { state } = useStore();
  const { go } = useNav();

  const practices = state.practices.filter(p => p.override !== "archived");
  const current = practices.filter(p => practiceStatus(p).key === "current").length;
  const stale = practices.length - current;

  const AREAS: Area[] = [
    {
      id: "start", title: "Getting started", icon: "play",
      blurb: "What a new engineer needs in their first week.",
      items: [
        { label: "What a component, module and round are", state: "live", detail: "Defined on the Overview and enforced in every screen's wording.", to: "home" },
        { label: "How assignment works", state: "live", detail: "Explained on My work, including what an empty account means.", to: "mywork" },
        { label: "How to find your work", state: "live", detail: "My work lists everything you own with its next action.", to: "mywork" },
        { label: "How to raise a blocker", state: "live", detail: "Blockers page, with the fields a blocker has to answer.", to: "blockers" },
        { label: "How to submit work for review", state: "partial", detail: "The mechanism exists on each component's Readiness tab. The written walkthrough does not." },
        { label: "Repository access and local setup", state: "missing", detail: "Apex has to write this. It depends on internal access processes this platform cannot see." },
      ],
    },
    {
      id: "build", title: "How we build", icon: "graph",
      blurb: "The route a component takes from proposal to deployment.",
      items: [
        { label: "Planning and rounds", state: "live", detail: "Roadmap shows planning wave and lifecycle as separate axes.", to: "roadmap" },
        { label: "Dependency decisions", state: "live", detail: "Build order lists every loop with its options and decision owner.", to: "map" },
        { label: "The three approvals", state: "live", detail: "Checks, QA acceptance and deployment approval, kept independent.", to: "qa" },
        { label: "Code review conventions", state: "partial", detail: "A best-practice page exists. It has not been reviewed against current practice." },
        { label: "Architecture decision process", state: "missing", detail: "Referenced throughout the component map as the gate before assignment, but the process itself is not written down." },
      ],
    },
    {
      id: "standards", title: "Development standards", icon: "practices",
      blurb: `${practices.length} pages, each with an owner and a review date.`,
      items: [
        { label: `${current} current`, state: "live", detail: "Reviewed within their review window.", to: "practices" },
        { label: `${stale} need review or are outdated`, state: stale ? "partial" : "live", detail: "Shown with their status on the Best practices page.", to: "practices" },
        { label: "Python, databases, logging, error handling", state: "missing", detail: "No page exists for these. They are listed in the brief as required standards." },
      ],
    },
    {
      id: "arch", title: "Architecture", icon: "layers",
      blurb: "How the platform fits together.",
      items: [
        { label: "Platform modules SP-01 to SP-20", state: "live", detail: "Register with the components that build on each one.", to: "modules" },
        { label: "Per-component architecture", state: "live", detail: "Each component maps its modules, prerequisites and consumers.", to: "library" },
        { label: "Module interfaces and APIs", state: "missing", detail: "No module record carries an interface. Each module page lists exactly which fields are undocumented." },
        { label: "Data flows and infrastructure", state: "missing", detail: "Not recorded anywhere in the component map." },
      ],
    },
    {
      id: "glossary", title: "Glossary", icon: "about",
      blurb: "One definition per term, used consistently across the platform.",
      items: [
        { label: "Component, platform module, round", state: "live", detail: "Defined on the Overview." },
        { label: "Lifecycle and planning wave", state: "live", detail: "Both defined on the Roadmap, with the distinction between them.", to: "roadmap" },
        { label: "Readiness gates, evidence, acceptance criteria", state: "live", detail: "Defined on the QA reviews page.", to: "qa" },
        { label: "Blocker, handoff, dependency", state: "live", detail: "Defined where each one is used." },
      ],
    },
  ];

  const counts = AREAS.flatMap(a => a.items).reduce((n, i) => ({ ...n, [i.state]: (n as any)[i.state] + 1 }), { live: 0, partial: 0, missing: 0 } as Record<string, number>);

  return (
    <>
      <header className="ph">
        <h1>Engineering knowledge</h1>
        <p className="lede">How Apex builds software, and where that is written down. {counts.live} topics are covered by the platform itself, {counts.partial} partly, and {counts.missing} still have to be written by Apex. Nothing on this page is generated.</p>
      </header>

      <div className="kn-legend">
        <span><i className="s-live" />Covered in the platform</span>
        <span><i className="s-partial" />Partly covered</span>
        <span><i className="s-missing" />Needs writing by Apex</span>
      </div>

      <div className="kn-grid">
        {AREAS.map(a => (
          <section key={a.id} className="kn-area">
            <header>
              <span className="kn-ic"><Icon name={a.icon} size={15} /></span>
              <div><h2>{a.title}</h2><p>{a.blurb}</p></div>
            </header>
            <ul>
              {a.items.map(i => (
                <li key={i.label} className={cx("s-" + i.state, i.to && "is-link")} onClick={i.to ? () => go(i.to!) : undefined}>
                  <i aria-hidden />
                  <span>
                    <b>{i.label}{i.to && <Icon name="arrowRight" size={12} />}</b>
                    <small>{i.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="kn-foot">
        <Icon name="alert" size={14} />
        <span>Sections marked as needing writing are deliberately empty. Apex's standards, architecture and access processes are not in the component map, and writing plausible versions of them would put invented company policy in front of engineers. Add a page under Best practices and it will appear here.</span>
      </p>
    </>
  );
}
