import React, { useState } from "react";
import { Icon } from "../icons";

// The first thing anyone sees. Three sentences that make every other screen
// readable: what a component is, what a module is, what a round is. Dismissible,
// because it stops being useful on about the fourth visit — and reachable again
// from About & contacts.
const KEY = "apex-primer-dismissed";

export function Primer() {
  const [gone, setGone] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  if (gone) return null;
  const dismiss = () => { setGone(true); try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } };
  return (
    <section className="primer" aria-label="What this platform tracks">
      <div className="primer-head">
        <Icon name="info" size={16} />
        <h2>What you are looking at</h2>
        <button className="primer-x" onClick={dismiss} aria-label="Hide this explanation"><Icon name="x" size={14} /></button>
      </div>
      {/* Three definitions, not three steps. They were numbered 1-2-3, which
          told the reader to expect an order that does not exist. A definition
          list says what they actually are. */}
      <dl className="primer-defs">
        <div>
          <dt>A component</dt>
          <dd>
            One unit of engineering work: an audit trail, a connector, a schema registry.
            One person owns it, one person reviews it. There are <b>127</b> of them, and everything on this site hangs off that one idea.
          </dd>
        </div>
        <div>
          <dt>A platform module</dt>
          <dd>
            Something Apex has already built and can reuse, numbered <b>SP-01 to SP-20</b>. Most components
            extend a module rather than starting from nothing, which is why you keep seeing SP numbers.
          </dd>
        </div>
        <div>
          <dt>A round</dt>
          <dd>
            The set of components chosen to be built next. Only those have owners and dates.
            The rest are specified and waiting.
          </dd>
        </div>
      </dl>
      <p className="primer-gates">
        A component ships only after <b>three separate approvals</b>: automated checks pass, then QA accepts the
        exact build, then someone approves deployment. Passing the checks never means QA has accepted it.
      </p>
    </section>
  );
}
