/* ============================================================
   StockBook — optional demo data

   npm run seed            → adds sample products (only if the DB is empty)
   npm run seed -- --force → adds them anyway

   Uses the same Store as the server, so it works while the app is stopped.
   ============================================================ */
"use strict";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, TX_TYPES } from "../server/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_FILE || path.join(path.resolve(__dirname, ".."), "data", "inventory.db");
const force = process.argv.includes("--force");

const store = new Store(DB_FILE);
globalThis.__store = store; // keep the handle alive for the whole script
store.today = new Date().toISOString().slice(0, 10);

const existing = store.listProducts({}).length;
if (existing && !force) {
  console.log(`Database already has ${existing} product(s). Use \`npm run seed -- --force\` to add demo data anyway.`);
  process.exit(0);
}

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const [AKASHARWDI, TABLE1, CHAIR] = store.warehouses();

const DEMO = [
  { name: "Steel Tumbler 250ml", wh: AKASHARWDI, rate: 24, open: [10, 20], image: "/assets/demo/steel-tumbler.jpg", moves: [
    { type: "INBOUND", day: 2, carton: 5, pcs: 0, note: "Received from production" },
    { type: "OUTBOUND", day: 1, carton: 2, pcs: 6, note: "Dispatched — Sharma traders" },
    { type: "OUTBOUND", day: 0, carton: 1, pcs: 4, note: "Counter sale" },
  ]},
  { name: "Glass Water Bottle 1L", wh: AKASHARWDI, rate: 12, open: [6, 4], moves: [
    { type: "INBOUND", day: 3, carton: 4, pcs: 0, note: "Purchase invoice 8841" },
    { type: "OUTBOUND", day: 0, carton: 0, pcs: 9, note: "Retail pieces" },
  ]},
  { name: "Dining Table Top 4ft", wh: TABLE1, rate: 1, open: [40, 0], image: "/assets/demo/table-top.jpg", moves: [
    { type: "INBOUND", day: 4, carton: 15, pcs: 0, note: "New batch" },
    { type: "OUTBOUND", day: 2, carton: 8, pcs: 0, note: "Order #2211" },
    { type: "OUTBOUND", day: 1, carton: 5, pcs: 0, note: "Order #2214" },
  ]},
  { name: "Table Leg Set (4 pcs)", wh: TABLE1, rate: 4, open: [12, 2], moves: [
    { type: "INBOUND", day: 1, carton: 6, pcs: 2, note: "Received" },
    { type: "OUTBOUND", day: 0, carton: 3, pcs: 1, note: "Assembly line" },
  ]},
  { name: "Office Chair Base", wh: CHAIR, rate: 10, open: [25, 5], image: "/assets/demo/chair-base.jpg", moves: [
    { type: "INBOUND", day: 5, carton: 10, pcs: 0, note: "Supplier delivery" },
    { type: "OUTBOUND", day: 3, carton: 6, pcs: 3, note: "Dispatched" },
    { type: "ADJUSTMENT", day: 2, carton: 0, pcs: 2, note: "Damaged in handling", sign: -1 },
  ]},
  { name: "Chair Cushion Foam", wh: CHAIR, rate: 20, open: [8, 0], moves: [
    { type: "INBOUND", day: 0, carton: 3, pcs: 10, note: "Today's inward" },
    { type: "OUTBOUND", day: 0, carton: 1, pcs: 5, note: "Today's outward" },
  ]},
];

let created = 0, moves = 0;
for (const d of DEMO) {
  const product = store.createProduct({
    name: d.name, warehouseId: d.wh.id, pcsPerCarton: d.rate, imagePath: d.image || null,
    openingCarton: d.open[0], openingPcs: d.open[1], openingDate: daysAgo(6),
  });
  created++;
  for (const m of d.moves) {
    store.addTransaction({
      productId: product.id, type: TX_TYPES[m.type], date: daysAgo(m.day),
      carton: m.carton, pcs: m.pcs, note: m.note, sign: m.sign || 1,
    });
    moves++;
  }
}

console.log(`\nSeeded ${created} products and ${moves} transactions into ${DB_FILE}`);
for (const p of store.listProducts({})) {
  console.log(`  ${p.warehouse_name.padEnd(11)} ${p.name.padEnd(24)} ${String(p.stock.cartons).padStart(4)} ctn + ${String(p.stock.pcs).padStart(3)} pcs  = ${String(p.stock.total_pcs).padStart(5)} PCS`);
}
if (typeof store.close === "function") store.close();
console.log("\nStart the app with: npm start\n");
