/* ============================================================
   StockBook — HTTP server (zero dependencies)

   Serves the static front-end (index.html / css / js) and a small
   JSON API backed by SQLite (server/db.js).

   Start:  npm start            (http://localhost:3000)
           PORT=8080 npm start
   ============================================================ */
"use strict";

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, httpError, validDate, todayISO, split, TX_TYPES } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "inventory.db");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = 12 * 1024 * 1024; // 12 MB (product images are resized in the browser)

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const store = new Store(DB_FILE);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
};

/* ---------------- tiny helpers ---------------- */

const send = (res, status, body, headers = {}) => {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Length": Buffer.byteLength(payload),
    "Content-Type": typeof body === "string" || Buffer.isBuffer(body) ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
};

const json = (res, body, status = 200) =>
  send(res, status, JSON.stringify(body), { "Content-Type": "application/json; charset=utf-8" });

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw httpError(413, "Upload is too large (max 12 MB).");
    chunks.push(c);
  }
  if (!size) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Invalid JSON body.");
  }
}

const int = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function txFilters(u) {
  return {
    from: u.searchParams.get("from") || "",
    to: u.searchParams.get("to") || "",
    warehouseId: int(u.searchParams.get("warehouse_id"), 0),
    productId: int(u.searchParams.get("product_id"), 0),
    type: (u.searchParams.get("type") || "").toUpperCase(),
    q: u.searchParams.get("q") || "",
    includeVoided: u.searchParams.get("include_voided") !== "0",
    limit: int(u.searchParams.get("limit"), 1000),
    offset: int(u.searchParams.get("offset"), 0),
  };
}

function applyToday(u) {
  const d = u.searchParams.get("today");
  store.today = validDate(d) ? d : todayISO();
  return store.today;
}

/* ---------------- uploads ---------------- */

const IMAGE_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

/** Delete a previously uploaded image (used when it is replaced or removed). */
async function removeUpload(imagePath) {
  if (!imagePath || !String(imagePath).startsWith("/uploads/")) return;
  const file = path.resolve(UPLOAD_DIR, String(imagePath).slice("/uploads/".length));
  if (!file.startsWith(UPLOAD_DIR + path.sep)) return;
  try { await fsp.unlink(file); } catch { /* already gone */ }
}

async function handleUpload(body) {
  const mime = String(body.mime || "").toLowerCase();
  const ext = IMAGE_EXT[mime];
  if (!ext) throw httpError(400, "Only JPG, PNG, WEBP or GIF images are allowed.");
  const data = String(body.data || "");
  const b64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw httpError(400, "Empty image.");
  if (buf.length > 8 * 1024 * 1024) throw httpError(413, "Image is too large (max 8 MB).");
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
  return { path: `/uploads/${name}`, bytes: buf.length };
}

/* ---------------- CSV export ---------------- */

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function transactionsCsv(rows) {
  const head = ["Date", "Product", "Warehouse", "Type", "Cartoon", "PCS", "Total PCS", "PCS/Carton", "Note", "Status", "Recorded at"];
  const lines = rows.map((t) =>
    [
      t.date, t.product_name, t.warehouse_name, t.type,
      t.carton, t.pcs, t.qty_pcs, t.pcs_per_carton, t.note,
      t.voided ? "CANCELLED" : "OK", (t.created_at || "").replace("T", " ").slice(0, 19),
    ].map(csvEscape).join(",")
  );
  return [head.join(","), ...lines].join("\r\n");
}

/* ---------------- router ---------------- */

async function api(req, res, u) {
  const parts = u.pathname.split("/").filter(Boolean); // ['api', ...]
  const [, resource, id, sub] = parts;
  const method = req.method.toUpperCase();
  applyToday(u);

  /* --- health --- */
  if (resource === "health" && method === "GET") {
    return json(res, { ok: true, db: DB_FILE === ":memory:" ? "memory" : "sqlite", warehouses: store.warehouses().map((w) => w.name), time: new Date().toISOString() });
  }

  /* --- bootstrap: everything the dashboard needs in one call --- */
  if (resource === "bootstrap" && method === "GET") {
    const warehouseId = int(u.searchParams.get("warehouse_id"), 0);
    const q = u.searchParams.get("q") || "";
    return json(res, {
      today: store.today,
      server_time: new Date().toISOString(),
      warehouses: store.warehouses(),
      products: store.listProducts({ warehouseId, q }),
      all_products: warehouseId || q ? store.listProducts({}) : undefined,
      summary: store.summary({ warehouseId }),
      recent: store.listTransactions({ limit: 12 }),
      today_tx: store.listTransactions({ from: store.today, to: store.today, warehouseId, limit: 500 }),
    });
  }

  /* --- warehouses --- */
  if (resource === "warehouses" && method === "GET") return json(res, { warehouses: store.warehouses() });

  /* --- summary --- */
  if (resource === "summary" && method === "GET") {
    return json(res, store.summary({ warehouseId: int(u.searchParams.get("warehouse_id"), 0) }));
  }

  /* --- products --- */
  if (resource === "products") {
    if (!id && method === "GET") {
      return json(res, { products: store.listProducts({ warehouseId: int(u.searchParams.get("warehouse_id"), 0), q: u.searchParams.get("q") || "" }) });
    }
    if (!id && method === "POST") {
      const b = await readBody(req);
      let imagePath = null;
      if (b.image && b.image.data) imagePath = (await handleUpload(b.image)).path;
      const product = store.createProduct({
        name: b.name,
        warehouseId: b.warehouse_id,
        pcsPerCarton: b.pcs_per_carton,
        imagePath,
        openingCarton: b.opening_carton,
        openingPcs: b.opening_pcs,
        openingDate: b.opening_date,
        openingNote: b.opening_note,
      });
      return json(res, { product }, 201);
    }
    if (id && method === "GET") return json(res, { product: store.getProduct(id) });
    if (id && (method === "PATCH" || method === "PUT")) {
      const b = await readBody(req);
      const before = store.getProduct(id);
      const patch = {};
      if (b.name !== undefined) patch.name = b.name;
      if (b.pcs_per_carton !== undefined) patch.pcsPerCarton = b.pcs_per_carton;
      if (b.warehouse_id !== undefined) patch.warehouseId = b.warehouse_id;
      if (b.image !== undefined) {
        if (b.image && b.image.data) patch.imagePath = (await handleUpload(b.image)).path;
        else patch.imagePath = null;
        if (patch.imagePath !== before.image) await removeUpload(before.image);
      }
      if (b.transfer_date) patch.transferDate = b.transfer_date;
      return json(res, { product: store.updateProduct(id, patch) });
    }
  }

  /* --- transactions --- */
  if (resource === "transactions") {
    if (!id && method === "GET") {
      const rows = store.listTransactions(txFilters(u));
      const totals = rows
        .filter((t) => !t.voided)
        .reduce((a, t) => {
          if (t.qty_pcs > 0) a.in_pcs += t.qty_pcs; else a.out_pcs += -t.qty_pcs;
          a.count += 1;
          return a;
        }, { in_pcs: 0, out_pcs: 0, count: 0 });
      return json(res, { transactions: rows, totals, count: rows.length });
    }
    if (!id && method === "POST") {
      const b = await readBody(req);
      const tx = store.addTransaction({
        productId: b.product_id,
        type: String(b.type || "").toUpperCase(),
        date: b.date,
        carton: b.carton,
        pcs: b.pcs,
        note: b.note,
        warehouseId: b.warehouse_id || null,
        sign: int(b.sign, 1),
      });
      return json(res, { transaction: tx, product: store.getProduct(tx.product_id) }, 201);
    }
    if (id && sub === "restore" && method === "POST") {
      const tx = store.restoreTransaction(id);
      return json(res, { transaction: tx, product: store.getProduct(tx.product_id) });
    }
    if (id && sub === "revisions" && method === "GET") {
      return json(res, { revisions: store.revisions(id) });
    }
    if (id && method === "GET") {
      const tx = store.getTransaction(id);
      if (!tx) throw httpError(404, "Transaction not found.");
      return json(res, { transaction: tx, revisions: store.revisions(id) });
    }
    if (id && (method === "PATCH" || method === "PUT")) {
      const b = await readBody(req);
      const tx = store.updateTransaction(id, { date: b.date, carton: b.carton, pcs: b.pcs, note: b.note, reason: b.reason });
      return json(res, { transaction: tx, product: store.getProduct(tx.product_id) });
    }
    if (id && method === "DELETE") {
      const tx = store.voidTransaction(id, u.searchParams.get("reason") || "");
      return json(res, { transaction: tx, product: store.getProduct(tx.product_id) });
    }
  }

  /* --- CSV export --- */
  if (resource === "export" && id === "transactions" && method === "GET") {
    const rows = store.listTransactions(txFilters(u));
    return send(res, 200, transactionsCsv(rows), {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-transactions-${store.today}.csv"`,
    });
  }

  throw httpError(404, `No API route for ${method} ${u.pathname}`);
}

/* ---------------- static files ---------------- */

async function serveStatic(req, res, u) {
  let rel = decodeURIComponent(u.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";

  const isUpload = rel.startsWith("/uploads/");
  const baseDir = isUpload ? UPLOAD_DIR : ROOT;
  const relPath = isUpload ? rel.slice("/uploads/".length) : rel.replace(/^\//, "");

  // never serve the database, the server source or git internals
  if (!isUpload && ["data", "server", ".git", "node_modules"].includes(relPath.split("/")[0])) {
    return send(res, 403, "Forbidden");
  }

  // block path traversal
  const file = path.resolve(baseDir, relPath);
  if (file !== baseDir && !file.startsWith(baseDir + path.sep)) return send(res, 403, "Forbidden");

  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) throw Object.assign(new Error("dir"), { code: "EISDIR" });
    const ext = path.extname(file).toLowerCase();
    const body = await fsp.readFile(file);
    return send(res, 200, body, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
    });
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") {
      // single-page app fallback
      if (!path.extname(rel)) {
        const html = await fsp.readFile(path.join(ROOT, "index.html"));
        return send(res, 200, html, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
      }
      return send(res, 404, "Not found");
    }
    throw err;
  }
}

/* ---------------- server ---------------- */

export const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (u.pathname === "/api" || u.pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
        return res.end();
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      return await api(req, res, u);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    return await serveStatic(req, res, u);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[api] ${req.method} ${u.pathname}`, err);
    return json(res, { error: err.message || "Server error", detail: err.detail || undefined }, status);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  StockBook — Inventory & Warehouse Management`);
  console.log(`  → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  Database : ${DB_FILE}`);
  console.log(`  Uploads  : ${UPLOAD_DIR}`);
  console.log(`  Warehouses: ${store.warehouses().map((w) => w.name).join(" | ")}\n`);
});
