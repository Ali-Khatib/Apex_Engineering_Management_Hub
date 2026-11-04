// Generates a C4-style container diagram as an SVG document.
// Architecture files are documents, so they use a fixed paper palette rather than theme tokens.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STORES: Record<string, string[]> = {
  "Platform & Identity": ["PostgreSQL 16", "Vault"],
  "APIs & Services": ["Redis", "OTel collector"],
  "Data & Integrations": ["Kafka", "PostgreSQL 16"],
  "Document Intelligence": ["MinIO object store", "Job queue"],
  "ML Services": ["Model registry", "GPU node pool"],
  "Applications": ["API Gateway", "CDN / static"],
  "Infrastructure & DevOps": ["Terraform state", "Container registry"],
};

export function archDiagram(name: string, deps: string[], users: string[], category: string): string {
  const W = 1120, H = 640;
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, kind: "core" | "dep" | "use" | "store") => {
    const fill = kind === "core" ? "#0B3D2A" : kind === "store" ? "#F2F6F3" : "#FFFFFF";
    const stroke = kind === "core" ? "#0B3D2A" : kind === "store" ? "#B9C9BE" : "#9DB3A5";
    const tc = kind === "core" ? "#FFFFFF" : "#17221D";
    const sc = kind === "core" ? "#A2E94A" : "#5B6B62";
    const rx = kind === "store" ? 22 : 10;
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${kind === "use" ? 'stroke-dasharray="5 4"' : ""}/>
<text x="${x + w / 2}" y="${y + h / 2 - 4}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${kind === "core" ? 17 : 14}" font-weight="600" fill="${tc}">${esc(title)}</text>
<text x="${x + w / 2}" y="${y + h / 2 + 16}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" fill="${sc}">${esc(sub)}</text></g>`;
  };
  const arrow = (x1: number, y1: number, x2: number, y2: number, label: string) => {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#5B6B62" stroke-width="1.4" marker-end="url(#ah)"/>
<text x="${mx}" y="${my - 6}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="11" fill="#5B6B62">${esc(label)}</text>`;
  };
  const cx = 420, cy = 220, cw = 280, ch = 110;
  let out = "";
  const left = deps.length ? deps : ["Client users / upstream systems"];
  left.slice(0, 4).forEach((d, i, a) => {
    const y = 80 + i * (400 / Math.max(a.length, 1)) + (a.length === 1 ? 140 : 0);
    out += box(40, y, 240, 72, d, deps.length ? "Dependency" : "Caller", "dep");
    out += arrow(280, y + 36, cx, cy + ch / 2, deps.length ? "uses" : "calls");
  });
  const right = users.length ? users : ["Apex products"];
  right.slice(0, 4).forEach((d, i, a) => {
    const y = 80 + i * (400 / Math.max(a.length, 1)) + (a.length === 1 ? 140 : 0);
    out += box(840, y, 240, 72, d, users.length ? "Depends on this" : "Consumer", "use");
    out += arrow(cx + cw, cy + ch / 2, 840, y + 36, "serves");
  });
  out += box(cx, cy, cw, ch, name, category, "core");
  (STORES[category] || ["PostgreSQL 16", "Object store"]).forEach((s, i) => {
    const x = cx - 40 + i * 200;
    out += box(x, 470, 160, 64, s, "Data store", "store");
    out += `<path d="M${cx + cw / 2},${cy + ch} L${x + 80},470" fill="none" stroke="#9DB3A5" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#ah)"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5B6B62"/></marker>
<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#E9EFEA" stroke-width="1"/></pattern></defs>
<rect width="${W}" height="${H}" fill="#FBFCFB"/><rect width="${W}" height="${H}" fill="url(#grid)"/>
<text x="40" y="44" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600" fill="#087A43" letter-spacing="1.5">CONTAINER VIEW</text>
<text x="1080" y="44" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="12" fill="#5B6B62">Apex AI Arabia · internal</text>
${out}
<text x="40" y="610" font-family="Inter, Arial, sans-serif" font-size="11" fill="#5B6B62">Solid: required dependency · Dashed: consumers and data stores</text>
</svg>`;
}
