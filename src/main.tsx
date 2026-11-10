import "./styles.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, ToastProvider, NavProvider, useStore, useNav } from "./store";
import { Intro, SignIn, Rail, Topbar, Palette } from "./shell";
import { Toasts, cx } from "./ui";
import { ThemeProvider } from "./theme";
import { Home } from "./pages/home";
import { Modules, ModulePage } from "./pages/modules";
import { Components } from "./pages/components";
import { ComponentPage } from "./pages/component";
import { Roadmap } from "./pages/roadmap";
import { Graph } from "./pages/graph";
import { Blockers } from "./pages/blockers";
import { Practices, PracticePage } from "./pages/practices";
import { About } from "./pages/about";
import { Team } from "./pages/team";
import { MyWork } from "./pages/mywork";
import { Repos } from "./pages/repos";
import { Settings } from "./pages/settings";
import { QA } from "./pages/qa";
import { Knowledge } from "./pages/knowledge";
import { Architecture } from "./pages/architecture";
import { Constitution, Templates } from "./pages/hq";

class Boundary extends React.Component<{ children: React.ReactNode; resetKey: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidUpdate(p: any) { if (p.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err) return <div className="empty"><strong>This page couldn't be displayed</strong><p>Other pages still work.</p><a className="btn btn-secondary btn-md" href="#home">Go to overview</a></div>;
    return this.props.children;
  }
}

function Route() {
  const { route } = useNav();
  if (route.startsWith("c-")) return <ComponentPage key={route} id={route.slice(2)} />;
  if (route.startsWith("m-")) return <ModulePage key={route} id={route.slice(2)} />;
  if (route.startsWith("p-")) return <PracticePage key={route} id={route.slice(2)} />;
  switch (route) {
    case "modules": case "architecture": return <Architecture />;
    case "library": case "components": return <Components />;
    case "roadmap": case "plan": return <Roadmap />;
    case "map": case "graph": return <Graph />;
    case "blockers": return <Blockers />;
    case "mywork": return <MyWork />;
    case "repos": return <Repos />;
    case "settings": return <Settings />;
    case "qa": return <QA />;
    case "knowledge": return <Knowledge />;
    case "practices": return <Practices />;
    case "about": return <About />;
    case "team": return <Team />;
    case "constitution": return <Constitution />;
    case "templates": return <Templates />;
    default: return <Home />;
  }
}

function Shell() {
  const { me, apiMode } = useStore();
  const { route } = useNav();
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [route]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  if (!me) return <SignIn />;
  return (
    <div className="shell">
      <Rail open={menu} onNavigate={() => setMenu(false)} />
      {menu && <div className="side-scrim" onClick={() => setMenu(false)} />}
      <div className="shell-main">
        <Topbar onSearch={() => setPalette(true)} onMenu={() => setMenu(true)} />
        {apiMode && <div className="sync-note" role="status" style={{ borderRadius: 0 }}>
          Component fields, owner, reviewer and QA assignments, dependencies, links, comments, blockers, review requests, QA decisions and deployment gates save to the backend. The Engineering Constitution, component templates, specifications, AI Build Contracts and compliance reviews are stored and checked by the backend. Other workspace sections remain demo data. Per-criterion evidence, handoffs, code-review decisions and architecture uploads are not saved.
        </div>}
        <main className="page" key={route.startsWith("c-") ? "c" : route}>
          <Boundary resetKey={route}><Route /></Boundary>
        </main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

function App() {
  const [intro, setIntro] = useState(() => { try { return sessionStorage.getItem("apex-intro-v2") !== "1"; } catch { return true; } });
  return (
    <ThemeProvider>
      <ToastProvider>
      <StoreProvider>
        <NavProvider>
          <Shell />
          <Toasts />
          {intro && <Intro onDone={() => { setIntro(false); try { sessionStorage.setItem("apex-intro-v2", "1"); } catch { } }} />}
        </NavProvider>
      </StoreProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
