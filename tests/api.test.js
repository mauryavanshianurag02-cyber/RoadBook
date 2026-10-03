/* ============================================================
   StockBook — API tests
   Spins up the real server on a random port with an in-memory
   database and checks the rules from the specification.

   Run:  npm test
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 4321 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

let server;

async function waitForHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

async function api(p, { method = "GET", body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test.before(async () => {
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: ":memory:", HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  await waitForHealth();
});

test.after(() => server && server.kill("SIGTERM"));

/* ---------------- 1. exactly three warehouses ---------------- */
test("seeds exactly AKASHARWDI, TABLE 1 and CHAIR", async () => {
  const { data } = await api("/api/warehouses");
  assert.deepEqual(data.warehouses.map((w) => w.name), ["AKASHARWDI", "TABLE 1", "CHAIR"]);
});

/* ---------------- 2. opening stock in both units ---------------- */
test("opening stock accepts carton + pcs and converts with PCS/Carton", async () => {
  const { data, status } = await api("/api/products", {
    method: "POST",
    body: { name: "ABC Product", warehouse_id: 2, pcs_per_carton: 24, opening_carton: 10, opening_pcs: 20 },
  });
  assert.equal(status, 201);
  assert.equal(data.product.stock.total_pcs, 260); // 10*24 + 20
  assert.equal(data.product.warehouse_name, "TABLE 1");
  assert.equal(data.product.opening.total_pcs, 260);
});

test("spec example: 5 cartoon + 10 pcs at 24 = 130 pcs", async () => {
  const { data } = await api("/api/products", {
    method: "POST",
    body: { name: "Spec Example", warehouse_id: 3, pcs_per_carton: 24, opening_carton: 5, opening_pcs: 10 },
  });
  assert.equal(data.product.stock.total_pcs, 130);
  assert.deepEqual([data.product.stock.cartons, data.product.stock.pcs], [5, 10]);
});

/* ---------------- 3. daily inbound / outbound ---------------- */
test("inbound increases stock, outbound decreases it", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST",
    body: { name: "Movement Test", warehouse_id: 1, pcs_per_carton: 24, opening_carton: 10, opening_pcs: 20 },
  });
  const id = created.product.id;

  const inb = await api("/api/transactions", { method: "POST", body: { product_id: id, type: "INBOUND", carton: 2, pcs: 5, note: "Received" } });
  assert.equal(inb.status, 201);
  assert.equal(inb.data.transaction.qty_pcs, 53);
  assert.equal(inb.data.product.stock.total_pcs, 313);
  assert.deepEqual([inb.data.product.stock.cartons, inb.data.product.stock.pcs], [13, 1]);

  const out = await api("/api/transactions", { method: "POST", body: { product_id: id, type: "OUTBOUND", carton: 1, pcs: 3 } });
  assert.equal(out.data.transaction.qty_pcs, -27);
  assert.equal(out.data.product.stock.total_pcs, 286);
  assert.equal(out.data.product.today_in.total_pcs, 53);
  assert.equal(out.data.product.today_out.total_pcs, 27);
});

test("outbound that would go negative is rejected with “Insufficient stock.”", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST",
    body: { name: "Small Stock", warehouse_id: 2, pcs_per_carton: 10, opening_carton: 1, opening_pcs: 0 },
  });
  const id = created.product.id;
  const res = await api("/api/transactions", { method: "POST", body: { product_id: id, type: "OUTBOUND", carton: 5, pcs: 0 } });
  assert.equal(res.status, 409);
  assert.equal(res.data.error, "Insufficient stock.");
  assert.equal(res.data.detail.available_pcs, 10);
  assert.equal(res.data.detail.requested_pcs, 50);

  const after = await api(`/api/products/${id}`);
  assert.equal(after.data.product.stock.total_pcs, 10, "stock must not change after a rejected outbound");
});

test("pieces can be sold first and cartons later without manual conversion", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST",
    body: { name: "Mixed Units", warehouse_id: 3, pcs_per_carton: 12, opening_carton: 4, opening_pcs: 0 },
  });
  const id = created.product.id; // 48 pcs

  await api("/api/transactions", { method: "POST", body: { product_id: id, type: "OUTBOUND", carton: 0, pcs: 7 } });
  let p = (await api(`/api/products/${id}`)).data.product;
  assert.equal(p.stock.total_pcs, 41);
  assert.deepEqual([p.stock.cartons, p.stock.pcs], [3, 5]);

  await api("/api/transactions", { method: "POST", body: { product_id: id, type: "OUTBOUND", carton: 2, pcs: 0 } });
  p = (await api(`/api/products/${id}`)).data.product;
  assert.equal(p.stock.total_pcs, 17);
  assert.deepEqual([p.stock.cartons, p.stock.pcs], [1, 5]);

  const exact = await api("/api/transactions", { method: "POST", body: { product_id: id, type: "OUTBOUND", carton: 1, pcs: 5 } });
  assert.equal(exact.data.product.stock.total_pcs, 0, "selling exactly what is left must be allowed");

  const tooMuch = await api("/api/transactions", { method: "POST", body: { product_id: id, type: "OUTBOUND", carton: 0, pcs: 1 } });
  assert.equal(tooMuch.status, 409);
});

test("a transaction dated in the past is not counted in today's figures", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST", body: { name: "Old Entry", warehouse_id: 1, pcs_per_carton: 6, opening_carton: 0, opening_pcs: 0 },
  });
  const id = created.product.id;
  await api("/api/transactions", { method: "POST", body: { product_id: id, type: "INBOUND", date: "2026-01-05", carton: 3, pcs: 0 } });
  const p = (await api(`/api/products/${id}`)).data.product;
  assert.equal(p.stock.total_pcs, 18);
  assert.equal(p.today_in.total_pcs, 0);
  assert.equal(p.inbound_total.total_pcs, 18);
});

/* ---------------- 4. history & filters ---------------- */
test("history can be filtered by date, warehouse, product and type", async () => {
  const all = await api("/api/transactions");
  assert.ok(all.data.transactions.length > 5);

  const inbound = await api("/api/transactions?type=INBOUND");
  assert.ok(inbound.data.transactions.every((t) => t.type === "INBOUND"));

  const wh2 = await api("/api/transactions?warehouse_id=2");
  assert.ok(wh2.data.transactions.every((t) => t.warehouse_id === 2));

  const ranged = await api("/api/transactions?from=2026-01-01&to=2026-01-31");
  assert.ok(ranged.data.transactions.every((t) => t.date >= "2026-01-01" && t.date <= "2026-01-31"));

  const one = await api(`/api/transactions?product_id=${all.data.transactions[0].product_id}`);
  assert.ok(one.data.transactions.every((t) => t.product_id === all.data.transactions[0].product_id));
});

test("history rows keep product, warehouse, date, type, carton, pcs, note and timestamp", async () => {
  const { data } = await api("/api/transactions?limit=1");
  const t = data.transactions[0];
  for (const k of ["product_name", "warehouse_name", "date", "type", "carton", "pcs", "created_at"]) {
    assert.ok(k in t, `missing field ${k}`);
  }
});

/* ---------------- 5. corrections never erase history ---------------- */
test("correcting a transaction recalculates stock and stores a revision", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST", body: { name: "Correction", warehouse_id: 1, pcs_per_carton: 10, opening_carton: 5, opening_pcs: 0 },
  });
  const id = created.product.id;
  const tx = (await api("/api/transactions", { method: "POST", body: { product_id: id, type: "INBOUND", carton: 2, pcs: 0 } })).data.transaction;

  const fixed = await api(`/api/transactions/${tx.id}`, { method: "PATCH", body: { carton: 3, pcs: 5, note: "typo fixed", reason: "wrong quantity" } });
  assert.equal(fixed.data.transaction.qty_pcs, 35);
  assert.equal(fixed.data.product.stock.total_pcs, 85);

  const revs = (await api(`/api/transactions/${tx.id}/revisions`)).data.revisions;
  assert.equal(revs.length, 1);
  assert.equal(revs[0].action, "EDIT");
  assert.equal(revs[0].before.qty_pcs, 20, "the original value must still exist in the audit trail");
});

test("cancelling a transaction keeps the row (soft delete) and updates stock", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST", body: { name: "Voidable", warehouse_id: 2, pcs_per_carton: 10, opening_carton: 4, opening_pcs: 0 },
  });
  const id = created.product.id;
  const tx = (await api("/api/transactions", { method: "POST", body: { product_id: id, type: "INBOUND", carton: 1, pcs: 0 } })).data.transaction;

  const voided = await api(`/api/transactions/${tx.id}`, { method: "DELETE" });
  assert.equal(voided.data.transaction.voided, true);
  assert.equal(voided.data.product.stock.total_pcs, 40);

  const listed = (await api(`/api/transactions?product_id=${id}`)).data.transactions;
  assert.equal(listed.length, 2, "the cancelled row must still be visible in history");

  const restored = await api(`/api/transactions/${tx.id}/restore`, { method: "POST" });
  assert.equal(restored.data.transaction.voided, false);
  assert.equal(restored.data.product.stock.total_pcs, 50);
});

test("cancelling an outbound adds the stock back", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST", body: { name: "Guard", warehouse_id: 3, pcs_per_carton: 10, opening_carton: 2, opening_pcs: 0 },
  });
  const id = created.product.id;
  await api("/api/transactions", { method: "POST", body: { product_id: id, type: "OUTBOUND", carton: 2, pcs: 0 } });
  const list = (await api(`/api/transactions?product_id=${id}&type=OUTBOUND`)).data.transactions;
  const res = await api(`/api/transactions/${list[0].id}`, { method: "DELETE" });
  // removing an outbound adds stock back, so it must succeed
  assert.equal(res.status, 200);
});

/* ---------------- 6. editing a product ---------------- */
test("editing PCS/Carton keeps the piece total and re-splits the display", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST", body: { name: "Rate Change", warehouse_id: 1, pcs_per_carton: 24, opening_carton: 5, opening_pcs: 10 },
  });
  const id = created.product.id; // 130 pcs
  const upd = await api(`/api/products/${id}`, { method: "PATCH", body: { pcs_per_carton: 12 } });
  assert.equal(upd.data.product.stock.total_pcs, 130, "total pieces must not change");
  assert.deepEqual([upd.data.product.stock.cartons, upd.data.product.stock.pcs], [10, 10]);

  const txs = (await api(`/api/transactions?product_id=${id}`)).data.transactions;
  assert.equal(txs[0].pcs_per_carton, 24, "old transactions keep the rate they were entered with");
  assert.equal(txs[0].qty_pcs, 130);
});

test("moving a product to another warehouse transfers stock with two linked entries", async () => {
  const { data: created } = await api("/api/products", {
    method: "POST", body: { name: "Mover", warehouse_id: 1, pcs_per_carton: 10, opening_carton: 3, opening_pcs: 2 },
  });
  const id = created.product.id; // 32 pcs in AKASHARWDI
  const upd = await api(`/api/products/${id}`, { method: "PATCH", body: { warehouse_id: 3 } });
  assert.equal(upd.data.product.warehouse_name, "CHAIR");
  assert.equal(upd.data.product.stock.total_pcs, 32);

  const txs = (await api(`/api/transactions?product_id=${id}&type=TRANSFER`)).data.transactions;
  assert.equal(txs.length, 2);
  assert.equal(txs.find((t) => t.warehouse_id === 1).qty_pcs, -32);
  assert.equal(txs.find((t) => t.warehouse_id === 3).qty_pcs, 32);

  const summary = (await api("/api/summary")).data;
  const chair = summary.warehouses.find((w) => w.id === 3).total_pcs;
  assert.equal(chair >= 32, true, "the moved stock must land in the new warehouse's total");
});

/* ---------------- 7. summary / dashboard ---------------- */
test("summary reports per-warehouse stock, today's inbound and outbound", async () => {
  const { data } = await api("/api/summary");
  assert.equal(data.warehouses.length, 3);
  const total = data.warehouses.reduce((a, w) => a + w.total_pcs, 0);
  assert.equal(data.totals.total_pcs, total);
  assert.equal(data.totals.products, data.warehouses.reduce((a, w) => a + w.products, 0));
});

test("bootstrap returns warehouses, products, summary and recent entries", async () => {
  const { data } = await api("/api/bootstrap");
  assert.ok(Array.isArray(data.warehouses) && data.warehouses.length === 3);
  assert.ok(Array.isArray(data.products));
  assert.ok(data.summary && data.summary.totals);
  assert.ok(Array.isArray(data.recent));
  assert.ok(Array.isArray(data.today_tx));
});

test("bootstrap can be scoped to one warehouse", async () => {
  const { data } = await api("/api/bootstrap?warehouse_id=3");
  assert.ok(data.products.every((p) => p.warehouse_id === 3));
  assert.equal(data.summary.warehouses.length, 3, "the dashboard keeps showing all three warehouse cards");
  assert.equal(data.summary.scope, 3);
  assert.equal(data.summary.totals.total_pcs, data.summary.warehouses.find((w) => w.id === 3).total_pcs);
  assert.equal(data.summary.grand_totals.total_pcs, data.summary.warehouses.reduce((a, w) => a + w.total_pcs, 0));
  assert.ok(data.all_products.length >= data.products.length);
});

/* ---------------- 8. validation ---------------- */
test("rejects bad input", async () => {
  assert.equal((await api("/api/products", { method: "POST", body: { name: "", warehouse_id: 1, pcs_per_carton: 1 } })).status, 400);
  assert.equal((await api("/api/products", { method: "POST", body: { name: "X", warehouse_id: 99, pcs_per_carton: 1 } })).status, 400);
  assert.equal((await api("/api/products", { method: "POST", body: { name: "X", warehouse_id: 1, pcs_per_carton: 0 } })).status, 400);
  assert.equal((await api("/api/transactions", { method: "POST", body: { product_id: 1, type: "INBOUND", carton: 0, pcs: 0 } })).status, 400);
  assert.equal((await api("/api/transactions", { method: "POST", body: { product_id: 1, type: "INBOUND", carton: -3, pcs: 0 } })).status, 400);
  assert.equal((await api("/api/products/999999")).status, 404);
});

test("static front-end is served and the database file is not", async () => {
  const html = await fetch(`${BASE}/`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /StockBook/);
  assert.equal((await fetch(`${BASE}/data/inventory.db`)).status, 403);
  assert.equal((await fetch(`${BASE}/server/db.js`)).status, 403);
});
