# StockBook — Inventory Adjustment & Warehouse Management

A fast, simple web app for tracking stock across **exactly three warehouses**:

**AKASHARWDI · TABLE 1 · CHAIR**

Add a product → pick its warehouse → set the opening stock → record daily
inbound / outbound in **Cartoon and/or PCS** → current stock is maintained
automatically → everything stays in a permanent, filterable history.

No accounting, no billing, no GST, no employees, no purchase orders — just
stock. Built for speed and for someone with basic computer knowledge.

---

## Run it

Requires **Node.js 22.5+** (uses the built-in SQLite module — **zero npm
dependencies**, nothing to install):

```bash
npm start          # → http://localhost:3000
```

Other commands:

```bash
npm run seed       # optional demo products + transactions (only if the DB is empty)
npm run seed -- --force
npm run reset      # wipe all products/transactions/images (keeps the 3 warehouses)
npm test           # 19 API + business-rule tests (node:test)
npm run dev        # auto-restart the server on file changes
PORT=8080 npm start
```

Data lives in `data/inventory.db` (SQLite, WAL mode) and `data/uploads/`
(product images). Both are git-ignored and survive page refreshes and server
restarts.

---

## Features

| Area | What you get |
| --- | --- |
| **Dashboard** | Total Products · Total Stock · Today's Inbound · Today's Outbound · Current Stock, three clickable warehouse cards, warehouse-wise stock summary, recent transactions, quick actions |
| **Warehouses** | Fixed set of three. Switch scope from the top bar chips, or click a warehouse card to open only its inventory |
| **Add Product** | Product Name · PCS per Cartoon · Opening Stock (Cartoon **and** PCS) · Warehouse · Product Image — that's all |
| **Inventory** | Image thumbnail, name, warehouse, PCS/Carton, current stock in Cartoon, current stock in PCS, total stock in PCS, opening stock, today's inbound, today's outbound, plus Inbound / Outbound / Adjust / History / Edit buttons on every row |
| **Daily Inbound** | Date (today by default, editable), PCS, Cartoon, optional note. Saving increases stock immediately |
| **Daily Outbound** | Same fields. Saving decreases stock — and is **blocked before it can go negative** with a clear “Insufficient stock.” warning |
| **Adjustments** | Add or remove stock for damage / counting corrections, with a note |
| **History** | Filter by date range, warehouse, product, type (Inbound / Outbound / Opening / Adjustment / Transfer) and free text. Correct or cancel any entry (with confirmation) — cancelled rows stay visible, nothing is erased. CSV export |
| **Search** | Instant product search on Inventory / Inbound / Outbound; keeps the caret while you type |
| **Images** | Thumbnails in every list, click for a large preview. Uploads are resized in the browser (max 900 px) and stored on the server |
| **UI** | Clean white interface, large buttons, readable tables on desktop, card layout + bottom tab bar + slide-in menu on mobile, no heavy animations |

---

## PCS ⇄ Cartoon logic

Every product stores its own **PCS per Carton** rate. Quantities are always
recorded exactly as typed (`carton` and `pcs` columns) and converted to a
single signed piece total:

```
qty_pcs = carton × pcs_per_carton + pcs        (negative for outbound)
```

So with `1 Carton = 24 PCS`:

```
5 Carton + 10 PCS  →  130 PCS stored
displayed back as  →  5 ctn + 10 pcs
```

You never have to convert anything yourself. Sell 7 loose PCS first, then
3 whole cartons later — the system handles mixed units in any order:

```
130 PCS  −7 PCS   → 123 PCS  =  5 ctn + 3 pcs
123 PCS  −72 PCS  →  51 PCS  =  2 ctn + 3 pcs
```

**Current stock = Opening + Inbound − Outbound (+/− Adjustments, Transfers)**
and it is *always* recalculated from the transaction log — never stored as a
mutable number that could drift.

Display splits use the product's **current** rate, while each transaction keeps
the rate it was entered with. So changing PCS/Carton from 24 → 12 leaves the
piece total untouched and simply re-splits the display; old entries are never
rewritten.

---

## Data model

```
warehouses            id, name, sort_order, created_at
products              id, name, warehouse_id, pcs_per_carton, image_path, created_at, updated_at
stock_transactions    id, product_id, warehouse_id, type, tx_date,
                      carton, pcs, pcs_per_carton (rate snapshot),
                      qty_pcs (signed), note, voided_at, void_reason,
                      created_at, updated_at
transaction_revisions id, transaction_id, action (EDIT|VOID|RESTORE),
                      before_json, after_json, reason, created_at
product_revisions     id, product_id, before_json, after_json, created_at
product_stock (VIEW)  live stock per product, derived from stock_transactions
```

`type` is one of `OPENING`, `INBOUND`, `OUTBOUND`, `ADJUSTMENT`, `TRANSFER`.

History rules:

* Deleting an entry **cancels** it (`voided_at`) — the row stays in the table,
  marked “Cancelled”, and can be restored.
* Correcting an entry writes the previous values to `transaction_revisions`.
* Editing a product writes the previous values to `product_revisions`, and
  changing its warehouse moves the stock with **two linked `TRANSFER` rows**
  (−qty from the old warehouse, +qty to the new one) instead of touching
  existing history.
* Outbound, corrections, cancels and restores are all rejected with
  `409 Insufficient stock.` if they would push a product below zero — checked
  on the server, not just in the browser.

---

## Project structure

```
index.html            app shell: sidebar, top bar, views, modal/confirm/lightbox/toast
css/styles.css        all styling, plain CSS, mobile-first
js/core.js            helpers, icons, API client, state, modal/toast/lightbox
js/views.js           dashboard, inventory, inbound, outbound, history renderers
js/app.js             routing, event handling, product / movement / correction forms
server/db.js          SQLite schema + all stock maths (Store)
server/server.js      zero-dependency HTTP server: static files + JSON API
scripts/seed.js       optional demo data
scripts/reset.js      wipe inventory data
tests/api.test.js     business-rule tests
supabase/schema.sql   equivalent PostgreSQL/Supabase schema (optional migration)
assets/demo/          demo product photos used by scripts/seed.js
data/                 SQLite database + uploaded images (git-ignored, created at runtime)
```

---

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | server + database check |
| GET | `/api/bootstrap?warehouse_id&today` | warehouses, products with live stock, summary, recent + today's transactions |
| GET | `/api/products?warehouse_id&q` | product list |
| POST | `/api/products` | create product (+ optional opening stock and image) |
| GET / PATCH | `/api/products/:id` | read / edit name, rate, image, warehouse |
| GET | `/api/transactions?from&to&warehouse_id&product_id&type&q&limit&offset` | history + totals |
| POST | `/api/transactions` | record `{product_id, type, date, carton, pcs, note, sign}` |
| PATCH | `/api/transactions/:id` | correct an entry (keeps a revision) |
| DELETE | `/api/transactions/:id?reason=` | cancel an entry (soft delete) |
| POST | `/api/transactions/:id/restore` | restore a cancelled entry |
| GET | `/api/transactions/:id/revisions` | audit trail for one entry |
| GET | `/api/summary?warehouse_id&today` | dashboard numbers |
| GET | `/api/export/transactions.csv?...` | CSV download of the current filters |

Errors return `{ "error": "message", "detail": {...} }`; insufficient stock is
`409` with `detail.available_pcs` / `detail.requested_pcs`.

---

## Moving to Supabase (optional)

The bundled SQLite database is a real, persistent database and needs no setup.
If you would rather host the data in Supabase/Postgres, run
[`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor — it
creates the same tables, the `product_stock` / `warehouse_stock` views and a
trigger that blocks negative stock at the database level.

---

## Notes

* The three warehouses are seeded automatically on first start and cannot be
  added to or removed from — by design.
* “Today” is taken from your browser's clock and sent with each request, so
  daily figures are correct in any time zone.
* Single-machine, single-team tool: there is no login. Put it behind your own
  reverse proxy/auth if it is exposed to the internet.
* This repository previously held the *RoadBook transport tracker*; it lives on
  in git history (commit `8fda005`).
