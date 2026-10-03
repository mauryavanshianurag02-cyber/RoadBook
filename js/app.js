/* ============================================================
   StockBook — app: routing, data loading, forms & modals
   ============================================================ */
"use strict";

const VIEW_TITLES = {
  dashboard: ["Dashboard", "Stock overview for all three warehouses"],
  inventory: ["Inventory", "Every product with live stock, opening stock and today's movement"],
  inbound: ["Daily Inbound", "Record stock received — in Cartoon, PCS or both"],
  outbound: ["Daily Outbound", "Record stock dispatched — never goes below zero"],
  history: ["Transactions / History", "Complete, filterable stock history"],
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  renderOffline();
  await loadAll();
  renderAll();
  // keep "today" fresh if the app is left open across midnight
  setInterval(() => {
    const t = todayISO();
    if (t !== state.today) { state.today = t; loadAll().then(renderAll); }
  }, 60000);
}

/* ---------------- data loading ---------------- */

async function loadAll() {
  try {
    const data = await API.bootstrap({ warehouse_id: state.warehouseId || "", today: todayISO() });
    state.warehouses = data.warehouses || [];
    state.products = data.products || [];
    state.allProducts = data.all_products || data.products || [];
    state.summary = data.summary || null;
    state.recent = data.recent || [];
    state.todayTx = data.today_tx || [];
    state.today = data.today || todayISO();
    state.ready = true;
    state.online = true;
  } catch (err) {
    state.online = false;
    state.ready = true;
    if (err.status !== 0) toast(err.message, "err", 4000);
  }
  renderOffline();
  if (state.view === "history") await loadHistory();
}

async function loadHistory() {
  try {
    const data = await API.transactions({ ...histParams(), today: state.today });
    state.history = data.transactions || [];
    state.historyTotals = data.totals || { in_pcs: 0, out_pcs: 0, count: 0 };
    state.online = true;
  } catch (err) {
    state.online = false;
    state.history = [];
    state.historyTotals = null;
    if (err.status !== 0) toast(err.message, "err");
  }
  renderOffline();
}

function renderOffline() {
  const banner = $("#offlineBanner");
  const status = $("#dbStatus");
  const text = $("#dbStatusText");
  if (state.online) {
    banner.hidden = true;
    status.classList.remove("is-off");
    text.textContent = "Connected to database";
  } else {
    banner.hidden = false;
    banner.innerHTML = `${icon("alert")}<span><b>Not connected to the database.</b> Start the server with <code>npm start</code> (Node 22.5+) and reload this page — data is saved on the server, not in the browser.</span>`;
    status.classList.add("is-off");
    text.textContent = "Database not connected";
  }
}

/* ---------------- rendering ---------------- */

function renderAll() {
  renderNav();
  renderTopbar();
  const view = state.view;
  $$(".view").forEach((el) => { el.hidden = el.id !== `view-${view}`; });
  const target = $(`#view-${view}`);
  if (!target) return;
  if (!state.online && !state.warehouses.length) {
    target.innerHTML = emptyState({
      icon: "alert", title: "Cannot load inventory",
      text: "The StockBook server is not reachable. Run “npm start” in the project folder, then reload.",
    });
    return;
  }
  if (view === "dashboard") target.innerHTML = renderDashboard();
  else if (view === "inventory") target.innerHTML = renderInventory();
  else if (view === "inbound") target.innerHTML = renderMovement("inbound");
  else if (view === "outbound") target.innerHTML = renderMovement("outbound");
  else if (view === "history") target.innerHTML = renderHistory();
}

function renderNav() {
  $$("[data-view]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.view === state.view));
  const c = $("#countProducts");
  const n = state.allProducts.length;
  c.hidden = !n;
  c.textContent = n;
}

function renderTopbar() {
  const [title, sub] = VIEW_TITLES[state.view] || ["StockBook", ""];
  $("#viewTitle").textContent = title;
  $("#viewSub").textContent = state.warehouseId ? `${sub} · ${warehouseName(state.warehouseId)} only` : sub;

  $("#whSwitch").innerHTML = `
    <button class="wh-chip ${!state.warehouseId ? "is-active" : ""}" data-action="set-warehouse" data-id="0">All</button>
    ${state.warehouses.map((w) => `<button class="wh-chip ${state.warehouseId === w.id ? "is-active" : ""}" data-action="set-warehouse" data-id="${w.id}">${esc(w.name)}</button>`).join("")}`;
}

/** Change the warehouse scope (and optionally the view) and reload the data. */
async function setScope(warehouseId, view) {
  state.warehouseId = Number(warehouseId) || 0;
  if (view) state.view = view;
  closeNav();
  window.scrollTo({ top: 0 });
  renderAll();                 // immediate feedback (chips + title)
  await loadAll();
  renderAll();
}

function goto(view) {
  if (!VIEW_TITLES[view]) return;
  state.view = view;
  closeNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderAll();
  if (view === "history") loadHistory().then(() => { if (state.view === "history") renderAll(); });
}

/** Re-render but keep the caret inside the field the user is typing in. */
function renderKeepFocus() {
  const active = document.activeElement;
  const bind = active && active.dataset ? active.dataset.bind : null;
  const pos = active && "selectionStart" in active ? active.selectionStart : null;
  renderAll();
  if (bind) {
    const el = $(`[data-bind="${bind}"]`);
    if (el) {
      el.focus();
      if (pos !== null && el.setSelectionRange) {
        try { el.setSelectionRange(pos, pos); } catch { /* number inputs */ }
      }
    }
  }
}

/* ---------------- events ---------------- */

function bindEvents() {
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#lightbox").hidden) closeLightbox();
      else if (!$("#confirmBackdrop").hidden) closeConfirm(false);
      else if (!$("#modalBackdrop").hidden) closeModal();
      else closeNav();
    }
  });

  $("#modalClose").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
  $("#confirmNo").addEventListener("click", () => closeConfirm(false));
  $("#confirmYes").addEventListener("click", () => closeConfirm(true));
  $("#confirmBackdrop").addEventListener("click", (e) => { if (e.target.id === "confirmBackdrop") closeConfirm(false); });
  $("#lightboxClose").addEventListener("click", closeLightbox);
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
  $("#btnMenu").addEventListener("click", openNav);
  $("#btnCloseNav").addEventListener("click", closeNav);
  $("#navBackdrop").addEventListener("click", closeNav);
  $("#btnAddProduct").addEventListener("click", () => productForm(null));
}

function openNav() {
  $("#sidebar").classList.add("is-open");
  $("#navBackdrop").hidden = false;
}
function closeNav() {
  $("#sidebar").classList.remove("is-open");
  $("#navBackdrop").hidden = true;
}

function onClick(e) {
  const zoom = e.target.closest('[data-action="zoom"]');
  if (zoom) { e.preventDefault(); openLightbox(zoom.dataset.src, zoom.dataset.cap); return; }

  const el = e.target.closest("[data-action], [data-view]");
  if (!el) return;
  const a = el.dataset.action;
  const id = Number(el.dataset.id);

  if (a === "export-csv") return; // plain link, let the browser download

  e.preventDefault();

  // sidebar / bottom-tab navigation buttons carry only data-view
  if (!a && el.dataset.view) return goto(el.dataset.view);

  switch (a) {
    case "goto": return goto(el.dataset.view);
    case "add-product": return productForm(null);
    case "edit-product": return productForm(productById(id) || findProduct(id));
    case "move": return movementForm(el.dataset.type, findProduct(id));
    case "adjust": return movementForm("ADJUSTMENT", findProduct(id));
    case "product-history": {
      state.hist = { q: "", from: "", to: "", warehouseId: 0, productId: id, type: "" };
      return goto("history");
    }
    case "open-warehouse": return setScope(id, "inventory");
    case "set-warehouse": return setScope(id);
    case "clear-inv-search": state.inv.q = ""; return renderAll();
    case "edit-tx": return editTxForm(state.history.find((t) => t.id === id) || state.todayTx.find((t) => t.id === id) || state.recent.find((t) => t.id === id));
    case "void-tx": return voidTx(id);
    case "restore-tx": return restoreTx(id);
    case "reset-hist": state.hist = { q: "", from: "", to: "", warehouseId: 0, productId: 0, type: "" }; return loadHistory().then(renderAll);
    case "hist-today": state.hist.from = state.hist.to = todayISO(); return loadHistory().then(renderAll);
    case "hist-week": {
      const d = new Date(); d.setDate(d.getDate() - 6);
      state.hist.from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      state.hist.to = todayISO();
      return loadHistory().then(renderAll);
    }
    case "pick-image": return $("#imgInput") && $("#imgInput").click();
    case "remove-image": {
      state.pendingImage = null;
      const form = $("#productForm");
      if (form && form.dataset.editing) form.dataset.imageRemoved = "1";
      const wrap = $("#imgWrap");
      if (wrap) wrap.innerHTML = imagePickerHtml(null);
      bindImageInput();
      return;
    }
    case "move-dir": {
      const dir = $("#mvDir");
      if (dir) dir.value = el.dataset.dir;
      return updateMovementPreview();
    }
    case "close-modal": return closeModal();
    default: return;
  }
}

function onInput(e) {
  const el = e.target.closest("[data-bind]");
  if (!el) return;
  const b = el.dataset.bind;
  if (b === "inv-q") { state.inv.q = el.value; debounce(renderKeepFocus, 90); }
  if (b === "hist-q") { state.hist.q = el.value; debounce(() => loadHistory().then(renderKeepFocus), 260); }
  if (b.startsWith("mv-")) updateMovementPreview();
  if (b === "prod-opening" || b === "prod-rate") { updateOpeningPreview(); updateProductFormHint(); }
}

function onChange(e) {
  const el = e.target.closest("[data-bind]");
  if (!el) return;
  const b = el.dataset.bind;
  if (b === "inv-warehouse") setScope(Number(el.value) || 0);
  if (b === "hist-from") { state.hist.from = el.value; loadHistory().then(renderAll); }
  if (b === "hist-to") { state.hist.to = el.value; loadHistory().then(renderAll); }
  if (b === "hist-warehouse") { state.hist.warehouseId = Number(el.value) || 0; loadHistory().then(renderAll); }
  if (b === "hist-product") { state.hist.productId = Number(el.value) || 0; loadHistory().then(renderAll); }
  if (b === "hist-type") { state.hist.type = el.value; loadHistory().then(renderAll); }
  if (b === "mv-dir") updateMovementPreview();
  if (b === "prod-warehouse") updateProductFormHint();
}

function onSubmit(e) {
  const form = e.target.closest("form");
  if (!form) return;
  e.preventDefault();
  if (form.id === "productForm") return saveProduct(form);
  if (form.id === "movementForm") return saveMovement(form);
  if (form.id === "txForm") return saveTx(form);
}

let _deb = null;
function debounce(fn, ms) {
  clearTimeout(_deb);
  _deb = setTimeout(fn, ms);
}

function findProduct(id) {
  return state.allProducts.find((p) => p.id === Number(id)) || state.products.find((p) => p.id === Number(id)) || null;
}

/* ============================================================
   ADD / EDIT PRODUCT
   ============================================================ */

function imagePickerHtml(image) {
  const preview = state.pendingImage
    ? `<img class="img-preview" id="imgPreview" src="${esc(state.pendingImage.data)}" alt="Selected product image" />`
    : image
      ? `<img class="img-preview" id="imgPreview" src="${esc(image)}" alt="Product image" />`
      : `<span class="img-preview-ph" id="imgPreview">No image<br>selected</span>`;
  return `<div class="img-picker">
    ${preview}
    <div style="flex:1;min-width:0">
      <input type="file" id="imgInput" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn sm" data-action="pick-image">${icon("image")} Choose image</button>
        <button type="button" class="btn sm ghost" data-action="remove-image">${icon("x")} Remove</button>
      </div>
      <p class="help">JPG or PNG. The image is resized in your browser and stored on the server.</p>
    </div>
  </div>`;
}

function bindImageInput() {
  const input = $("#imgInput");
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      state.pendingImage = await fileToResizedDataUrl(file);
      const pf = $("#productForm");
      if (pf) delete pf.dataset.imageRemoved;
      const wrap = $("#imgWrap");
      wrap.innerHTML = imagePickerHtml(null);
      bindImageInput();
      toast("Image ready — remember to save.", "ok", 1800);
    } catch (err) {
      toast(err.message, "err");
    }
  });
}

function productForm(product) {
  const isEdit = !!product;
  state.pendingImage = null;
  const whOptions = state.warehouses
    .map((w) => `<option value="${w.id}" ${isEdit && product.warehouse_id === w.id ? "selected" : ""} ${!isEdit && state.warehouseId === w.id ? "selected" : ""}>${esc(w.name)}</option>`)
    .join("");

  const openingBlock = isEdit ? "" : `
    <div class="field">
      <label>Opening Stock <span class="help" style="display:inline">(optional — enter Cartoon, PCS or both)</span></label>
      <div class="grid-2">
        <div class="unit-box">
          <div class="unit-head">${icon("cart")} Cartoon</div>
          <input id="pOpenCarton" type="number" min="0" step="1" inputmode="numeric" name="opening_carton" value="0" data-bind="prod-opening" />
        </div>
        <div class="unit-box">
          <div class="unit-head">${icon("pieces")} PCS</div>
          <input id="pOpenPcs" type="number" min="0" step="1" inputmode="numeric" name="opening_pcs" value="0" data-bind="prod-opening" />
        </div>
      </div>
      <div class="calc-preview" id="openingPreview"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="pOpenDate">Opening date</label>
        <input id="pOpenDate" type="date" name="opening_date" value="${todayISO()}" max="${todayISO()}" /></div>
      <div class="field"><label for="pOpenNote">Opening note <span class="help" style="display:inline">(optional)</span></label>
        <input id="pOpenNote" type="text" name="opening_note" placeholder="Opening stock" maxlength="200" /></div>
    </div>`;

  const editNote = isEdit ? `
    <div class="form-note">${icon("info")}<span>You can change the <b>name</b>, <b>PCS per Cartoon</b>, <b>image</b> and <b>warehouse</b>.
      Past inbound / outbound entries are <b>never</b> rewritten — correct them from
      <a href="#" data-action="goto" data-view="history">Transactions / History</a>.</span></div>
    <div class="form-note warn" id="rateWarn" hidden>${icon("alert")}<span id="rateWarnText"></span></div>
    <div class="form-note warn" id="whWarn" hidden>${icon("swap")}<span id="whWarnText"></span></div>` : "";

  openModal(isEdit ? `Edit product — ${product.name}` : "Add Product", `
    <form id="productForm" novalidate ${isEdit ? `data-editing="${product.id}"` : ""}>
      ${editNote}
      <div class="field">
        <label for="pName">Product Name <span class="req">*</span></label>
        <input id="pName" name="name" type="text" required maxlength="120" placeholder="e.g. ABC Product" value="${isEdit ? esc(product.name) : ""}" autocomplete="off" />
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="pRate">PCS per Cartoon <span class="req">*</span></label>
          <input id="pRate" name="pcs_per_carton" type="number" min="1" step="1" inputmode="numeric" required value="${isEdit ? product.pcs_per_carton : 24}" data-bind="prod-rate" />
          <p class="help">1 Carton = this many PCS. Used for every automatic calculation.</p>
        </div>
        <div class="field">
          <label for="pWh">Warehouse Name <span class="req">*</span></label>
          <select id="pWh" name="warehouse_id" required data-bind="prod-warehouse">${whOptions}</select>
          <p class="help">AKASHARWDI · TABLE 1 · CHAIR</p>
        </div>
      </div>
      ${openingBlock}
      <div class="field">
        <label>Product Image</label>
        <div id="imgWrap">${imagePickerHtml(isEdit ? product.image : null)}</div>
      </div>
      ${isEdit ? `<div class="form-note">${icon("box")}<span>Current stock: <b>${qtyLong(product.stock)}</b> — opening ${num(product.opening.total_pcs)} + inbound ${num(product.inbound_total.total_pcs)} − outbound ${num(product.outbound_total.total_pcs)} PCS.</span></div>` : ""}
      <div class="form-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary lg">${icon("check")} ${isEdit ? "Save changes" : "Save product"}</button>
      </div>
    </form>`, { wide: true });

  bindImageInput();
  updateOpeningPreview();
  updateProductFormHint();
}

function updateOpeningPreview() {
  const box = $("#openingPreview");
  if (!box) return;
  const rate = Math.max(1, Math.trunc(Number($("#pRate").value) || 1));
  const c = Math.max(0, Math.trunc(Number($("#pOpenCarton").value) || 0));
  const p = Math.max(0, Math.trunc(Number($("#pOpenPcs").value) || 0));
  const total = c * rate + p;
  box.innerHTML = `<div class="row1">${icon("total")} <b>${num(c)} Cartoon + ${num(p)} PCS</b> = <b>${num(total)} PCS</b></div>
    <div class="row2">At 1 Carton = ${num(rate)} PCS. This is saved as the product's <b>Opening Stock</b> entry and is part of the permanent history.</div>`;
}

function updateProductFormHint() {
  const form = $("#productForm");
  if (!form || !form.dataset.editing) return;
  const product = findProduct(form.dataset.editing);
  if (!product) return;

  const rateWarn = $("#rateWarn"), whWarn = $("#whWarn");
  const newRate = Math.max(1, Math.trunc(Number($("#pRate").value) || 1));
  if (rateWarn) {
    const changed = newRate !== product.pcs_per_carton;
    rateWarn.hidden = !changed;
    if (changed) {
      const sp = splitPcs(product.stock.total_pcs, newRate);
      $("#rateWarnText").innerHTML = `PCS per Carton changes from <b>${num(product.pcs_per_carton)}</b> to <b>${num(newRate)}</b>.
        Total stock stays <b>${num(product.stock.total_pcs)} PCS</b>, shown as <b>${num(sp.cartons)} ctn + ${num(sp.pcs)} pcs</b>.
        Old transactions keep the rate they were entered with.`;
    }
  }
  if (whWarn) {
    const newWh = Number($("#pWh").value);
    const changed = newWh && newWh !== product.warehouse_id;
    whWarn.hidden = !changed;
    if (changed) {
      $("#whWarnText").innerHTML = `Warehouse changes to <b>${esc(warehouseName(newWh))}</b>. The current stock
        (<b>${num(product.stock.total_pcs)} PCS</b>) will be moved with two linked <b>Transfer</b> entries —
        nothing in the old history is deleted.`;
    }
  }
}

async function saveProduct(form) {
  const editing = form.dataset.editing ? Number(form.dataset.editing) : null;
  const nameEl = $("#pName"), rateEl = $("#pRate"), whEl = $("#pWh");
  const name = nameEl.value.trim();
  const rate = Math.trunc(Number(rateEl.value));
  const warehouseId = Number(whEl.value);

  if (!name) return fieldError(nameEl, "Please enter the product name.");
  if (!rate || rate < 1) return fieldError(rateEl, "PCS per Carton must be 1 or more.");
  if (!warehouseId) return fieldError(whEl, "Please choose a warehouse.");

  const btn = $('button[type="submit"]', form);
  btn.disabled = true;

  try {
    if (editing) {
      const product = findProduct(editing);
      const moving = product && product.warehouse_id !== warehouseId;
      if (moving) {
        const ok = await confirmDialog({
          title: `Move to ${warehouseName(warehouseId)}?`,
          text: `The product and its current stock (<b>${num(product.stock.total_pcs)} PCS</b>) will move to <b>${esc(warehouseName(warehouseId))}</b>.
                 Two linked <b>Transfer</b> entries are added to the history — existing entries are not changed.`,
          yes: "Move product",
        });
        if (!ok) { btn.disabled = false; return; }
      }
      const body = { name, pcs_per_carton: rate, warehouse_id: warehouseId };
      if (state.pendingImage) body.image = { data: state.pendingImage.data, mime: state.pendingImage.mime };
      else if (form.dataset.imageRemoved === "1") body.image = null;
      await API.updateProduct(editing, body);
      toast("Product updated.", "ok");
    } else {
      const body = {
        name, pcs_per_carton: rate, warehouse_id: warehouseId,
        opening_carton: Math.max(0, Math.trunc(Number($("#pOpenCarton").value) || 0)),
        opening_pcs: Math.max(0, Math.trunc(Number($("#pOpenPcs").value) || 0)),
        opening_date: ($("#pOpenDate") && $("#pOpenDate").value) || todayISO(),
        opening_note: ($("#pOpenNote") && $("#pOpenNote").value) || "",
      };
      if (state.pendingImage) body.image = { data: state.pendingImage.data, mime: state.pendingImage.mime };
      const res = await API.createProduct(body);
      toast(`“${res.product.name}” added to ${res.product.warehouse_name}.`, "ok");
      state.warehouseId = res.product.warehouse_id; // show the new product right away
    }
    closeModal();
    await loadAll();
    if (!editing) goto("inventory");
    else renderAll();
  } catch (err) {
    toast(err.message, "err", 4000);
    btn.disabled = false;
  }
}

function fieldError(input, message) {
  input.focus();
  input.style.borderColor = "var(--red-2)";
  input.style.boxShadow = "0 0 0 3px var(--red-soft)";
  toast(message, "warn");
  setTimeout(() => { input.style.borderColor = ""; input.style.boxShadow = ""; }, 2200);
}

/* ============================================================
   INBOUND / OUTBOUND / ADJUSTMENT
   ============================================================ */

function movementForm(type, product) {
  if (!product) return toast("Product not found.", "err");
  const isInbound = type === "INBOUND";
  const isOutbound = type === "OUTBOUND";
  const isAdjust = type === "ADJUSTMENT";
  const title = `${isInbound ? "Inbound Stock" : isOutbound ? "Outbound Stock" : "Adjust Stock"} — ${product.name}`;
  const tone = isInbound ? "solid-in" : isOutbound ? "solid-out" : "primary";

  const dirField = isAdjust ? `
    <div class="field">
      <label>Direction <span class="req">*</span></label>
      <div class="grid-2">
        <button type="button" class="btn in mv-dir is-active" data-dir="1" data-action="move-dir">${icon("plus")} Add to stock</button>
        <button type="button" class="btn out mv-dir" data-dir="-1" data-action="move-dir">${icon("minus")} Remove from stock</button>
      </div>
      <input type="hidden" name="direction" id="mvDir" value="1" data-bind="mv-dir" />
    </div>` : "";

  openModal(title, `
    <form id="movementForm" novalidate data-type="${type}" data-product="${product.id}">
      <div class="form-note">
        ${icon("box")}
        <span><b>${esc(product.name)}</b> · ${esc(product.warehouse_name)} · 1 Carton = <b>${num(product.pcs_per_carton)} PCS</b><br>
          Current stock: <b>${qtyLong(product.stock)}</b></span>
      </div>
      ${dirField}
      <div class="field">
        <label for="mvDate">Date <span class="req">*</span></label>
        <input id="mvDate" name="date" type="date" value="${todayISO()}" />
        <p class="help">Today's date is filled in automatically — change it if you are entering an older entry.</p>
      </div>
      <div class="field">
        <label>${isAdjust ? "Quantity" : isInbound ? "Inbound Stock" : "Outbound Stock"} <span class="req">*</span>
          <span class="help" style="display:inline">(enter Cartoon, PCS or both)</span></label>
        <div class="grid-2">
          <div class="unit-box">
            <div class="unit-head">${icon("cart")} Cartoon</div>
            <input type="number" min="0" step="1" inputmode="numeric" name="carton" id="mvCarton" value="0" data-bind="mv-carton" />
          </div>
          <div class="unit-box">
            <div class="unit-head">${icon("pieces")} PCS</div>
            <input type="number" min="0" step="1" inputmode="numeric" name="pcs" id="mvPcs" value="0" data-bind="mv-pcs" />
          </div>
        </div>
      </div>
      <div class="calc-preview" id="mvPreview"></div>
      <div class="field" style="margin-top:14px">
        <label for="mvNote">Note <span class="help" style="display:inline">(optional)</span></label>
        <input id="mvNote" name="note" type="text" maxlength="200" placeholder="${isInbound ? "e.g. Received from supplier" : isOutbound ? "e.g. Dispatched to customer" : "e.g. Damaged / counting correction"}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn ${tone} lg" id="mvSave">${icon("check")} Save ${isInbound ? "Inbound" : isOutbound ? "Outbound" : "Adjustment"}</button>
      </div>
    </form>`, { wide: true });

  updateMovementPreview();
  setTimeout(() => $("#mvCarton") && $("#mvCarton").focus(), 60);
}

function updateMovementPreview() {
  const form = $("#movementForm");
  const box = $("#mvPreview");
  if (!form || !box) return;

  const product = findProduct(form.dataset.product);
  if (!product) return;
  const rate = product.pcs_per_carton;
  const type = form.dataset.type;

  // direction buttons (adjustment only)
  const dirEl = $("#mvDir");
  $$(".mv-dir", form).forEach((b) => {
    const on = dirEl && Number(b.dataset.dir) === Number(dirEl.value);
    b.classList.toggle("is-active", !!on);
    b.style.outline = on ? "2px solid currentColor" : "";
  });

  const c = Math.max(0, Math.trunc(Number($("#mvCarton").value) || 0));
  const p = Math.max(0, Math.trunc(Number($("#mvPcs").value) || 0));
  const dir = dirEl ? Number(dirEl.value) : type === "OUTBOUND" ? -1 : 1;
  const qty = (c * rate + p) * dir;
  const after = product.stock.total_pcs + qty;
  const afterSplit = splitPcs(after, rate);
  const qtySplit = splitPcs(Math.abs(qty), rate);

  const label = type === "ADJUSTMENT" ? (dir > 0 ? "Adding" : "Removing") : type === "OUTBOUND" ? "Outbound" : "Inbound";
  const bad = after < 0;
  const empty = c === 0 && p === 0;

  box.className = `calc-preview ${dir < 0 ? "is-out" : ""} ${bad ? "is-bad" : ""}`;
  box.innerHTML = `
    <div class="row1">${icon(dir > 0 ? "down" : "up")}
      ${label}: <b>${num(c)} Carton + ${num(p)} PCS</b> = <b>${num(Math.abs(qty))} PCS</b>
      <span class="unit-sub">(${num(qtySplit.cartons)} ctn + ${num(qtySplit.pcs)} pcs at 1 ctn = ${num(rate)} pcs)</span>
    </div>
    <div class="row2">Current stock <b>${num(product.stock.total_pcs)} PCS</b> → new stock
      <b>${num(afterSplit.cartons)} ctn + ${num(afterSplit.pcs)} pcs</b> = <b>${num(after)} PCS</b></div>
    ${empty ? `<div class="warn">${icon("alert")} Enter a quantity in Cartoon or PCS.</div>` : ""}
    ${bad ? `<div class="warn">${icon("alert")} <b>Insufficient stock.</b> Only ${num(product.stock.total_pcs)} PCS available
      (${num(product.stock.cartons)} ctn + ${num(product.stock.pcs)} pcs). Short by ${num(Math.abs(after))} PCS.</div>` : ""}`;

  const save = $("#mvSave");
  if (save) save.disabled = empty || bad;
}

async function saveMovement(form) {
  const product = findProduct(form.dataset.product);
  const type = form.dataset.type;
  const c = Math.max(0, Math.trunc(Number($("#mvCarton").value) || 0));
  const p = Math.max(0, Math.trunc(Number($("#mvPcs").value) || 0));
  if (!product) return;
  if (!c && !p) return fieldError($("#mvCarton"), "Enter a quantity in Cartoon or PCS.");

  const dirEl = $("#mvDir");
  const dir = dirEl ? Number(dirEl.value) : type === "OUTBOUND" ? -1 : 1;
  const qty = (c * product.pcs_per_carton + p) * dir;
  if (product.stock.total_pcs + qty < 0) {
    toast(`Insufficient stock. Only ${num(product.stock.total_pcs)} PCS available.`, "err", 4000);
    return updateMovementPreview();
  }

  const btn = $("#mvSave");
  btn.disabled = true;
  try {
    await API.addTransaction({
      product_id: product.id, type, date: $("#mvDate").value || todayISO(),
      carton: c, pcs: p, note: $("#mvNote").value.trim(), sign: dir,
    });
    const word = type === "INBOUND" ? "Inbound" : type === "OUTBOUND" ? "Outbound" : "Adjustment";
    toast(`${word} saved — ${product.name} is now ${qtyShort(splitPcs(product.stock.total_pcs + qty, product.pcs_per_carton))}.`, "ok", 3200);
    closeModal();
    await loadAll();
    renderAll();
  } catch (err) {
    btn.disabled = false;
    if (err.status === 409) {
      const avail = err.detail && err.detail.available_pcs !== undefined ? err.detail.available_pcs : product.stock.total_pcs;
      toast(`Insufficient stock. Available: ${num(avail)} PCS.`, "err", 4500);
      updateMovementPreview();
    } else {
      toast(err.message, "err", 4000);
    }
  }
}

/* ============================================================
   CORRECT / CANCEL A TRANSACTION
   ============================================================ */

function editTxForm(t) {
  if (!t) return toast("Transaction not found — reload the history and try again.", "err");
  openModal(`Correct entry — ${TYPE_META[t.type] ? TYPE_META[t.type].label : t.type}`, `
    <form id="txForm" novalidate data-tx="${t.id}">
      <div class="form-note">${icon("info")}
        <span><b>${esc(t.product_name)}</b> · ${esc(t.warehouse_name)} · 1 Carton = ${num(t.pcs_per_carton)} PCS ·
        recorded ${fmtDateTime(t.created_at)}</span></div>
      <div class="form-note warn">${icon("alert")}
        <span>Correcting an entry recalculates the current stock. The previous values are kept in the audit trail —
        history is never overwritten.</span></div>
      <div class="field">
        <label for="txDate">Date</label>
        <input id="txDate" name="date" type="date" value="${esc(t.date)}" />
      </div>
      <div class="field">
        <label>Quantity <span class="help" style="display:inline">(as originally entered)</span></label>
        <div class="grid-2">
          <div class="unit-box"><div class="unit-head">${icon("cart")} Cartoon</div>
            <input type="number" min="0" step="1" inputmode="numeric" name="carton" id="txCarton" value="${t.carton}" /></div>
          <div class="unit-box"><div class="unit-head">${icon("pieces")} PCS</div>
            <input type="number" min="0" step="1" inputmode="numeric" name="pcs" id="txPcs" value="${t.pcs}" /></div>
        </div>
      </div>
      <div class="field">
        <label for="txNote">Note</label>
        <input id="txNote" name="note" type="text" maxlength="200" value="${esc(t.note)}" />
      </div>
      <div class="field">
        <label for="txReason">Reason for correction <span class="help" style="display:inline">(optional)</span></label>
        <input id="txReason" name="reason" type="text" maxlength="200" placeholder="e.g. Wrong quantity typed" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${icon("check")} Save correction</button>
      </div>
    </form>`);
  setTimeout(() => $("#txDate") && $("#txDate").focus(), 50);
}

async function saveTx(form) {
  const id = Number(form.dataset.tx);
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  try {
    await API.updateTransaction(id, {
      date: $("#txDate").value,
      carton: Math.max(0, Math.trunc(Number($("#txCarton").value) || 0)),
      pcs: Math.max(0, Math.trunc(Number($("#txPcs").value) || 0)),
      note: $("#txNote").value.trim(),
      reason: $("#txReason").value.trim(),
    });
    toast("Entry corrected — stock recalculated.", "ok");
    closeModal();
    await refreshAfterTx();
  } catch (err) {
    btn.disabled = false;
    toast(err.status === 409 ? `Insufficient stock. ${err.detail ? "Available: " + num(err.detail.available_pcs) + " PCS." : ""}` : err.message, "err", 4500);
  }
}

async function voidTx(id) {
  const t = state.history.find((x) => x.id === id) || state.todayTx.find((x) => x.id === id) || state.recent.find((x) => x.id === id);
  const label = t ? `<b>${esc(t.product_name)}</b> — ${fmtDate(t.date)} · ${num(t.carton)} ctn + ${num(t.pcs)} pcs (${TYPE_META[t.type] ? TYPE_META[t.type].label : t.type})` : `entry #${id}`;
  const ok = await confirmDialog({
    title: "Cancel this transaction?",
    text: `${label}<br><br>The entry is <b>cancelled</b>, not erased — it stays in the history marked “Cancelled” and the current stock is recalculated without it.`,
    yes: "Cancel transaction",
  });
  if (!ok) return;
  try {
    await API.voidTransaction(id, "Cancelled by user");
    toast("Transaction cancelled — stock recalculated.", "ok");
    await refreshAfterTx();
  } catch (err) {
    toast(err.status === 409 ? "Insufficient stock — cancelling this entry would push stock below zero." : err.message, "err", 4000);
  }
}

async function restoreTx(id) {
  const ok = await confirmDialog({
    title: "Restore this transaction?",
    text: "The cancelled entry becomes active again and the current stock is recalculated with it.",
    yes: "Restore entry",
    danger: false,
  });
  if (!ok) return;
  try {
    await API.restoreTransaction(id);
    toast("Transaction restored.", "ok");
    await refreshAfterTx();
  } catch (err) {
    toast(err.status === 409 ? "Insufficient stock — restoring this entry would push stock below zero." : err.message, "err", 4000);
  }
}

async function refreshAfterTx() {
  await loadAll();
  if (state.view === "history") await loadHistory();
  renderAll();
}

