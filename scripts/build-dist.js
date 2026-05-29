import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const dist = resolve(root, "dist");
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

// --- index.html: copy as-is (vite.config entry point) ---
const html = readFileSync(resolve(root, "index.html"), "utf-8");
writeFileSync(resolve(dist, "index.html"), html);
console.log("✓ dist/index.html");

// --- main.js: patch bare jszip import -> CDN, then copy ---
let js = readFileSync(resolve(root, "main.js"), "utf-8");
js = js.replace(
  'import JSZip from "jszip";',
  'import JSZip from "https://esm.sh/jszip";'
);
writeFileSync(resolve(dist, "main.js"), js);
console.log("✓ dist/main.js (jszip → esm.sh)");
