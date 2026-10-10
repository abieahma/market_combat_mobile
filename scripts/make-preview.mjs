// Turns an `expo export --platform web` folder into a preview that can be
// shown in the Claude chat: one index.html with the JS and CSS inlined,
// plus an assets/ folder, all referenced by relative paths.
//
// Usage: node scripts/make-preview.mjs [distDir=dist] [outDir=preview]
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.argv[2] ?? 'dist');
const outDir = path.resolve(process.argv[3] ?? 'preview');

const readDist = (urlPath) => fs.readFileSync(path.join(distDir, urlPath.replace(/^\//, '')), 'utf8');

// Root-relative URLs ("/assets/..", "/_expo/..") break when the page is not
// served from the site root, so make them relative to the page.
const relativize = (code) => code.replace(/(["'`])\/(assets|_expo)\//g, '$1./$2/');

let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

// Inline stylesheets.
html = html.replace(/<link\b[^>]*\bhref="(\/_expo\/[^"]+\.css)"[^>]*>/g, (_, href) => `<style>${relativize(readDist(href))}</style>`);

// Pull the JS bundles out of the page; they are re-added inline at the end of <body>.
const scripts = [];
html = html.replace(/<script\b[^>]*\bsrc="(\/_expo\/[^"]+\.js)"[^>]*>\s*<\/script>/g, (_, src) => {
  scripts.push(readDist(src));
  return '';
});
if (scripts.length === 0) {
  console.error('make-preview: no /_expo/*.js bundle found in index.html');
  process.exit(1);
}

// Drop preloads of the now-inlined bundles and the root-relative favicon.
html = html.replace(/<link\b[^>]*\bhref="\/_expo\/[^"]+\.js"[^>]*>/g, '');
html = html.replace(/<link\b[^>]*\brel="(?:shortcut )?icon"[^>]*>/g, '');

// Page chrome: theme tokens, and on wide screens a phone-sized frame.
const frameCss = `
<style id="preview-frame">
  :root { --preview-bg: #e9ecf1; --preview-frame: #cfd5de; color-scheme: light; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --preview-bg: #0b0d10; --preview-frame: #2a2f37; color-scheme: dark; }
  }
  :root[data-theme="dark"] { --preview-bg: #0b0d10; --preview-frame: #2a2f37; color-scheme: dark; }
  html { box-sizing: border-box; }
  html, body { margin: 0; background: var(--preview-bg); }
  @media (min-width: 640px) {
    #root {
      max-width: 400px;
      height: min(844px, calc(100% - 48px));
      margin: 24px auto;
      border: 1px solid var(--preview-frame);
      border-radius: 32px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
    }
  }
</style>`;
// Replacement callbacks, not strings: minified JS is full of `$&`, `$'` and
// `$\``, which String.prototype.replace would expand inside a string.
html = html.replace('</head>', () => `${frameCss}\n</head>`);

const safeInline = (code) =>
  relativize(code)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
const inlined = scripts.map((code) => `<script>${safeInline(code)}</script>`).join('\n');

// The chat preview host wraps the page in its own document skeleton
// (doctype, charset, viewport), so ship the contents only. Strip the
// wrappers before appending the bundle, so its strings are never touched.
html = html
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
  .replace(/<meta\b[^>]*(?:charset|name="viewport"|httpEquiv|http-equiv)[^>]*>/gi, '')
  .trim();
html = `${html}\n${inlined}\n`;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);

// Copy static assets (images, fonts) next to the page.
const assetsDir = path.join(distDir, 'assets');
let assetCount = 0;
if (fs.existsSync(assetsDir)) {
  fs.cpSync(assetsDir, path.join(outDir, 'assets'), { recursive: true });
  const count = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
  assetCount = count(assetsDir);
}

const kb = (fs.statSync(path.join(outDir, 'index.html')).size / 1024).toFixed(0);
console.log(`make-preview: ${outDir}/index.html (${kb} KB, ${scripts.length} script(s)), ${assetCount} asset file(s)`);
