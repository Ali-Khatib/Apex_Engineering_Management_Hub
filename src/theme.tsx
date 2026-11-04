import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";

// Light is the default. The OS preference is deliberately not read: a workspace
// that changes appearance because someone's laptop hit sunset is a bug, not a
// feature. The choice is explicit and remembered per browser.
const KEY = "apex-theme";
export type Theme = "light" | "dark";

const read = (): Theme => {
  try { return localStorage.getItem(KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
};
const paint = (t: Theme) => {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#030B08" : "#092D24");
};

const Ctx = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "light", setTheme: () => {} });
export const useTheme = () => React.useContext(Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => { paint(theme); try { localStorage.setItem(KEY, theme); } catch { /* private mode */ } }, [theme]);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

/**
 * The switch. Two jobs: say which mode you are in at a glance, and change it.
 *
 * Motion — occasional action, purpose is state indication:
 *  · knob + icon crossover: CSS transitions (not keyframes, so a double-click
 *    retargets from where it is), transform/opacity/color only, 180ms,
 *    cubic-bezier(.23, 1, .32, 1).
 *  · the page swap: one circular wipe out of the switch itself, 420ms, same
 *    curve, via View Transitions. Browsers without it swap instantly, which is
 *    the correct fallback — nothing is hidden behind the animation.
 *  · both drop to a plain cut under prefers-reduced-motion.
 */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";

  const flip = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const start = (document as any).startViewTransition?.bind(document);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!start || reduce) { setTheme(next); return; }

    // Wipe outward from the centre of the switch, far enough to clear the viewport.
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    root.style.setProperty("--wipe-x", `${x}px`);
    root.style.setProperty("--wipe-y", `${y}px`);
    root.style.setProperty("--wipe-r", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    root.classList.add("theme-wiping");

    const t = start(() => setTheme(next));
    t.finished.finally(() => root.classList.remove("theme-wiping"));
  }, [next, setTheme]);

  return (
    <button type="button" className="theme-switch" onClick={flip}
      role="switch" aria-checked={theme === "dark"} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <span className="theme-knob" aria-hidden />
      <i aria-hidden><Icon name="sun" size={14} /></i>
      <i aria-hidden><Icon name="moon" size={14} /></i>
    </button>
  );
}
