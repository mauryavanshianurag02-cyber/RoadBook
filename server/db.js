/* ============================================================
   StockBook — data layer
   SQLite via Node's built-in `node:sqlite` (no dependencies).

   Stock is NEVER stored as a mutable number on the product row.
   It is always recalculated from the append-only transaction log:

       current stock = OPENING + INBOUND + ADJUSTMENT(+) + TRANSFER(+)
                     - OUTBOUND - ADJUSTMENT(-) - TRANSFER(-)

   Transactions are soft-voided (voided_at) and every edit writes a
   row into transaction_revisions, so history is never overwritten.
   ============================================================ */
"use strict";

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const WAREHOUSE_NAMES = ["AKASHARWDI", "TABLE 1", "CHAIR"];

export const TX_TYPES = {
  OPENING: "OPENING",
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
  ADJUSTMENT: "ADJUSTMENT",
  TRANSFER: "TRANSFER",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS warehouses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  pcs_per_carton  INTEGER NOT NULL DEFAULT 1,
  image_path      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (pcs_per_carton > 0)
);

CREATE TABLE IF NOT EXISTS stock_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  type            TEXT NOT NULL,
  tx_date         TEXT NOT NULL,                 -- YYYY-MM-DD (user editable)
  carton          INTEGER NOT NULL DEFAULT 0,    -- exactly as the user typed it
  pcs             INTEGER NOT NULL DEFAULT 0,    -- exactly as the user typed it
  pcs_per_carton  INTEGER NOT NULL,              -- rate snapshot at entry time
  qty_pcs         INTEGER NOT NULL,              -- signed total in pieces
  note            TEXT,
  voided_at       TEXT,                          -- soft delete, never a hard delete
  void_reason     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (type IN ('OPENING','INBOUND','OUTBOUND','ADJUSTMENT','TRANSFER'))
);

CREATE TABLE IF NOT EXISTS transaction_revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  INTEGER NOT NULL REFERENCES stock_transactions(id),
  action          TEXT NOT NULL,                 -- EDIT | VOID | RESTORE
  before_json     TEXT NOT NULL,
  after_json      TEXT,
  reason          TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  before_json  TEXT NOT NULL,
  after_json   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_product   ON stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_tx_warehouse ON stock_transactions(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_tx_date      ON stock_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_tx_type      ON stock_transactions(type);
CREATE INDEX IF NOT EXISTS idx_prod_wh      ON products(warehouse_id);

-- Current stock is always derived, never stored. This view is handy if you
-- open data/inventory.db with a SQLite browser.
CREATE VIEW IF NOT EXISTS product_stock AS
SELECT p.id                                                    AS product_id,
       p.name,
       p.warehouse_id,
       w.name                                                  AS warehouse_name,
       p.pcs_per_carton,
       COALESCE(SUM(t.qty_pcs), 0)                             AS total_pcs,
       COALESCE(SUM(CASE WHEN t.type = 'OPENING'  THEN t.qty_pcs ELSE 0 END), 0)  AS opening_pcs,
       COALESCE(SUM(CASE WHEN t.type = 'INBOUND'  THEN t.qty_pcs ELSE 0 END), 0)  AS inbound_pcs,
       COALESCE(SUM(CASE WHEN t.type = 'OUTBOUND' THEN -t.qty_pcs ELSE 0 END), 0) AS outbound_pcs,
       COALESCE(SUM(CASE WHEN t.type = 'INBOUND'  AND t.tx_date = date('now') THEN t.qty_pcs ELSE 0 END), 0)  AS today_in_pcs,
       COALESCE(SUM(CASE WHEN t.type = 'OUTBOUND' AND t.tx_date = date('now') THEN -t.qty_pcs ELSE 0 END), 0) AS today_out_pcs
  FROM products p
  JOIN warehouses w ON w.id = p.warehouse_id
  LEFT JOIN stock_transactions t ON t.product_id = p.id AND t.voided_at IS NULL
 GROUP BY p.id;
`;

const now = () => new Date().toISOString();
export const todayISO = () => now().slice(0, 10);

/** Pieces -> { cartons, pcs } using the product's current PCS/Carton rate. */
export function split(totalPcs, pcsPerCarton) {
  const rate = Math.max(1, Number(pcsPerCarton) || 1);
  const total = Math.trunc(Number(totalPcs) || 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  return {
    total_pcs: total,
    cartons: sign * Math.floor(abs / rate),
    pcs: sign * (abs % rate),
  };
}

/** Pieces the user typed (carton + pcs) are worth, at a given rate. */
export function toPcs(carton, pcs, pcsPerCarton) {
  const rate = Math.max(1, Number(pcsPerCarton) || 1);
  return Math.trunc(Number(carton) || 0) * rate + Math.trunc(Number(pcs) || 0);
}

export class Store {
  constructor(dbFile) {
    if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (dbFile !== ":memory:") this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); // keep the data folder tidy
    this.db.exec(SCHEMA);
    this.seedWarehouses();
  }

  seedWarehouses() {
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO warehouses (name, sort_order, created_at) VALUES (?, ?, ?)"
    );
    WAREHOUSE_NAMES.forEach((name, i) => ins.run(name, i + 1, now()));
  }

  /* ---------------- helpers ---------------- */

  warehouses() {
    return this.db
      .prepare("SELECT id, name, sort_order FROM warehouses ORDER BY sort_order, name")
      .all()
      .map((w) => ({ ...w }));
  }

  warehouseById(id) {
    return this.warehouses().find((w) => w.id === Number(id)) || null;
  }

  /** Live (non-voided) stock of one product, in pieces. */
  stockPcs(productId) {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(qty_pcs), 0) AS total
           FROM stock_transactions
          WHERE product_id = ? AND voided_at IS NULL`
      )
      .get(Number(productId));
    return Number(row?.total || 0);
  }

  /** Stock of one product ignoring a single transaction (used when editing it). */
  stockPcsExcluding(productId, transactionId) {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(qty_pcs), 0) AS total
           FROM stock_transactions
          WHERE product_id = ? AND voided_at IS NULL AND id <> ?`
      )
      .get(Number(productId), Number(transactionId));
    return Number(row?.total || 0);
  }

  productById(id) {
    const p = this.db
      .prepare(
        `SELECT p.*, w.name AS warehouse_name
           FROM products p JOIN warehouses w ON w.id = p.warehouse_id
          WHERE p.id = ?`
      )
      .get(Number(id));
    return p ? { ...p } : null;
  }

  /* ---------------- products ---------------- */

  listProducts({ warehouseId = 0, q = "" } = {}) {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.pcs_per_carton, p.image_path, p.created_at, p.updated_at,
                w.id AS warehouse_id, w.name AS warehouse_name,
                COALESCE(s.total_pcs, 0)      AS total_pcs,
                COALESCE(s.opening_pcs, 0)    AS opening_pcs,
                COALESCE(s.inbound_pcs, 0)    AS inbound_pcs,
                COALESCE(s.outbound_pcs, 0)   AS outbound_pcs,
                COALESCE(s.adjust_pcs, 0)     AS adjust_pcs,
                COALESCE(s.today_in_pcs, 0)   AS today_in_pcs,
                COALESCE(s.today_out_pcs, 0)  AS today_out_pcs,
                COALESCE(s.tx_count, 0)       AS tx_count
           FROM products p
           JOIN warehouses w ON w.id = p.warehouse_id
           LEFT JOIN (
                SELECT product_id,
                       SUM(qty_pcs) AS total_pcs,
                       SUM(CASE WHEN type = 'OPENING'  THEN qty_pcs ELSE 0 END) AS opening_pcs,
                       SUM(CASE WHEN type = 'INBOUND'  THEN qty_pcs ELSE 0 END) AS inbound_pcs,
                       SUM(CASE WHEN type = 'OUTBOUND' THEN -qty_pcs ELSE 0 END) AS outbound_pcs,
                       SUM(CASE WHEN type = 'ADJUSTMENT' THEN qty_pcs ELSE 0 END) AS adjust_pcs,
                       SUM(CASE WHEN type = 'INBOUND'  AND tx_date = @today THEN qty_pcs ELSE 0 END) AS today_in_pcs,
                       SUM(CASE WHEN type = 'OUTBOUND' AND tx_date = @today THEN -qty_pcs ELSE 0 END) AS today_out_pcs,
                       COUNT(*) AS tx_count
                  FROM stock_transactions
                 WHERE voided_at IS NULL
                 GROUP BY product_id
           ) s ON s.product_id = p.id
          WHERE (@wh = 0 OR p.warehouse_id = @wh)
            AND (@q = '' OR p.name LIKE '%' || @q || '%')
          ORDER BY p.name COLLATE NOCASE, p.id`
      )
      .all({ today: this.today, wh: Number(warehouseId) || 0, q: String(q || "").trim() });

    return rows.map((p) => this.decorateProduct(p));
  }

  decorateProduct(p) {
    const rate = Number(p.pcs_per_carton) || 1;
    return {
      id: p.id,
      name: p.name,
      warehouse_id: p.warehouse_id,
      warehouse_name: p.warehouse_name,
      pcs_per_carton: rate,
      image: p.image_path || null,
      created_at: p.created_at,
      updated_at: p.updated_at,
      tx_count: Number(p.tx_count || 0),
      stock: split(p.total_pcs, rate),
      opening: split(p.opening_pcs, rate),
      inbound_total: split(p.inbound_pcs, rate),
      outbound_total: split(p.outbound_pcs, rate),
      adjustment_total: split(p.adjust_pcs, rate),
      today_in: split(p.today_in_pcs, rate),
      today_out: split(p.today_out_pcs, rate),
    };
  }

  createProduct({ name, warehouseId, pcsPerCarton, imagePath, openingCarton = 0, openingPcs = 0, openingDate, openingNote }) {
    const wh = this.warehouseById(warehouseId);
    if (!wh) throw httpError(400, "Please choose a warehouse.");
    const cleanName = String(name || "").trim();
    if (!cleanName) throw httpError(400, "Product name is required.");
    const rate = Math.trunc(Number(pcsPerCarton));
    if (!Number.isFinite(rate) || rate < 1) throw httpError(400, "PCS per Cartoon must be 1 or more.");
    const oCarton = Math.trunc(Number(openingCarton) || 0);
    const oPcs = Math.trunc(Number(openingPcs) || 0);
    if (oCarton < 0 || oPcs < 0) throw httpError(400, "Opening stock cannot be negative.");

    const ts = now();
    const info = this.db
      .prepare(
        `INSERT INTO products (name, warehouse_id, pcs_per_carton, image_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(cleanName, wh.id, rate, imagePath || null, ts, ts);
    const productId = Number(info.lastInsertRowid);

    if (oCarton > 0 || oPcs > 0) {
      this.insertTransaction({
        productId,
        warehouseId: wh.id,
        type: TX_TYPES.OPENING,
        date: openingDate || this.today,
        carton: oCarton,
        pcs: oPcs,
        rate,
        note: openingNote || "Opening stock",
      });
    }
    return this.getProduct(productId);
  }

  getProduct(id) {
    const p = this.productById(id);
    if (!p) throw httpError(404, "Product not found.");
    const s = this.db
      .prepare(
        `SELECT COALESCE(SUM(qty_pcs), 0) AS total_pcs,
                COALESCE(SUM(CASE WHEN type='OPENING'  THEN qty_pcs ELSE 0 END), 0) AS opening_pcs,
                COALESCE(SUM(CASE WHEN type='INBOUND'  THEN qty_pcs ELSE 0 END), 0) AS inbound_pcs,
                COALESCE(SUM(CASE WHEN type='OUTBOUND' THEN -qty_pcs ELSE 0 END), 0) AS outbound_pcs,
                COALESCE(SUM(CASE WHEN type='ADJUSTMENT' THEN qty_pcs ELSE 0 END), 0) AS adjust_pcs,
                COALESCE(SUM(CASE WHEN type='INBOUND'  AND tx_date=@today THEN qty_pcs ELSE 0 END), 0) AS today_in_pcs,
                COALESCE(SUM(CASE WHEN type='OUTBOUND' AND tx_date=@today THEN -qty_pcs ELSE 0 END), 0) AS today_out_pcs,
                COUNT(*) AS tx_count
           FROM stock_transactions WHERE product_id = @pid AND voided_at IS NULL`
      )
      .get({ pid: Number(id), today: this.today });
    return this.decorateProduct({ ...p, ...s, warehouse_id: p.warehouse_id });
  }

  updateProduct(id, patch) {
    const before = this.productById(id);
    if (!before) throw httpError(404, "Product not found.");

    const name = patch.name !== undefined ? String(patch.name).trim() : before.name;
    if (!name) throw httpError(400, "Product name is required.");
    const rate = patch.pcsPerCarton !== undefined ? Math.trunc(Number(patch.pcsPerCarton)) : before.pcs_per_carton;
    if (!Number.isFinite(rate) || rate < 1) throw httpError(400, "PCS per Cartoon must be 1 or more.");
    const warehouseId = patch.warehouseId !== undefined ? Number(patch.warehouseId) : before.warehouse_id;
    const wh = this.warehouseById(warehouseId);
    if (!wh) throw httpError(400, "Please choose a warehouse.");
    const imagePath = patch.imagePath !== undefined ? patch.imagePath || null : before.image_path;

    const ts = now();
    this.db
      .prepare(
        `UPDATE products SET name = ?, warehouse_id = ?, pcs_per_carton = ?, image_path = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(name, wh.id, rate, imagePath, ts, Number(id));

    this.db
      .prepare(
        `INSERT INTO product_revisions (product_id, before_json, after_json, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(Number(id), JSON.stringify(before), JSON.stringify({ ...before, name, warehouse_id: wh.id, pcs_per_carton: rate, image_path: imagePath, updated_at: ts }), ts);

    // Moving a product between warehouses moves the stock with it, using two
    // linked TRANSFER rows. Existing history rows are never rewritten.
    const movedFrom = before.warehouse_id !== wh.id ? this.warehouseById(before.warehouse_id) : null;
    if (movedFrom) {
      const current = this.stockPcs(id);
      if (current !== 0) {
        const oldRate = before.pcs_per_carton;
        const cartons = Math.floor(Math.abs(current) / oldRate);
        const pieces = Math.abs(current) % oldRate;
        const sign = current > 0 ? 1 : -1;
        const date = patch.transferDate || this.today;
        this.insertTransaction({
          productId: Number(id), warehouseId: movedFrom.id, type: TX_TYPES.TRANSFER,
          date, carton: cartons, pcs: pieces, rate: oldRate, sign: -sign,
          note: `Warehouse transfer → ${wh.name}`,
        });
        this.insertTransaction({
          productId: Number(id), warehouseId: wh.id, type: TX_TYPES.TRANSFER,
          date, carton: cartons, pcs: pieces, rate, sign,
          note: `Warehouse transfer ← ${movedFrom.name}`,
        });
      }
    }
    return this.getProduct(id);
  }

  /* ---------------- transactions ---------------- */

  insertTransaction({ productId, warehouseId, type, date, carton, pcs, rate, note = "", sign = 1 }) {
    const qty = toPcs(carton, pcs, rate) * sign;
    const ts = now();
    const info = this.db
      .prepare(
        `INSERT INTO stock_transactions
           (product_id, warehouse_id, type, tx_date, carton, pcs, pcs_per_carton, qty_pcs, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(productId), Number(warehouseId), type, date,
        Math.trunc(Number(carton) || 0), Math.trunc(Number(pcs) || 0),
        Math.max(1, Number(rate) || 1), qty, String(note || "").slice(0, 500), ts, ts
      );
    return Number(info.lastInsertRowid);
  }

  /**
   * Record a movement. `type` decides the direction:
   *   INBOUND / OPENING            -> always positive
   *   OUTBOUND                     -> always negative (blocked if stock would go below 0)
   *   ADJUSTMENT / TRANSFER        -> sign decides
   */
  addTransaction({ productId, type, date, carton = 0, pcs = 0, note = "", warehouseId = null, sign = 1 }) {
    const product = this.productById(productId);
    if (!product) throw httpError(404, "Product not found.");
    if (!Object.values(TX_TYPES).includes(type)) throw httpError(400, "Unknown transaction type.");

    const c = Math.trunc(Number(carton) || 0);
    const p = Math.trunc(Number(pcs) || 0);
    if (c < 0 || p < 0) throw httpError(400, "Carton and PCS values cannot be negative.");
    if (c === 0 && p === 0) throw httpError(400, "Enter a quantity in Cartoon or PCS.");

    const rate = product.pcs_per_carton;
    const d = validDate(date) ? date : this.today;
    const whId = warehouseId ? Number(warehouseId) : product.warehouse_id;
    if (!this.warehouseById(whId)) throw httpError(400, "Warehouse not found.");

    const effectiveSign = type === TX_TYPES.OUTBOUND ? -1 : type === TX_TYPES.INBOUND || type === TX_TYPES.OPENING ? 1 : (sign < 0 ? -1 : 1);
    const qty = toPcs(c, p, rate) * effectiveSign;

    if (qty < 0) {
      const available = this.stockPcs(productId);
      if (available + qty < 0) {
        const err = httpError(409, "Insufficient stock.");
        err.detail = {
          available: split(available, rate),
          requested: split(Math.abs(qty), rate),
          available_pcs: available,
          requested_pcs: Math.abs(qty),
        };
        throw err;
      }
    }

    const id = this.insertTransaction({
      productId, warehouseId: whId, type, date: d, carton: c, pcs: p, rate, note, sign: effectiveSign,
    });
    return this.getTransaction(id);
  }

  getTransaction(id) {
    const t = this.db
      .prepare(
        `SELECT t.*, p.name AS product_name, p.pcs_per_carton AS product_rate, p.image_path,
                w.name AS warehouse_name
           FROM stock_transactions t
           JOIN products p   ON p.id = t.product_id
           JOIN warehouses w ON w.id = t.warehouse_id
          WHERE t.id = ?`
      )
      .get(Number(id));
    return t ? decorateTx(t) : null;
  }

  listTransactions({ from = "", to = "", warehouseId = 0, productId = 0, type = "", q = "", includeVoided = true, limit = 1000, offset = 0 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT t.*, p.name AS product_name, p.pcs_per_carton AS product_rate, p.image_path,
                w.name AS warehouse_name
           FROM stock_transactions t
           JOIN products p   ON p.id = t.product_id
           JOIN warehouses w ON w.id = t.warehouse_id
          WHERE (@from = '' OR t.tx_date >= @from)
            AND (@to   = '' OR t.tx_date <= @to)
            AND (@wh   =  0 OR t.warehouse_id = @wh)
            AND (@prod =  0 OR t.product_id = @prod)
            AND (@type = '' OR t.type = @type)
            AND (@q    = '' OR p.name LIKE '%' || @q || '%' OR COALESCE(t.note,'') LIKE '%' || @q || '%')
            AND (@voided = 1 OR t.voided_at IS NULL)
          ORDER BY t.tx_date DESC, t.id DESC
          LIMIT @limit OFFSET @offset`
      )
      .all({
        from: String(from || ""), to: String(to || ""),
        wh: Number(warehouseId) || 0, prod: Number(productId) || 0,
        type: String(type || ""), q: String(q || "").trim(),
        voided: includeVoided ? 1 : 0,
        limit: Math.min(Math.max(Number(limit) || 1000, 1), 5000),
        offset: Math.max(Number(offset) || 0, 0),
      });
    return rows.map(decorateTx);
  }

  /** Correct a transaction. The previous values are kept in transaction_revisions. */
  updateTransaction(id, { date, carton, pcs, note, reason = "" }) {
    const before = this.db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(Number(id));
    if (!before) throw httpError(404, "Transaction not found.");
    if (before.voided_at) throw httpError(400, "This transaction is cancelled and can no longer be edited.");

    const product = this.productById(before.product_id);
    const rate = Number(before.pcs_per_carton) || product?.pcs_per_carton || 1;
    const c = carton === undefined ? before.carton : Math.trunc(Number(carton) || 0);
    const p = pcs === undefined ? before.pcs : Math.trunc(Number(pcs) || 0);
    if (c < 0 || p < 0) throw httpError(400, "Carton and PCS values cannot be negative.");
    const d = date === undefined ? before.tx_date : (validDate(date) ? date : (() => { throw httpError(400, "Invalid date."); })());
    const newNote = note === undefined ? before.note : String(note || "").slice(0, 500);

    const sign = before.type === TX_TYPES.OUTBOUND ? -1 : before.type === TX_TYPES.INBOUND || before.type === TX_TYPES.OPENING ? 1 : Math.sign(before.qty_pcs) || 1;
    const qty = toPcs(c, p, rate) * sign;

    if (qty < 0) {
      const others = this.stockPcsExcluding(before.product_id, id);
      if (others + qty < 0) {
        const err = httpError(409, "Insufficient stock.");
        err.detail = { available: split(others, rate), requested: split(Math.abs(qty), rate), available_pcs: others, requested_pcs: Math.abs(qty) };
        throw err;
      }
    }

    const ts = now();
    const after = { ...before, tx_date: d, carton: c, pcs: p, qty_pcs: qty, note: newNote, updated_at: ts };
    this.db
      .prepare(
        `UPDATE stock_transactions SET tx_date = ?, carton = ?, pcs = ?, qty_pcs = ?, note = ?, updated_at = ? WHERE id = ?`
      )
      .run(d, c, p, qty, newNote, ts, Number(id));
    this.db
      .prepare(
        `INSERT INTO transaction_revisions (transaction_id, action, before_json, after_json, reason, created_at)
         VALUES (?, 'EDIT', ?, ?, ?, ?)`
      )
      .run(Number(id), JSON.stringify(before), JSON.stringify(after), String(reason || "Corrected by user"), ts);

    return this.getTransaction(id);
  }

  /** Cancel a transaction (soft delete). Stock is recalculated without it. */
  voidTransaction(id, reason = "") {
    const before = this.db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(Number(id));
    if (!before) throw httpError(404, "Transaction not found.");
    if (before.voided_at) throw httpError(400, "This transaction is already cancelled.");
    if (before.type === TX_TYPES.OPENING) {
      // allowed, but the product's opening stock disappears -> guard against negative
    }
    const rest = this.stockPcsExcluding(before.product_id, id);
    if (rest < 0) throw httpError(409, "Insufficient stock.", { remaining: split(rest, before.pcs_per_carton) });

    const ts = now();
    this.db
      .prepare("UPDATE stock_transactions SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?")
      .run(ts, String(reason || "Cancelled by user").slice(0, 300), ts, Number(id));
    this.db
      .prepare(
        `INSERT INTO transaction_revisions (transaction_id, action, before_json, after_json, reason, created_at)
         VALUES (?, 'VOID', ?, NULL, ?, ?)`
      )
      .run(Number(id), JSON.stringify(before), String(reason || "Cancelled by user"), ts);
    return this.getTransaction(id);
  }

  restoreTransaction(id) {
    const before = this.db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(Number(id));
    if (!before) throw httpError(404, "Transaction not found.");
    if (!before.voided_at) throw httpError(400, "This transaction is not cancelled.");
    if (before.qty_pcs < 0) {
      const available = this.stockPcs(before.product_id);
      if (available + before.qty_pcs < 0) throw httpError(409, "Insufficient stock.");
    }
    const ts = now();
    this.db
      .prepare("UPDATE stock_transactions SET voided_at = NULL, void_reason = NULL, updated_at = ? WHERE id = ?")
      .run(ts, Number(id));
    this.db
      .prepare(
        `INSERT INTO transaction_revisions (transaction_id, action, before_json, after_json, reason, created_at)
         VALUES (?, 'RESTORE', ?, NULL, 'Restored', ?)`
      )
      .run(Number(id), JSON.stringify(before), ts);
    return this.getTransaction(id);
  }

  revisions(transactionId) {
    return this.db
      .prepare("SELECT * FROM transaction_revisions WHERE transaction_id = ? ORDER BY id DESC")
      .all(Number(transactionId))
      .map((r) => ({ ...r, before: safeJson(r.before_json), after: safeJson(r.after_json) }));
  }

  /* ---------------- dashboard ---------------- */

  summary({ warehouseId = 0, today = null } = {}) {
    const day = validDate(today) ? today : this.today;
    const wh = Number(warehouseId) || 0;
    // Warehouse rows are always complete (all three), so the dashboard can keep
    // showing every warehouse card. `totals` reflects the requested scope.
    const rows = this.db
      .prepare(
        `SELECT w.id, w.name, w.sort_order,
                COUNT(DISTINCT p.id) AS products,
                COALESCE(SUM(CASE WHEN t.voided_at IS NULL THEN t.qty_pcs END), 0) AS total_pcs,
                COALESCE(SUM(CASE WHEN t.voided_at IS NULL AND t.type='OPENING' THEN t.qty_pcs END), 0) AS opening_pcs,
                COALESCE(SUM(CASE WHEN t.voided_at IS NULL AND t.type='INBOUND' THEN t.qty_pcs END), 0) AS inbound_pcs,
                COALESCE(SUM(CASE WHEN t.voided_at IS NULL AND t.type='OUTBOUND' THEN -t.qty_pcs END), 0) AS outbound_pcs,
                COALESCE(SUM(CASE WHEN t.voided_at IS NULL AND t.type='INBOUND'  AND t.tx_date=@day THEN t.qty_pcs END), 0) AS today_in_pcs,
                COALESCE(SUM(CASE WHEN t.voided_at IS NULL AND t.type='OUTBOUND' AND t.tx_date=@day THEN -t.qty_pcs END), 0) AS today_out_pcs,
                COALESCE(SUM(CASE WHEN t.voided_at IS NULL AND t.tx_date=@day THEN 1 ELSE 0 END), 0) AS today_tx
           FROM warehouses w
           LEFT JOIN products p ON p.warehouse_id = w.id
           LEFT JOIN stock_transactions t
                  ON t.product_id = p.id AND t.warehouse_id = w.id
          GROUP BY w.id
          ORDER BY w.sort_order, w.name`
      )
      .all({ day });

    const perWarehouse = rows.map((r) => {
      // Cartons are only meaningful per product rate, so split each product's
      // stock with its own PCS/Carton value and add the results up.
      const products = this.db
        .prepare(
          `SELECT p.id, p.pcs_per_carton,
                  COALESCE((SELECT SUM(t.qty_pcs) FROM stock_transactions t
                             WHERE t.product_id = p.id AND t.voided_at IS NULL), 0) AS stock_pcs
             FROM products p WHERE p.warehouse_id = ?`
        )
        .all(r.id);
      let cartons = 0, pieces = 0;
      for (const p of products) {
        const s = split(p.stock_pcs, p.pcs_per_carton);
        cartons += s.cartons;
        pieces += s.pcs;
      }
      return {
        id: r.id,
        name: r.name,
        products: Number(r.products || 0),
        total_pcs: Number(r.total_pcs || 0),
        cartons, pieces,
        opening_pcs: Number(r.opening_pcs || 0),
        inbound_pcs: Number(r.inbound_pcs || 0),
        outbound_pcs: Number(r.outbound_pcs || 0),
        today_in_pcs: Number(r.today_in_pcs || 0),
        today_out_pcs: Number(r.today_out_pcs || 0),
        today_tx: Number(r.today_tx || 0),
      };
    });

    const grand = perWarehouse.reduce(
      (a, w) => ({
        products: a.products + w.products,
        total_pcs: a.total_pcs + w.total_pcs,
        cartons: a.cartons + w.cartons,
        pieces: a.pieces + w.pieces,
        opening_pcs: a.opening_pcs + w.opening_pcs,
        inbound_pcs: a.inbound_pcs + w.inbound_pcs,
        outbound_pcs: a.outbound_pcs + w.outbound_pcs,
        today_in_pcs: a.today_in_pcs + w.today_in_pcs,
        today_out_pcs: a.today_out_pcs + w.today_out_pcs,
        today_tx: a.today_tx + w.today_tx,
      }),
      { products: 0, total_pcs: 0, cartons: 0, pieces: 0, opening_pcs: 0, inbound_pcs: 0, outbound_pcs: 0, today_in_pcs: 0, today_out_pcs: 0, today_tx: 0 }
    );

    const scoped = wh ? perWarehouse.find((w) => w.id === wh) : null;
    const totals = scoped ? { ...scoped } : { ...grand };

    return { date: day, warehouses: perWarehouse, totals, grand_totals: grand, scope: wh };
  }

  set today(d) { this._today = validDate(d) ? d : todayISO(); }
  get today() { return this._today || todayISO(); }
}

/* ---------------- small utilities ---------------- */

export function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function decorateTx(t) {
  const rate = Number(t.pcs_per_carton) || 1;
  const abs = Math.abs(Number(t.qty_pcs) || 0);
  return {
    id: t.id,
    product_id: t.product_id,
    product_name: t.product_name,
    product_image: t.image_path || null,
    product_rate: Number(t.product_rate) || rate,
    warehouse_id: t.warehouse_id,
    warehouse_name: t.warehouse_name,
    type: t.type,
    date: t.tx_date,
    carton: Number(t.carton) || 0,
    pcs: Number(t.pcs) || 0,
    pcs_per_carton: rate,
    qty_pcs: Number(t.qty_pcs) || 0,
    abs_pcs: abs,
    total: split(abs, rate),
    note: t.note || "",
    voided: !!t.voided_at,
    voided_at: t.voided_at || null,
    void_reason: t.void_reason || null,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

export function httpError(status, message, detail) {
  const e = new Error(message);
  e.status = status;
  if (detail) e.detail = detail;
  return e;
}
