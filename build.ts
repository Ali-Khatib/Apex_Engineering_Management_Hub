// bun build.ts [prod|test]
//  prod → dist/index.html: React 18 UMD, marked and DOMPurify loaded from pinned CDN URLs.
//  test → dist/test.html: same app with React bundled locally, for offline browser checks.
const mode = process.argv[2] || "prod";
const globals = {
  name: "globals",
  setup(b: any) {
    b.onResolve({ filter: /^(react|react-dom|react-dom\/client|react\/jsx-runtime|react\/jsx-dev-runtime)$/ }, (a: any) => ({ path: a.path, namespace: "g" }));
    b.onLoad({ filter: /.*/, namespace: "g" }, (a: any) => {
      if (a.path.includes("jsx")) return { contents: `const R=window.React; export const Fragment=R.Fragment; export function jsx(t,p,k){ if(k!==undefined) p=Object.assign({},p,{key:k}); return R.createElement(t,p);} export const jsxs=jsx; export const jsxDEV=jsx;`, loader: "js" };
      return { contents: `module.exports = window.${a.path.startsWith("react-dom") ? "ReactDOM" : "React"};`, loader: "js" };
    });
  },
};
const r = await Bun.build({
  entrypoints: ["src/main.tsx"], target: "browser", format: "iife", minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [],
});
if (!r.success) { console.error(r.logs); process.exit(1); }
const js = (await r.outputs[0].text()).replace(/<\/script/gi, "<\\/script");
const css = await Bun.file("src/styles.css").text();
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">`;
const cdn = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
  "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js",
];
let libs = "";
libs = (mode === "prod" ? `<script src="${cdn[3]}"></script>\n` : "") + `<script>${(await Bun.file("node_modules/marked/lib/marked.umd.js").text()).replace(/<\/script/gi, "<\\/script")}</script>`;
const html = `<title>Apex Engineering Platform</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Apex AI Arabia engineering portfolio: components, ownership, readiness gates, plans and best practices.">
${fonts}
<style>${css}</style>
<div id="root"></div>
${libs}
<script>${js}</script>
`;
await Bun.write(mode === "prod" ? "dist/index.html" : "dist/test.html", mode === "prod" ? html : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${html}</body></html>`);
console.log(mode, "bundle", Math.round(js.length / 1024) + "KB", "html", Math.round(html.length / 1024) + "KB");
