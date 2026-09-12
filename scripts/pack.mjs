/**
 * Gera o pacote pronto para a Chrome Web Store em ./dist/
 * - Remove hot-reload / localhost
 * - Cria pasta + ZIP
 *
 * Uso: npm run pack
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distRoot = path.join(root, "dist");
const outDir = path.join(distRoot, "snipstashi");
const zipPath = path.join(distRoot, "snipstashi.zip");

const COPY_FILES = [
  "background.js",
  "storage.js",
  "drive-sync.js",
  "popup.html",
  "popup.js",
  "popup.css"
];

const COPY_DIRS = ["icons", "brand"];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function buildManifest() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  delete manifest.host_permissions;
  manifest.host_permissions = ["https://www.googleapis.com/*"];
  manifest.content_security_policy = {
    extension_pages:
      "script-src 'self'; object-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://www.googleapis.com"
  };
  return manifest;
}

function buildBackground() {
  let src = fs.readFileSync(path.join(root, "background.js"), "utf8");
  src = src.replace(/\r?\n\/\* Dev hot-reload[\s\S]*$/m, "\n");
  return src.trimEnd() + "\n";
}

rmrf(distRoot);
fs.mkdirSync(outDir, { recursive: true });

for (const file of COPY_FILES) {
  if (file === "background.js") {
    fs.writeFileSync(path.join(outDir, file), buildBackground(), "utf8");
  } else {
    copyFile(path.join(root, file), path.join(outDir, file));
  }
}

for (const dir of COPY_DIRS) {
  copyDir(path.join(root, dir), path.join(outDir, dir));
}

fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(buildManifest(), null, 2) + "\n",
  "utf8"
);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const zipResult = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`
  ],
  { encoding: "utf8" }
);

if (zipResult.status !== 0) {
  console.error(zipResult.stderr || zipResult.stdout || "Falha ao criar ZIP");
  process.exit(1);
}

const manifest = buildManifest();
console.log(`Pacote pronto: ${outDir}`);
console.log(`ZIP: ${zipPath}`);
console.log(`Versão: ${manifest.version}`);
console.log("Envie o ZIP em https://chrome.google.com/webstore/devconsole");
