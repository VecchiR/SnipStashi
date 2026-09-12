/**
 * Watch local — sem dependências.
 *
 * Uso:
 *   1. Carregue a pasta "extension v1" uma vez em chrome://extensions
 *   2. Neste diretório: npm run watch
 *   3. Salve qualquer arquivo → a extensão recarrega sozinha
 *
 * O service worker faz long-poll em http://127.0.0.1:39217/wait
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 39217;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WATCH_FILES = [
  "popup.html",
  "popup.css",
  "popup.js",
  "storage.js",
  "drive-sync.js",
  "background.js",
  "manifest.json"
];

let version = String(Date.now());
/** @type {Set<{ res: http.ServerResponse, since: string }>} */
const waiters = new Set();

function bump(reason) {
  version = String(Date.now());
  console.log(`[watch] reload ← ${reason}  (v=${version})`);
  for (const w of waiters) {
    if (w.since !== version) {
      w.res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      });
      w.res.end(version);
      waiters.delete(w);
    }
  }
}

function watchFile(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.warn(`[watch] pulando (não existe): ${rel}`);
    return;
  }
  let timer = null;
  fs.watch(full, { persistent: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => bump(rel), 80);
  });
  console.log(`[watch] observando ${rel}`);
}

WATCH_FILES.forEach(watchFile);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/version") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(version);
    return;
  }

  if (url.pathname === "/wait") {
    const since = url.searchParams.get("since") || "0";
    if (since !== version) {
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      });
      res.end(version);
      return;
    }
    const waiter = { res, since };
    waiters.add(waiter);
    const timeout = setTimeout(() => {
      if (!waiters.has(waiter)) return;
      waiters.delete(waiter);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      });
      res.end(version);
    }, 25000);
    req.on("close", () => {
      clearTimeout(timeout);
      waiters.delete(waiter);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  SnipStashi — watch ativo");
  console.log(`  http://127.0.0.1:${PORT}`);
  console.log(`  pasta: ${ROOT}`);
  console.log("");
  console.log("  Carregue a extensão uma vez (se ainda não carregou).");
  console.log("  Edite e salve → reload automático.");
  console.log("");
});
