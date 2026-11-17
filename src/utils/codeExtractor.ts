export interface CodeBlock {
  lang: string;
  code: string;
}

export interface ExtractedPreview {
  hasCode: boolean;
  isRenderable: boolean;
  primaryLang: string;
  primaryCode: string;
  previewHtml: string;
  blocks: CodeBlock[];
}

const RUNTIME_BRIDGE_SCRIPT = `<script>
(function(){
  function report(msg){
    try { window.parent.postMessage({ source: 'olmabek-preview', type: 'error', message: String(msg) }, '*'); } catch(e){}
  }
  window.addEventListener('error', function(e){
    report(e.message || 'Skript xatosi');
  });
  window.addEventListener('unhandledrejection', function(e){
    report(e.reason && e.reason.message ? e.reason.message : String(e.reason || 'Async xato'));
  });
})();
</script>`;

function injectBridge(html: string): string {
  if (html.includes("</head>")) {
    return html.replace("</head>", `${RUNTIME_BRIDGE_SCRIPT}</head>`);
  }
  if (html.includes("<body")) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${RUNTIME_BRIDGE_SCRIPT}`);
  }
  return `${RUNTIME_BRIDGE_SCRIPT}${html}`;
}

function wrapReactJsx(jsxCode: string): string {
  // Strip top-level import lines and export default for inline Babel compilation
  const cleaned = jsxCode
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/export\s+default\s+function\s+/g, "function ")
    .replace(/export\s+default\s+class\s+/g, "class ")
    .replace(/export\s+default\s+([A-Za-z0-9_]+)\s*;?/g, "const __DefaultExport = $1;")
    .replace(/export\s+(const|function|class)\s+/g, "$1 ");

  const safeCode = cleaned.replace(/<\/script>/gi, "<\\/script>");

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  ${RUNTIME_BRIDGE_SCRIPT}
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useRef, useMemo, useCallback } = React;
    ${safeCode}
    const __Target = typeof __DefaultExport !== 'undefined'
      ? __DefaultExport
      : (typeof App !== 'undefined' ? App : null);
    if (__Target) {
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__Target));
    } else {
      document.getElementById('root').innerHTML = '<div style="padding:24px;font-family:sans-serif;color:#94a3b8;">Komponent topilmadi (App nomli komponent yarating).</div>';
    }
  </script>
</body>
</html>`;
}

export function extractCodeArtifacts(markdown: string): ExtractedPreview {
  const source = String(markdown || "");
  // Handle unclosed fenced blocks during live streaming
  const normalized =
    (source.match(/```/g) || []).length % 2 === 1 ? `${source}\n\`\`\`` : source;

  const blocks: CodeBlock[] = [];
  const regex = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    const lang = (match[1] || "text").toLowerCase().trim();
    const code = match[2].replace(/\n$/, "");
    if (code.trim()) {
      blocks.push({ lang, code });
    }
  }

  if (!blocks.length) {
    return {
      hasCode: false,
      isRenderable: false,
      primaryLang: "",
      primaryCode: "",
      previewHtml: "",
      blocks: [],
    };
  }

  const htmlBlock = blocks.find((b) => b.lang === "html" || b.lang === "htm");
  const cssBlock = blocks.find((b) => b.lang === "css");
  const jsBlock = blocks.find((b) => b.lang === "js" || b.lang === "javascript");
  const jsxBlock = blocks.find((b) =>
    ["jsx", "tsx", "react"].includes(b.lang)
  );
  const svgBlock = blocks.find((b) => b.lang === "svg");

  if (htmlBlock) {
    const raw = htmlBlock.code;
    const isFullDoc = /<!doctype|<html/i.test(raw);
    let doc = raw;
    if (!isFullDoc) {
      doc = `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  ${cssBlock ? `<style>${cssBlock.code}</style>` : ""}
</head>
<body>
  ${raw}
  ${jsBlock ? `<script>${jsBlock.code}</script>` : ""}
</body>
</html>`;
    } else if (cssBlock || jsBlock) {
      if (cssBlock && doc.includes("</head>")) {
        doc = doc.replace("</head>", `<style>${cssBlock.code}</style></head>`);
      }
      if (jsBlock && doc.includes("</body>")) {
        doc = doc.replace("</body>", `<script>${jsBlock.code}</script></body>`);
      }
    }
    return {
      hasCode: true,
      isRenderable: true,
      primaryLang: "html",
      primaryCode: doc,
      previewHtml: injectBridge(doc),
      blocks,
    };
  }

  if (jsxBlock) {
    const doc = wrapReactJsx(jsxBlock.code);
    return {
      hasCode: true,
      isRenderable: true,
      primaryLang: jsxBlock.lang,
      primaryCode: jsxBlock.code,
      previewHtml: doc,
      blocks,
    };
  }

  if (svgBlock) {
    const doc = `<!DOCTYPE html>
<html>
<head><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f17;}</style></head>
<body>${svgBlock.code}</body>
</html>`;
    return {
      hasCode: true,
      isRenderable: true,
      primaryLang: "svg",
      primaryCode: svgBlock.code,
      previewHtml: injectBridge(doc),
      blocks,
    };
  }

  const primary = blocks[0];
  return {
    hasCode: true,
    isRenderable: false,
    primaryLang: primary.lang || "code",
    primaryCode: primary.code,
    previewHtml: "",
    blocks,
  };
}
