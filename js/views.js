/* ============================================================
   StockBook — views (pure render functions, no side effects)
   Every clickable element uses data-action="…" and is handled
   by the single delegated listener in app.js.
   ============================================================ */
"use strict";

/* ---------------- shared bits ---------------- */

function emptyState({ icon: ic = "box", title, text, action = "" }) {
  return `<div class="empty">
    <div class="ico">${icon(ic)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
    ${action}
  </div>`;
}

function statCard({ label, value, sub = "", ic = "box", tone = "", title = "" }) {
  return `<div class="stat ${tone}" ${title ? `title="${esc(title)}"` : ""}>
    <div class="stat-top"><span class="stat-ico">${icon(ic)}</span><span class="stat-label">${esc(label)}</span></div>
    <div class="stat-value">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
  </div>`;
}

function scopeNote() {
  return state.warehouseId
    ? `in <b>${esc(warehouseName(state.warehouseId))}</b>`
    : `across all ${state.warehouses.length} warehouses`;
}

/* ---------------- DASHBOARD ---------------- */

function renderDashboard() {
  const s = state.summary;
  if (!s) return emptyState({ icon: "clock", title: "Loading dashboard…", text: "Fetching stock from the database." });

  const t = s.totals;                       // numbers for the selected scope
  const g = s.grand_totals || s.totals;     // numbers for all three warehouses

  const stats = `<div class="stats">
    ${statCard({
      label: "Total Products", ic: "boxes",
      value: num(t.products),
      sub: scopeNote(),
    })}
    ${statCard({
      label: "Total Stock", ic: "total",
      value: `${num(t.total_pcs)} <small>PCS</small>`,
      sub: `${num(t.cartons)} cartons + ${num(t.pieces)} loose pcs on hand`,
    })}
    ${(() => {
      const tin = todaySplit("in"), tout = todaySplit("out");
      return `
    ${statCard({
      label: "Today's Inbound", ic: "down", tone: "is-in",
      value: `${num(t.today_in_pcs)} <small>PCS</small>`,
      sub: `${num(tin.cartons)} cartons + ${num(tin.pcs)} loose pcs · ${fmtDate(s.date)}`,
    })}
    ${statCard({
      label: "Today's Outbound", ic: "up", tone: "is-out",
      value: `${num(t.today_out_pcs)} <small>PCS</small>`,
      sub: `${num(tout.cartons)} cartons + ${num(tout.pcs)} loose pcs · ${fmtDate(s.date)}`,
    })}`;
    })()}
    ${statCard({
      label: "Current Stock", ic: "box", tone: "is-brand",
      value: `${num(t.cartons)} <small>ctn</small> + ${num(t.pieces)} <small>loose pcs</small>`,
      sub: `<b>${num(t.total_pcs)} PCS</b> = Opening ${num(t.opening_pcs)} + In ${num(t.inbound_pcs)} − Out ${num(t.outbound_pcs)}`,
      title: "Cartons are counted per product — each product has its own PCS/Carton rate. Total PCS is the single comparable figure.",
    })}
  </div>`;

  const cards = `<div class="wh-grid">${s.warehouses.map((w) => `
    <button class="wh-card ${state.warehouseId === w.id ? "is-active" : ""}" data-action="open-warehouse" data-id="${w.id}"
            title="Show only ${esc(w.name)} inventory">
      <span class="wh-card-top">
        <span class="wh-ico">${icon("warehouse")}</span>
        <span>
          <span class="wh-name">${esc(w.name)}</span>
          <span class="wh-meta">${num(w.products)} product${w.products === 1 ? "" : "s"}</span>
        </span>
      </span>
      <span class="wh-stock">
        <b>${num(w.total_pcs)} <small>PCS</small></b>
        <span>${num(w.cartons)} cartons + ${num(w.pieces)} loose pcs on hand</span>
      </span>
      <span class="wh-today">
        <span class="wh-pill in">↓ Today in ${num(w.today_in_pcs)}</span>
        <span class="wh-pill out">↑ Today out ${num(w.today_out_pcs)}</span>
      </span>
      <span class="wh-open">Open inventory ${icon("total")}</span>
    </button>`).join("")}
  </div>`;

  const summaryRows = s.warehouses.map((w) => `
    <tr class="${state.warehouseId === w.id ? "is-scope" : ""}">
      <td><span class="wh-tag">${esc(w.name)}</span></td>
      <td class="num">${num(w.products)}</td>
      <td class="num">${num(w.opening_pcs)}</td>
      <td class="num" style="color:var(--green)">${num(w.inbound_pcs)}</td>
      <td class="num" style="color:var(--red)">${num(w.outbound_pcs)}</td>
      <td class="num">${num(w.today_in_pcs)}</td>
      <td class="num">${num(w.today_out_pcs)}</td>
      <td class="num"><span class="stock-strong">${num(w.cartons)} ctn + ${num(w.pieces)} loose</span></td>
      <td class="num"><span class="big-num">${num(w.total_pcs)}</span></td>
    </tr>`).join("");

  const summaryTable = `<div class="panel">
    <div class="panel-head">
      <h3>Warehouse-wise stock summary</h3>
      <span class="hint">${state.warehouseId
        ? `The cards above show <b>${esc(scopeName())}</b> · this table always lists all three warehouses`
        : "Recalculated live from the transaction history"}</span>
      <div class="right">
        <button class="btn sm ghost" data-action="goto" data-view="history">${icon("history")} Full history</button>
      </div>
    </div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>
          <th>Warehouse</th><th class="num">Products</th><th class="num" title="Opening stock in pieces">Opening</th>
          <th class="num" title="All inbound to date, in pieces">Inbound</th><th class="num" title="All outbound to date, in pieces">Outbound</th>
          <th class="num">Today In</th><th class="num">Today Out</th>
          <th class="num" title="Cartons are counted per product; each product has its own PCS/Carton rate">Current Stock</th>
          <th class="num" title="Total pieces on hand — the comparable figure">Total PCS</th>
        </tr></thead>
        <tbody>${summaryRows || `<tr><td colspan="9" class="center">No warehouses yet</td></tr>`}
        <tr style="background:#fafbfd;font-weight:800">
          <td>TOTAL${state.warehouseId ? " (all warehouses)" : ""}</td>
          <td class="num">${num(g.products)}</td><td class="num">${num(g.opening_pcs)}</td>
          <td class="num" style="color:var(--green)">${num(g.inbound_pcs)}</td>
          <td class="num" style="color:var(--red)">${num(g.outbound_pcs)}</td>
          <td class="num">${num(g.today_in_pcs)}</td><td class="num">${num(g.today_out_pcs)}</td>
          <td class="num">${num(g.cartons)} ctn + ${num(g.pieces)} loose</td>
          <td class="num">${num(g.total_pcs)}</td>
        </tr></tbody>
      </table>
    </div>
  </div>`;

  const quick = `<div class="panel">
    <div class="panel-head">
      <h3>Quick actions</h3>
      <span class="hint">Add Product → Select Warehouse → Opening Stock → Daily Inbound / Outbound</span>
    </div>
    <div class="panel-body" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn primary lg" data-action="add-product">${icon("plus")} Add Product</button>
      <button class="btn solid-in lg" data-action="goto" data-view="inbound">${icon("down")} Record Inbound</button>
      <button class="btn solid-out lg" data-action="goto" data-view="outbound">${icon("up")} Record Outbound</button>
      <button class="btn lg" data-action="goto" data-view="inventory">${icon("box")} View Inventory</button>
    </div>
  </div>`;

  const recent = `<div class="panel">
    <div class="panel-head">
      <h3>Recent transactions</h3>
      <span class="hint">Latest ${state.recent.length} entries</span>
      <div class="right"><button class="btn sm ghost" data-action="goto" data-view="history">View all ${icon("total")}</button></div>
    </div>
    ${state.recent.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Product</th><th>Warehouse</th><th>Type</th><th class="num">Cartoon</th><th class="num">PCS</th><th class="num">Total PCS</th><th>Note</th><th class="center">Actions</th></tr></thead>
      <tbody>${state.recent.map(txRow).join("")}</tbody>
    </table></div>` : emptyState({ icon: "clock", title: "No transactions yet", text: "Add a product with an opening stock, then record daily inbound and outbound." })}
  </div>`;

  return `${stats}
    <div class="section-title"><h2>Warehouses</h2><span class="hint">Click a warehouse to see only its inventory</span></div>
    ${cards}
    ${summaryTable}
    ${quick}
    ${recent}`;
}

/** Carton/PCS split of today's inbound/outbound, using each product's own rate. */
function todaySplit(kind) {
  let cartons = 0, pcs = 0;
  for (const p of state.products) {
    const v = kind === "in" ? p.today_in.total_pcs : p.today_out.total_pcs;
    if (!v) continue;
    const sp = splitPcs(v, p.pcs_per_carton);
    cartons += sp.cartons;
    pcs += sp.pcs;
  }
  return { cartons, pcs };
}

/** Client-side mirror of the server's split() so previews stay instant. */
function splitPcs(totalPcs, rate) {
  const r = Math.max(1, Number(rate) || 1);
  const total = Math.trunc(Number(totalPcs) || 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  return { total_pcs: total, cartons: sign * Math.floor(abs / r), pcs: sign * (abs % r) };
}

/* ---------------- INVENTORY ---------------- */

function renderInventory() {
  const q = state.inv.q.trim().toLowerCase();
  const list = state.products.filter((p) => !q || p.name.toLowerCase().includes(q));

  const toolbar = `<div class="toolbar">
    <div class="search">
      ${icon("search")}
      <input id="invSearch" type="search" placeholder="Search product name…" value="${esc(state.inv.q)}"
             data-bind="inv-q" autocomplete="off" aria-label="Search products" />
    </div>
    <select data-bind="inv-warehouse" aria-label="Warehouse filter" style="max-width:210px">
      <option value="0" ${!state.warehouseId ? "selected" : ""}>All warehouses</option>
      ${state.warehouses.map((w) => `<option value="${w.id}" ${state.warehouseId === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}
    </select>
    <button class="btn primary" data-action="add-product">${icon("plus")} <span>Add Product</span></button>
  </div>`;

  if (!state.allProducts.length) {
    return `${toolbar}<div class="panel">${emptyState({
      icon: "box", title: "No products yet",
      text: "Add your first product: name, PCS per Cartoon, opening stock, warehouse and an image.",
      action: `<button class="btn primary lg" data-action="add-product">${icon("plus")} Add Product</button>`,
    })}</div>`;
  }

  if (!list.length) {
    return `${toolbar}<div class="panel">${emptyState({
      icon: "search", title: "No products found",
      text: `Nothing matches “${state.inv.q}” in ${scopeNamePlain()}.`,
      action: `<button class="btn" data-action="clear-inv-search">Clear search</button>`,
    })}</div>`;
  }

  const rows = list.map((p) => `
    <tr>
      <td>${thumbHtml(p)}</td>
      <td><div class="cell-prod"><div><div class="nm">${esc(p.name)}</div><div class="sub">${p.tx_count} transaction${p.tx_count === 1 ? "" : "s"}</div></div></div></td>
      <td><span class="wh-tag">${esc(p.warehouse_name)}</span></td>
      <td class="num"><span class="rate-chip">${num(p.pcs_per_carton)} PCS</span></td>
      <td class="num" title="Whole cartons in stock"><span class="stock-strong">${num(p.stock.cartons)}</span></td>
      <td class="num" title="Loose pieces left after full cartons"><span class="stock-strong">${num(p.stock.pcs)}</span></td>
      <td class="num"><span class="big-num ${p.stock.total_pcs ? "" : "zero"}">${num(p.stock.total_pcs)}</span></td>
      <td class="num"><span class="unit-sub">${num(p.opening.cartons)}c + ${num(p.opening.pcs)}p</span><br><span class="unit-sub">${num(p.opening.total_pcs)} PCS</span></td>
      <td class="num">${p.today_in.total_pcs ? `<span class="big-num pos">+${num(p.today_in.total_pcs)}</span><br><span class="unit-sub">${num(p.today_in.cartons)}c + ${num(p.today_in.pcs)}p</span>` : `<span class="unit-sub">—</span>`}</td>
      <td class="num">${p.today_out.total_pcs ? `<span class="big-num neg">−${num(p.today_out.total_pcs)}</span><br><span class="unit-sub">${num(p.today_out.cartons)}c + ${num(p.today_out.pcs)}p</span>` : `<span class="unit-sub">—</span>`}</td>
      <td><div class="row-actions">${rowActions(p)}</div></td>
    </tr>`).join("");

  const totals = list.reduce((a, p) => {
    a.pcs += p.stock.total_pcs; a.inb += p.today_in.total_pcs; a.out += p.today_out.total_pcs;
    a.cartons += p.stock.cartons; a.loose += p.stock.pcs;
    return a;
  }, { pcs: 0, inb: 0, out: 0, cartons: 0, loose: 0 });

  const table = `<div class="panel">
    <div class="panel-head">
      <h3>Product inventory</h3>
      <span class="hint">${num(list.length)} product${list.length === 1 ? "" : "s"} · ${scopeName()}</span>
      <div class="right"><span class="hint">Current stock = Opening + Inbound − Outbound</span></div>
    </div>
    <div class="tbl-wrap desktop-only">
      <table class="tbl">
        <thead><tr>
          <th class="center">Image</th><th>Product</th><th>Warehouse</th>
          <th class="num">PCS / Carton</th>
          <th class="num" title="Whole cartons currently in stock">Current Stock<br>(Cartoon)</th>
          <th class="num" title="Loose pieces currently in stock">Current Stock<br>(PCS)</th>
          <th class="num" title="Total pieces in stock">Total Stock<br>(PCS)</th>
          <th class="num">Opening Stock</th>
          <th class="num">Today's Inbound</th>
          <th class="num">Today's Outbound</th>
          <th class="center">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="m-list">${list.map(mobileProductCard).join("")}</div>
    <div class="tbl-foot">
      <span>On hand: <b>${num(totals.cartons)} cartons + ${num(totals.loose)} loose pcs</b></span>
      <span>Total stock: <b>${num(totals.pcs)} PCS</b></span>
      <span>Today in: <b style="color:var(--green)">+${num(totals.inb)} PCS</b></span>
      <span>Today out: <b style="color:var(--red)">−${num(totals.out)} PCS</b></span>
    </div>
  </div>`;

  return toolbar + table;
}

function scopeNamePlain() {
  return state.warehouseId ? warehouseName(state.warehouseId) : "any warehouse";
}

function rowActions(p) {
  return `
    <button class="btn in sm" data-action="move" data-type="INBOUND" data-id="${p.id}" title="Record inbound stock">${icon("down")} Inbound</button>
    <button class="btn out sm" data-action="move" data-type="OUTBOUND" data-id="${p.id}" title="Record outbound stock">${icon("up")} Outbound</button>
    <button class="icon-btn" data-action="adjust" data-id="${p.id}" title="Adjust stock (correction)" aria-label="Adjust stock">${icon("swap")}</button>
    <button class="icon-btn" data-action="product-history" data-id="${p.id}" title="View this product's history" aria-label="History">${icon("history")}</button>
    <button class="icon-btn" data-action="edit-product" data-id="${p.id}" title="Edit product" aria-label="Edit product">${icon("edit")}</button>`;
}

function mobileProductCard(p) {
  return `<div class="m-card">
    <div class="m-card-top">
      ${thumbHtml(p, "lg")}
      <div class="m-card-title">
        <div class="nm">${esc(p.name)}</div>
        <div class="sub"><span class="wh-tag">${esc(p.warehouse_name)}</span><span class="rate-chip">${num(p.pcs_per_carton)} PCS / Carton</span></div>
      </div>
    </div>
    <div class="m-grid">
      <div class="m-cell hl"><div class="l">Current Stock</div><div class="v">${num(p.stock.cartons)} ctn + ${num(p.stock.pcs)} pcs</div></div>
      <div class="m-cell"><div class="l">Total Stock (PCS)</div><div class="v">${num(p.stock.total_pcs)}</div></div>
      <div class="m-cell"><div class="l">Opening</div><div class="v">${num(p.opening.cartons)}c + ${num(p.opening.pcs)}p <small>(${num(p.opening.total_pcs)})</small></div></div>
      <div class="m-cell"><div class="l">Today In / Out</div><div class="v"><span style="color:var(--green)">+${num(p.today_in.total_pcs)}</span> <small>/</small> <span style="color:var(--red)">−${num(p.today_out.total_pcs)}</span></div></div>
    </div>
    <div class="m-actions">
      <button class="btn in" data-action="move" data-type="INBOUND" data-id="${p.id}">${icon("down")} Inbound</button>
      <button class="btn out" data-action="move" data-type="OUTBOUND" data-id="${p.id}">${icon("up")} Outbound</button>
      <button class="icon-btn" data-action="adjust" data-id="${p.id}" title="Adjust stock" aria-label="Adjust stock">${icon("swap")}</button>
      <button class="icon-btn" data-action="edit-product" data-id="${p.id}" title="Edit product" aria-label="Edit product">${icon("edit")}</button>
    </div>
  </div>`;
}

/* ---------------- INBOUND / OUTBOUND ---------------- */

function renderMovement(kind) {
  const isIn = kind === "inbound";
  const type = isIn ? "INBOUND" : "OUTBOUND";
  const q = state.inv.q.trim().toLowerCase();
  const list = state.products.filter((p) => !q || p.name.toLowerCase().includes(q));

  const todayTx = state.todayTx.filter((t) => t.type === type && !t.voided);
  const todayPcs = todayTx.reduce((a, t) => a + t.abs_pcs, 0);

  const head = `<div class="stats">
    ${statCard({
      label: isIn ? "Today's Inbound" : "Today's Outbound", ic: isIn ? "down" : "up",
      tone: isIn ? "is-in" : "is-out",
      value: `${num(todayPcs)} <small>PCS</small>`,
      sub: `${todayTx.length} entr${todayTx.length === 1 ? "y" : "ies"} dated ${fmtDate(state.today)}`,
    })}
    ${statCard({
      label: "Products", ic: "boxes",
      value: num(list.length),
      sub: scopeNote(),
    })}
    ${statCard({
      label: "Current Stock", ic: "box", tone: "is-brand",
      value: `${num(state.summary ? state.summary.totals.total_pcs : 0)} <small>PCS</small>`,
      sub: `${num(state.summary ? state.summary.totals.cartons : 0)} cartons + ${num(state.summary ? state.summary.totals.pieces : 0)} loose pcs`,
    })}
  </div>`;

  const toolbar = `<div class="toolbar" style="margin-top:16px">
    <div class="search">${icon("search")}
      <input type="search" placeholder="Search product…" value="${esc(state.inv.q)}" data-bind="inv-q" autocomplete="off" aria-label="Search products" />
    </div>
    <select data-bind="inv-warehouse" aria-label="Warehouse filter" style="max-width:210px">
      <option value="0" ${!state.warehouseId ? "selected" : ""}>All warehouses</option>
      ${state.warehouses.map((w) => `<option value="${w.id}" ${state.warehouseId === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}
    </select>
  </div>`;

  const picker = `<div class="panel">
    <div class="panel-head">
      <h3>${isIn ? "Stock received — choose a product" : "Stock dispatched — choose a product"}</h3>
      <span class="hint">${isIn ? "Enter Cartoon and/or PCS — both are allowed." : "Outbound is blocked if it would make stock negative."}</span>
    </div>
    ${list.length ? `<div class="pick-list">${list.map((p) => {
      const stock = p.stock;
      const disabled = !isIn && stock.total_pcs <= 0;
      return `<div class="pick-row">
        ${thumbHtml(p)}
        <div class="pick-info">
          <div class="pick-name">${esc(p.name)}</div>
          <div class="pick-sub"><span class="wh-tag">${esc(p.warehouse_name)}</span><span class="rate-chip">1 Carton = ${num(p.pcs_per_carton)} PCS</span></div>
        </div>
        <div class="pick-stock ${stock.total_pcs ? "" : "is-empty"}">
          <div class="l">In stock</div>
          <div class="v">${num(stock.cartons)}c + ${num(stock.pcs)}p</div>
          <div class="l" style="text-transform:none;letter-spacing:0">${num(stock.total_pcs)} PCS</div>
        </div>
        <button class="btn ${isIn ? "solid-in" : "solid-out"}" data-action="move" data-type="${type}" data-id="${p.id}" ${disabled ? "disabled title=\"No stock available\"" : ""}>
          ${icon(isIn ? "down" : "up")} ${isIn ? "Inbound" : "Outbound"}
        </button>
      </div>`;
    }).join("")}</div>` : emptyState({
      icon: "box",
      title: state.allProducts.length ? "No products match" : "No products yet",
      text: state.allProducts.length ? "Try a different search or warehouse filter." : "Add a product first, then record daily inbound and outbound.",
      action: state.allProducts.length ? `<button class="btn" data-action="clear-inv-search">Clear search</button>` : `<button class="btn primary lg" data-action="add-product">${icon("plus")} Add Product</button>`,
    })}
  </div>`;

  const todayPanel = `<div class="panel">
    <div class="panel-head">
      <h3>${isIn ? "Today's inbound entries" : "Today's outbound entries"}</h3>
      <span class="hint">${fmtDate(state.today)}</span>
      <div class="right"><button class="btn sm ghost" data-action="goto" data-view="history">${icon("history")} All transactions</button></div>
    </div>
    ${todayTx.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Product</th><th>Warehouse</th><th>Type</th><th class="num">Cartoon</th><th class="num">PCS</th><th>Note</th><th class="center">Actions</th></tr></thead>
      <tbody>${todayTx.map((t) => txRow(t)).join("")}</tbody>
    </table></div>` : `<div class="panel-body"><p class="hint" style="color:var(--muted);font-size:13.5px">Nothing recorded for today yet.</p></div>`}
  </div>`;

  return head + toolbar + picker + todayPanel;
}

/* ---------------- HISTORY ---------------- */

function txRow(t) {
  const qtyCls = t.qty_pcs > 0 ? "pos" : t.qty_pcs < 0 ? "neg" : "zero";
  return `<tr class="${t.voided ? "is-void" : ""}">
    <td style="white-space:nowrap"><b>${fmtShort(t.date)}</b><br><span class="unit-sub">${isToday(t.date) ? "Today" : new Date(t.date + "T00:00:00").getFullYear()}</span></td>
    <td><div class="cell-prod">${t.product_image ? `<img class="thumb" src="${esc(t.product_image)}" alt="" loading="lazy" data-action="zoom" data-src="${esc(t.product_image)}" data-cap="${esc(t.product_name)}" />` : ""}
      <div><div class="nm">${esc(t.product_name)}</div><div class="sub">1 ctn = ${num(t.pcs_per_carton)} pcs</div></div></div></td>
    <td><span class="wh-tag">${esc(t.warehouse_name)}</span></td>
    <td>${typeBadge(t.type)}${t.voided ? ` <span class="badge void">Cancelled</span>` : ""}</td>
    <td class="num">${num(t.carton)}</td>
    <td class="num">${num(t.pcs)}</td>
    <td class="num"><span class="big-num ${qtyCls}">${signed(t.qty_pcs)}</span></td>
    <td style="max-width:220px">${t.note ? esc(t.note) : `<span class="unit-sub">—</span>`}${t.voided && t.void_reason ? `<br><span class="unit-sub">${esc(t.void_reason)}</span>` : ""}</td>
    <td><div class="row-actions">${txActions(t)}</div></td>
  </tr>`;
}

function txActions(t) {
  if (t.voided) {
    return `<button class="btn sm" data-action="restore-tx" data-id="${t.id}" title="Restore this transaction">${icon("undo")} Restore</button>`;
  }
  return `
    <button class="icon-btn" data-action="edit-tx" data-id="${t.id}" title="Correct this transaction" aria-label="Correct transaction">${icon("edit")}</button>
    <button class="icon-btn" data-action="void-tx" data-id="${t.id}" title="Cancel / delete this transaction" aria-label="Cancel transaction" style="color:var(--red)">${icon("trash")}</button>`;
}

function renderHistory() {
  const f = state.hist;
  const rows = state.history;
  const totals = state.historyTotals || { in_pcs: 0, out_pcs: 0, count: 0 };

  const filters = `<div class="panel">
    <div class="panel-head">
      <h3>${icon("filter")} Filters</h3>
      <span class="hint">Narrow the history by date, warehouse, product or type</span>
      <div class="right">
        <button class="btn sm ghost" data-action="hist-today">Today</button>
        <button class="btn sm ghost" data-action="hist-week">Last 7 days</button>
        <button class="btn sm ghost" data-action="reset-hist">Reset</button>
        <a class="btn sm" href="${esc(API.csvUrl(histParams()))}" data-action="export-csv">${icon("download")} Export CSV</a>
      </div>
    </div>
    <div class="panel-body">
      <div class="filters">
        <div class="field"><label for="hFrom">From date</label><input id="hFrom" type="date" value="${esc(f.from)}" data-bind="hist-from" /></div>
        <div class="field"><label for="hTo">To date</label><input id="hTo" type="date" value="${esc(f.to)}" data-bind="hist-to" /></div>
        <div class="field"><label for="hWh">Warehouse</label>
          <select id="hWh" data-bind="hist-warehouse">
            <option value="0" ${!f.warehouseId ? "selected" : ""}>All warehouses</option>
            ${state.warehouses.map((w) => `<option value="${w.id}" ${f.warehouseId === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label for="hProd">Product</label>
          <select id="hProd" data-bind="hist-product">
            <option value="0" ${!f.productId ? "selected" : ""}>All products</option>
            ${state.warehouses.map((w) => {
              const ps = state.allProducts.filter((p) => p.warehouse_id === w.id);
              if (!ps.length) return "";
              return `<optgroup label="${esc(w.name)}">${ps.map((p) => `<option value="${p.id}" ${f.productId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`;
            }).join("")}
          </select>
        </div>
        <div class="field"><label for="hType">Type</label>
          <select id="hType" data-bind="hist-type">
            <option value="" ${!f.type ? "selected" : ""}>All types</option>
            <option value="INBOUND" ${f.type === "INBOUND" ? "selected" : ""}>Inbound</option>
            <option value="OUTBOUND" ${f.type === "OUTBOUND" ? "selected" : ""}>Outbound</option>
            <option value="OPENING" ${f.type === "OPENING" ? "selected" : ""}>Opening stock</option>
            <option value="ADJUSTMENT" ${f.type === "ADJUSTMENT" ? "selected" : ""}>Adjustment</option>
            <option value="TRANSFER" ${f.type === "TRANSFER" ? "selected" : ""}>Warehouse transfer</option>
          </select>
        </div>
        <div class="field"><label for="hQ">Search</label>
          <div class="search">${icon("search")}<input id="hQ" type="search" placeholder="Product or note…" value="${esc(f.q)}" data-bind="hist-q" autocomplete="off" /></div>
        </div>
      </div>
    </div>
  </div>`;

  const stats = `<div class="stats" style="margin-top:16px">
    ${statCard({ label: "Entries", ic: "list", value: num(rows.length), sub: `${num(totals.count)} active · ${num(rows.length - totals.count)} cancelled` })}
    ${statCard({ label: "Inbound (filtered)", ic: "down", tone: "is-in", value: `${num(totals.in_pcs)} <small>PCS</small>`, sub: "Opening stock excluded" })}
    ${statCard({ label: "Outbound (filtered)", ic: "up", tone: "is-out", value: `${num(totals.out_pcs)} <small>PCS</small>`, sub: "Dispatched / issued out" })}
    ${statCard({ label: "Net movement", ic: "total", tone: "is-brand", value: `${signed(totals.in_pcs - totals.out_pcs)} <small>PCS</small>`, sub: "Inbound − Outbound" })}
  </div>`;

  const table = `<div class="panel">
    <div class="panel-head">
      <h3>Daily inventory history</h3>
      <span class="hint">Stock is always recalculated from these rows — nothing is overwritten</span>
    </div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th>Date</th><th>Product</th><th>Warehouse</th><th>Type</th>
        <th class="num">Cartoon</th><th class="num">PCS</th><th class="num">Total PCS</th><th>Note</th><th class="center">Actions</th>
      </tr></thead>
      <tbody>${rows.map((t) => txRow(t)).join("")}</tbody>
    </table></div>
    <div class="tbl-foot">
      <span>Inbound: <b style="color:var(--green)">${num(totals.in_pcs)} PCS</b></span>
      <span>Outbound: <b style="color:var(--red)">${num(totals.out_pcs)} PCS</b></span>
      <span>Net: <b>${signed(totals.in_pcs - totals.out_pcs)} PCS</b></span>
    </div>` : emptyState({
      icon: "list", title: "No transactions found",
      text: "No entries match the current filters. Try widening the date range or clearing the filters.",
      action: `<button class="btn" data-action="reset-hist">Reset filters</button>`,
    })}
  </div>`;

  return filters + stats + table;
}

function histParams() {
  const f = state.hist;
  return {
    from: f.from, to: f.to, warehouse_id: f.warehouseId || "", product_id: f.productId || "",
    type: f.type, q: f.q, today: state.today, limit: 2000,
  };
}
