/* ============================================================
   StockBook — wipe all inventory data (keeps the 3 warehouses)

   npm run reset            → asks for confirmation
   npm run reset -- --yes   → no prompt

   Safe to run while the app is running: rows are deleted in the
   live SQLite database and uploaded images are removed from disk.
   ============================================================ */
"use strict";

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Store } from "../server/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_FILE = process.env.DB_FILE || path.join(ROOT, "data", "inventory.db");
const UPLOAD_DIR = path.join(ROOT, "data", "uploads");
const yes = process.argv.includes("--yes");

function wipe() {
  const store = new Store(DB_FILE);
  globalThis.__store = store; // keep the handle alive until we are done
  const names = store.warehouses().map((w) => w.name);
  const counts = {
    transactions: store.db.prepare("SELECT COUNT(*) c FROM stock_transactions").get().c,
    products: store.db.prepare("SELECT COUNT(*) c FROM products").get().c,
  };
  store.db.exec(`
    DELETE FROM transaction_revisions;
    DELETE FROM product_revisions;
    DELETE FROM stock_transactions;
    DELETE FROM products;
    DELETE FROM sqlite_sequence WHERE name IN ('products','stock_transactions','transaction_revisions','product_revisions');
  `);
  let files = 0;
  if (fs.existsSync(UPLOAD_DIR)) {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
      files++;
    }
  }
  console.log(`\nDeleted ${counts.products} product(s), ${counts.transactions} transaction(s) and ${files} image(s).`);
  console.log(`Warehouses kept: ${names.join(" | ")}`);
  if (typeof store.close === "function") store.close();
  console.log("Optional demo data: npm run seed\n");
}

if (yes) wipe();
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("This permanently deletes ALL products, stock and transactions. Type DELETE to continue: ", (a) => {
    rl.close();
    if (a.trim() === "DELETE") wipe();
    else console.log("Cancelled — nothing was deleted.");
  });
}
