/* ============================================================
   RoadBook — Transport Business Tracker (v1)
   Single-owner app. All data persisted in localStorage.
   No dependencies, no build step.
   ============================================================ */
"use strict";

/* ---------------- utils ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
});
const fmtINR = (n) => inr.format(Math.round(Number(n) || 0));

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10));

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function dateParts(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return { day: d || "–", mon: MONTHS[(m || 1) - 1] };
}
function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/* ---------------- store ---------------- */
const LS_KEY = "roadbook.v1";
let state = { vehicles: [], drivers: [], bookings: [], expenses: [] };

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const k of ["vehicles", "drivers", "bookings", "expenses"]) {
      if (Array.isArray(parsed[k])) state[k] = parsed[k];
    }
  } catch { /* corrupted -> start fresh */ }
}
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  catch { toast("Storage full — could not save.", "error"); }
}

const vehicleById = (id) => state.vehicles.find((v) => v.id === id);
const driverById = (id) => state.drivers.find((d) => d.id === id);
const vehicleLabel = (id) => (vehicleById(id)?.number) || "Unassigned";
const driverName = (id) => (driverById(id)?.name) || "—";

/* ---------------- computed stats ---------------- */
function totals() {
  const revenue = state.bookings.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const expenses = state.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pendingList = state.bookings.filter((b) => b.status !== "Paid");
  const pendingAmount = pendingList.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  return { revenue, expenses, profit: revenue - expenses, pendingCount: pendingList.length, pendingAmount };
}

function vehicleStats(id) {
  const bookings = state.bookings.filter((b) => b.vehicleId === id);
  const expenses = state.expenses.filter((e) => e.vehicleId === id);
  const revenue = bookings.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const expTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return { bookings: bookings.length, revenue, expenses: expTotal, profit: revenue - expTotal };
}

function driverStats(id) {
  const trips = state.bookings.filter((b) => b.driverId === id);
  const tripRevenue = trips.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const paidOut = state.expenses
    .filter((e) => e.driverId === id)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return { trips: trips.length, tripRevenue, paidOut };
}

/* ---------------- toast ---------------- */
function toast(msg, type = "") {
  const wrap = $("#toastWrap");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 280);
  }, 2400);
}

/* ---------------- confirm dialog ---------------- */
let confirmResolve = null;
function confirmDialog({ title = "Are you sure?", text = "", yes = "Delete", danger = true }) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  const yesBtn = $("#confirmYes");
  yesBtn.textContent = yes;
  yesBtn.className = danger ? "btn danger" : "btn";
  $("#confirmBackdrop").hidden = false;
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(value) {
  $("#confirmBackdrop").hidden = true;
  if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
}

/* ---------------- modal ---------------- */
function openModal(title, bodyHTML) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHTML;
  $("#modalBackdrop").hidden = false;
  const first = $("#modalBody input, #modalBody select, #modalBody textarea");
  if (first && window.innerWidth > 900) setTimeout(() => first.focus(), 60);
}
function closeModal() { $("#modalBackdrop").hidden = true; $("#modalBody").innerHTML = ""; }

function markInvalid(input) {
  input.classList.add("input-error");
  input.addEventListener("input", () => input.classList.remove("input-error"), { once: true });
}

/* ---------------- router ---------------- */
const VIEW_TITLES = {
  dashboard: "Dashboard", vehicles: "Vehicles", bookings: "Bookings", drivers: "Drivers", expenses: "Expenses",
};
const VIEW_ADD = {
  dashboard: null, vehicles: "vehicle", bookings: "booking", drivers: "driver", expenses: "expense",
};
let currentView = "dashboard";

function switchView(name) {
  currentView = name;
  $$("#mainNav .nav-item[data-view], #tabbar .tab[data-view]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.view === name));
  $$(".view").forEach((v) => { v.hidden = v.id !== "view-" + name; });
  $("#viewTitle").textContent = VIEW_TITLES[name] || name;
  const add = VIEW_ADD[name];
  $("#topbarActions").innerHTML = add
    ? `<button class="btn accent" data-add="${add}">+ Add ${add}</button>`
    : `<button class="btn accent" data-add="booking">+ New booking</button>`;
  render();
}

/* ---------------- filters ---------------- */
const bookingFilter = { q: "", status: "all", vehicle: "all" };
const expenseFilter = { q: "", type: "all", vehicle: "all" };

/* ============================================================
   RENDERERS
   ============================================================ */
function render() {
  renderCounts();
  ({ dashboard: renderDashboard, vehicles: renderVehicles, bookings: renderBookings,
     drivers: renderDrivers, expenses: renderExpenses })[currentView]();
}

function renderCounts() {
  const t = totals();
  const cv = $("#countVehicles"), cd = $("#countDrivers"), cp = $("#countPending"), dot = $("#dotPending");
  cv.hidden = state.vehicles.length === 0; cv.textContent = state.vehicles.length;
  cd.hidden = state.drivers.length === 0; cd.textContent = state.drivers.length;
  cp.hidden = t.pendingCount === 0; cp.textContent = t.pendingCount;
  dot.hidden = t.pendingCount === 0;
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const t = totals();
  const el = $("#view-dashboard");
  const recentBookings = [...state.bookings].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
  const recentExpenses = [...state.expenses].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
  const isEmpty = state.bookings.length === 0 && state.expenses.length === 0 && state.vehicles.length === 0;

  el.innerHTML = `
    <div class="kpis">
      <div class="card kpi green">
        <div class="k-label">Total revenue</div>
        <div class="k-value">${fmtINR(t.revenue)}</div>
        <div class="k-sub">${state.bookings.length} booking${state.bookings.length === 1 ? "" : "s"} · all time</div>
      </div>
      <div class="card kpi red">
        <div class="k-label">Total expenses</div>
        <div class="k-value">${fmtINR(t.expenses)}</div>
        <div class="k-sub">${state.expenses.length} expense${state.expenses.length === 1 ? "" : "s"} · all time</div>
      </div>
      <div class="card kpi">
        <div class="k-label">Net profit</div>
        <div class="k-value ${t.profit >= 0 ? "pos" : "neg"}">${fmtINR(t.profit)}</div>
        <div class="k-sub">${t.revenue > 0 ? Math.round((t.profit / t.revenue) * 100) + "% margin" : "log bookings to begin"}</div>
      </div>
      <div class="card kpi amber clickable" data-goto-pending title="Show pending bookings">
        <div class="k-label">Pending payment</div>
        <div class="k-value">${fmtINR(t.pendingAmount)}</div>
        <div class="k-sub">${t.pendingCount} unpaid booking${t.pendingCount === 1 ? "" : "s"} · tap to view</div>
      </div>
    </div>

    <div class="quick-actions">
      <button class="quick-btn" data-add="booking"><span class="q-ico">🧾</span>New booking</button>
      <button class="quick-btn" data-add="expense"><span class="q-ico">⛽</span>New expense</button>
      <button class="quick-btn" data-add="vehicle"><span class="q-ico">🚚</span>New vehicle</button>
      <button class="quick-btn" data-add="driver"><span class="q-ico">🧍</span>New driver</button>
    </div>

    ${isEmpty ? `
    <div class="card empty">
      <div class="e-ico">🛣️</div>
      <h3>Welcome to RoadBook</h3>
      <p>Log your vehicles, bookings and expenses in one place and always know your real profit. Start below, or explore with sample data first.</p>
      <div class="e-actions">
        <button class="btn accent" data-add="vehicle">+ Add your first vehicle</button>
        <button class="btn ghost" data-action="sample">Try with sample data</button>
      </div>
    </div>` : `

    <div class="card card-pad" style="margin-bottom:14px">
      <div class="section-head">
        <h3>Profit per vehicle</h3><span class="spacer"></span>
        <button class="link-btn" data-goto="vehicles">Manage fleet →</button>
      </div>
      ${profitTableHTML()}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-pad section-head" style="margin:0;padding-bottom:10px">
          <h3>Recent bookings</h3><span class="spacer"></span>
          <button class="link-btn" data-goto="bookings">View all →</button>
        </div>
        <div class="row-list">
          ${recentBookings.length ? recentBookings.map(bookingRowHTML).join("") : `<div class="empty" style="padding:26px"><p>No bookings yet.</p></div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-pad section-head" style="margin:0;padding-bottom:10px">
          <h3>Recent expenses</h3><span class="spacer"></span>
          <button class="link-btn" data-goto="expenses">View all →</button>
        </div>
        <div class="row-list">
          ${recentExpenses.length ? recentExpenses.map(expenseRowHTML).join("") : `<div class="empty" style="padding:26px"><p>No expenses yet.</p></div>`}
        </div>
      </div>
    </div>`}
  `;
}

function profitTableHTML() {
  if (state.vehicles.length === 0) {
    return `<div class="empty" style="padding:24px"><p>No vehicles yet — <button class="link-btn" data-add="vehicle">add one</button> to track per-vehicle profit.</p></div>`;
  }
  const rows = state.vehicles.map((v) => ({ v, s: vehicleStats(v.id) }));
  const tRev = rows.reduce((s, r) => s + r.s.revenue, 0);
  const tExp = rows.reduce((s, r) => s + r.s.expenses, 0);
  return `
  <div class="table-wrap"><table class="data">
    <thead><tr><th>Vehicle</th><th class="num">Trips</th><th class="num">Revenue</th><th class="num">Expenses</th><th class="num">Profit</th></tr></thead>
    <tbody>
      ${rows.map(({ v, s }) => `
      <tr data-goto="vehicles">
        <td><strong>${esc(v.number)}</strong>${v.model ? `<br><small style="color:var(--muted)">${esc(v.model)}</small>` : ""}</td>
        <td class="num">${s.bookings}</td>
        <td class="num">${fmtINR(s.revenue)}</td>
        <td class="num">${fmtINR(s.expenses)}</td>
        <td class="num" style="font-weight:800;color:${s.profit >= 0 ? "var(--green)" : "var(--red)"}">${fmtINR(s.profit)}</td>
      </tr>`).join("")}
    </tbody>
    <tfoot><tr><td>Total (${rows.length} vehicle${rows.length === 1 ? "" : "s"})</td><td class="num">${rows.reduce((s, r) => s + r.s.bookings, 0)}</td><td class="num">${fmtINR(tRev)}</td><td class="num">${fmtINR(tExp)}</td><td class="num">${fmtINR(tRev - tExp)}</td></tr></tfoot>
  </table></div>`;
}

function bookingRowHTML(b) {
  const v = vehicleById(b.vehicleId);
  return `
  <div class="row-item" data-open-booking="${b.id}" style="cursor:pointer">
    <div class="ri-main">
      <div class="ri-title">${esc(b.customer || "—")} · ${esc(b.from || "?")} → ${esc(b.to || "?")}</div>
      <div class="ri-sub">${fmtDate(b.date)}${v ? " · " + esc(v.number) : ""}${b.driverId ? " · " + esc(driverName(b.driverId)) : ""}</div>
    </div>
    <span class="pill ${b.status === "Paid" ? "paid" : "pending"}">${b.status === "Paid" ? "Paid" : "Pending"}</span>
    <span class="ri-amt in">${fmtINR(b.amount)}</span>
  </div>`;
}

const EXPENSE_META = {
  "Fuel": { cls: "type-fuel", ico: "expense-ico fuel", emoji: "⛽" },
  "Driver salary": { cls: "type-salary", ico: "expense-ico salary", emoji: "🧍" },
  "Maintenance": { cls: "type-maint", ico: "expense-ico maintenance", emoji: "🔧" },
  "Other": { cls: "type-other", ico: "expense-ico other", emoji: "🧾" },
};

function expenseRowHTML(e) {
  const m = EXPENSE_META[e.type] || EXPENSE_META.Other;
  const v = vehicleById(e.vehicleId);
  return `
  <div class="row-item" data-open-expense="${e.id}" style="cursor:pointer">
    <div class="ri-main">
      <div class="ri-title">${esc(e.notes || e.type || "Expense")}</div>
      <div class="ri-sub">${fmtDate(e.date)}${v ? " · " + esc(v.number) : ""}${e.driverId ? " · " + esc(driverName(e.driverId)) : ""}</div>
    </div>
    <span class="pill ${m.cls}">${esc(e.type || "Other")}</span>
    <span class="ri-amt out">${fmtINR(e.amount)}</span>
  </div>`;
}

/* ---------- vehicles ---------- */
function renderVehicles() {
  const el = $("#view-vehicles");
  if (state.vehicles.length === 0) {
    el.innerHTML = `
      <div class="card empty">
        <div class="e-ico">🚚</div>
        <h3>No vehicles yet</h3>
        <p>Add every truck, tempo and pickup in your fleet. Each one automatically tracks its own revenue, expenses and profit.</p>
        <div class="e-actions"><button class="btn accent" data-add="vehicle">+ Add vehicle</button></div>
      </div>`;
    return;
  }
  const cards = [...state.vehicles]
    .sort((a, b) => String(a.number).localeCompare(String(b.number)))
    .map((v) => {
      const s = vehicleStats(v.id);
      const drivers = state.drivers.filter((d) => d.vehicleId === v.id);
      return `
      <div class="card vehicle-card">
        <div class="vehicle-top">
          <span class="plate">${esc(v.number)}</span>
          <div class="vehicle-meta">
            <div class="v-model">${esc(v.model || "—")}</div>
            ${v.notes ? `<div class="v-notes">${esc(v.notes)}</div>` : ""}
            ${drivers.length ? `<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">${drivers.map((d) => `<span class="tag-chip">🧍 ${esc(d.name)}</span>`).join("")}</div>` : ""}
          </div>
          <div class="vehicle-actions">
            <button class="icon-btn" data-edit-vehicle="${v.id}" title="Edit" aria-label="Edit vehicle">✎</button>
            <button class="icon-btn danger" data-del-vehicle="${v.id}" title="Delete" aria-label="Delete vehicle">🗑</button>
          </div>
        </div>
        <div class="vehicle-stats">
          <div><div class="vs-label">Revenue</div><div class="vs-value" style="color:var(--green)">${fmtINR(s.revenue)}</div><div class="vs-label" style="margin-top:2px">${s.bookings} trip${s.bookings === 1 ? "" : "s"}</div></div>
          <div><div class="vs-label">Expenses</div><div class="vs-value" style="color:var(--red)">${fmtINR(s.expenses)}</div></div>
          <div><div class="vs-label">Profit</div><div class="vs-value ${s.profit >= 0 ? "pos" : "neg"}">${fmtINR(s.profit)}</div></div>
        </div>
      </div>`;
    }).join("");
  el.innerHTML = `<div class="cards-grid">${cards}</div>`;
}

/* ---------- bookings ---------- */
function filteredBookings() {
  const q = bookingFilter.q.trim().toLowerCase();
  return state.bookings
    .filter((b) => {
      if (bookingFilter.status !== "all" && b.status !== bookingFilter.status) return false;
      if (bookingFilter.vehicle !== "all" && (b.vehicleId || "") !== bookingFilter.vehicle) return false;
      if (!q) return true;
      const hay = [b.customer, b.from, b.to, b.notes, vehicleById(b.vehicleId)?.number, driverName(b.driverId)].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
}

function renderBookings() {
  const el = $("#view-bookings");
  const list = filteredBookings();
  const rev = list.reduce((s, b) => s + (Number(b.amount) || 0), 0);

  el.innerHTML = `
    <div class="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="bookingSearch" placeholder="Search customer, route, vehicle…" value="${esc(bookingFilter.q)}" />
      </div>
      <div class="chips" id="bookingStatusChips">
        ${["all", "Paid", "Pending"].map((s) => `<button class="chip ${bookingFilter.status === s ? "is-active" : ""}" data-bstatus="${s}">${s === "all" ? "All" : s}</button>`).join("")}
      </div>
      <select id="bookingVehicleFilter" title="Filter by vehicle">
        <option value="all">All vehicles</option>
        ${state.vehicles.map((v) => `<option value="${v.id}" ${bookingFilter.vehicle === v.id ? "selected" : ""}>${esc(v.number)}</option>`).join("")}
        <option value="" ${bookingFilter.vehicle === "" ? "selected" : ""}>Unassigned</option>
      </select>
    </div>
    ${state.bookings.length === 0 ? `
    <div class="card empty">
      <div class="e-ico">🧾</div>
      <h3>No bookings yet</h3>
      <p>Every trip you log here adds to your revenue — and to that vehicle's profit.</p>
      <div class="e-actions"><button class="btn accent" data-add="booking">+ Add booking</button></div>
    </div>` : list.length === 0 ? `
    <div class="card empty"><div class="e-ico">🔍</div><h3>No matches</h3><p>Try a different search or filter.</p></div>` : `
    <div class="total-strip"><span>Showing ${list.length} booking${list.length === 1 ? "" : "s"}</span><strong>${fmtINR(rev)}</strong></div>
    <div style="display:flex;flex-direction:column;gap:12px">
      ${list.map(bookingCardHTML).join("")}
    </div>`}
  `;

  $("#bookingSearch").addEventListener("input", (e) => {
    bookingFilter.q = e.target.value;
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => { renderBookings(); const s = $("#bookingSearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250);
  });
  $("#bookingVehicleFilter").addEventListener("change", (e) => { bookingFilter.vehicle = e.target.value; renderBookings(); });
}

function bookingCardHTML(b) {
  const p = dateParts(b.date);
  const v = vehicleById(b.vehicleId);
  const d = driverById(b.driverId);
  return `
  <div class="card booking-card">
    <div class="booking-date"><div class="d-day">${p.day}</div><div class="d-mon">${p.mon}</div></div>
    <div class="booking-main">
      <div class="booking-route">${esc(b.from || "?")} <span class="arrow">→</span> ${esc(b.to || "?")}</div>
      <div class="booking-sub">
        <span class="tag-chip">👤 ${esc(b.customer || "—")}</span>
        ${v ? `<span class="pill vehicle">${esc(v.number)}</span>` : `<span class="tag-chip">No vehicle</span>`}
        ${d ? `<span class="tag-chip">🧍 ${esc(d.name)}</span>` : ""}
      </div>
      ${b.notes ? `<div class="booking-sub" style="margin-top:6px">📝 ${esc(b.notes)}</div>` : ""}
    </div>
    <div class="booking-side">
      <div class="booking-amt">${fmtINR(b.amount)}</div>
      <span class="pill ${b.status === "Paid" ? "paid" : "pending"} clickable" data-toggle-status="${b.id}" title="Tap to toggle Paid / Pending">${b.status === "Paid" ? "✓ Paid" : "⏳ Pending"}</span>
      <div style="display:flex;gap:6px">
        <button class="icon-btn" data-edit-booking="${b.id}" title="Edit">✎</button>
        <button class="icon-btn danger" data-del-booking="${b.id}" title="Delete">🗑</button>
      </div>
    </div>
  </div>`;
}

/* ---------- drivers ---------- */
function renderDrivers() {
  const el = $("#view-drivers");
  if (state.drivers.length === 0) {
    el.innerHTML = `
      <div class="card empty">
        <div class="e-ico">🧍</div>
        <h3>No drivers yet</h3>
        <p>Add your drivers with their phone numbers, assigned vehicles and salary details.</p>
        <div class="e-actions"><button class="btn accent" data-add="driver">+ Add driver</button></div>
      </div>`;
    return;
  }
  el.innerHTML = `<div class="cards-grid">${[...state.drivers].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((d) => {
    const s = driverStats(d.id);
    const v = vehicleById(d.vehicleId);
    const salary = d.salaryAmount ? `${d.salaryType === "Per trip" ? "per trip" : "/month"} · ${fmtINR(d.salaryAmount)}` : (d.salaryType || "—");
    return `
    <div class="card driver-card">
      <div class="avatar">${esc(initials(d.name))}</div>
      <div class="driver-main">
        <div class="driver-name">${esc(d.name)}</div>
        <div class="driver-phone">${d.phone ? `<a href="tel:${esc(d.phone.replace(/\s/g, ""))}">📞 ${esc(d.phone)}</a>` : "No phone number"}</div>
        <div class="driver-tags">
          ${v ? `<span class="pill vehicle">${esc(v.number)}</span>` : `<span class="tag-chip">No vehicle assigned</span>`}
          <span class="tag-chip">💰 ${esc(salary)}</span>
        </div>
        <div class="driver-tags">
          <span class="tag-chip">🚛 ${s.trips} trip${s.trips === 1 ? "" : "s"} · ${fmtINR(s.tripRevenue)}</span>
          <span class="tag-chip">✅ Paid out ${fmtINR(s.paidOut)}</span>
        </div>
      </div>
      <div class="vehicle-actions" style="display:flex;gap:6px;flex-shrink:0">
        <button class="icon-btn" data-edit-driver="${d.id}" title="Edit">✎</button>
        <button class="icon-btn danger" data-del-driver="${d.id}" title="Delete">🗑</button>
      </div>
    </div>`;
  }).join("")}</div>`;
}

/* ---------- expenses ---------- */
function filteredExpenses() {
  const q = expenseFilter.q.trim().toLowerCase();
  return state.expenses
    .filter((e) => {
      if (expenseFilter.type !== "all" && e.type !== expenseFilter.type) return false;
      if (expenseFilter.vehicle !== "all" && (e.vehicleId || "") !== expenseFilter.vehicle) return false;
      if (!q) return true;
      const hay = [e.notes, e.type, vehicleById(e.vehicleId)?.number, driverName(e.driverId)].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
}

function renderExpenses() {
  const el = $("#view-expenses");
  const list = filteredExpenses();
  const total = list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const types = ["all", "Fuel", "Driver salary", "Maintenance", "Other"];

  el.innerHTML = `
    <div class="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="expenseSearch" placeholder="Search expenses…" value="${esc(expenseFilter.q)}" />
      </div>
      <select id="expenseVehicleFilter" title="Filter by vehicle">
        <option value="all">All vehicles</option>
        ${state.vehicles.map((v) => `<option value="${v.id}" ${expenseFilter.vehicle === v.id ? "selected" : ""}>${esc(v.number)}</option>`).join("")}
        <option value="" ${expenseFilter.vehicle === "" ? "selected" : ""}>Unassigned</option>
      </select>
    </div>
    <div class="chips" id="expenseTypeChips" style="margin-bottom:14px">
      ${types.map((t) => `<button class="chip ${expenseFilter.type === t ? "is-active" : ""}" data-etype="${t}">${t === "all" ? "All types" : t}</button>`).join("")}
    </div>
    ${state.expenses.length === 0 ? `
    <div class="card empty">
      <div class="e-ico">⛽</div>
      <h3>No expenses yet</h3>
      <p>Log fuel, driver salaries, maintenance and everything else — know exactly where the money goes.</p>
      <div class="e-actions"><button class="btn accent" data-add="expense">+ Add expense</button></div>
    </div>` : list.length === 0 ? `
    <div class="card empty"><div class="e-ico">🔍</div><h3>No matches</h3><p>Try a different search or filter.</p></div>` : `
    <div class="total-strip"><span>Showing ${list.length} expense${list.length === 1 ? "" : "s"}</span><strong>${fmtINR(total)}</strong></div>
    <div class="card"><div class="row-list">
      ${list.map((e) => {
        const m = EXPENSE_META[e.type] || EXPENSE_META.Other;
        const v = vehicleById(e.vehicleId);
        return `
        <div class="expense-row">
          <div class="${m.ico}">${m.emoji}</div>
          <div class="ri-main">
            <div class="ri-title">${esc(e.notes || e.type || "Expense")}</div>
            <div class="ri-sub">${fmtDate(e.date)}${v ? " · " + esc(v.number) : ""}${e.driverId ? " · " + esc(driverName(e.driverId)) : ""}</div>
          </div>
          <span class="pill ${m.cls}">${esc(e.type || "Other")}</span>
          <span class="ri-amt out">${fmtINR(e.amount)}</span>
          <div style="display:flex;gap:6px">
            <button class="icon-btn" data-edit-expense="${e.id}" title="Edit">✎</button>
            <button class="icon-btn danger" data-del-expense="${e.id}" title="Delete">🗑</button>
          </div>
        </div>`;
      }).join("")}
    </div></div>`}
  `;

  $("#expenseSearch").addEventListener("input", (e) => {
    expenseFilter.q = e.target.value;
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => { renderExpenses(); const s = $("#expenseSearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250);
  });
  $("#expenseVehicleFilter").addEventListener("change", (e) => { expenseFilter.vehicle = e.target.value; renderExpenses(); });
}

/* ============================================================
   FORMS
   ============================================================ */
function vehicleOptions(selected = "", { allowEmpty = true, emptyLabel = "— No vehicle —" } = {}) {
  return `${allowEmpty ? `<option value="">${emptyLabel}</option>` : ""}` +
    state.vehicles.map((v) => `<option value="${v.id}" ${selected === v.id ? "selected" : ""}>${esc(v.number)}${v.model ? " · " + esc(v.model) : ""}</option>`).join("");
}
function driverOptions(selected = "") {
  return `<option value="">— No driver —</option>` +
    state.drivers.map((d) => `<option value="${d.id}" ${selected === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("");
}

/* ----- vehicle form ----- */
function vehicleForm(v = {}) {
  openModal(v.id ? "Edit vehicle" : "Add vehicle", `
    <form id="entityForm" novalidate>
      <div class="field"><label>Number plate <span class="req">*</span></label>
        <input name="number" placeholder="e.g. GJ-01-AB-1234" value="${esc(v.number || "")}" maxlength="20" autocomplete="off" style="text-transform:uppercase" /></div>
      <div class="field"><label>Model / type</label>
        <input name="model" placeholder="e.g. Tata Ace, Eicher 14ft…" value="${esc(v.model || "")}" maxlength="60" autocomplete="off" /></div>
      <div class="field"><label>Notes</label>
        <textarea name="notes" placeholder="Anything worth remembering…">${esc(v.notes || "")}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn accent">${v.id ? "Save changes" : "Add vehicle"}</button>
      </div>
    </form>`);
  $("#entityForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const number = String(fd.get("number") || "").trim().toUpperCase();
    if (!number) { markInvalid(e.target.number); toast("Number plate is required.", "error"); return; }
    const dupe = state.vehicles.find((x) => x.number.toUpperCase() === number && x.id !== v.id);
    if (dupe) { markInvalid(e.target.number); toast("That number plate already exists.", "error"); return; }
    const data = { number, model: String(fd.get("model") || "").trim(), notes: String(fd.get("notes") || "").trim() };
    if (v.id) Object.assign(vehicleById(v.id), data);
    else state.vehicles.push({ id: uid(), createdAt: Date.now(), ...data });
    saveState(); closeModal(); render();
    toast(v.id ? "Vehicle updated." : "Vehicle added to your fleet.", "success");
  });
}

/* ----- booking form ----- */
function bookingForm(b = {}) {
  if (state.vehicles.length === 0 && !b.id) {
    toast("Add a vehicle first, then log bookings against it.");
  }
  openModal(b.id ? "Edit booking" : "New booking", `
    <form id="entityForm" novalidate>
      <div class="field-row">
        <div class="field"><label>Date <span class="req">*</span></label>
          <input type="date" name="date" value="${esc(b.date || todayISO())}" max="2100-01-01" /></div>
        <div class="field"><label>Amount charged (₹) <span class="req">*</span></label>
          <input type="number" name="amount" inputmode="numeric" min="0" step="1" placeholder="e.g. 4500" value="${b.amount ?? ""}" /></div>
      </div>
      <div class="field"><label>Customer name <span class="req">*</span></label>
        <input name="customer" placeholder="e.g. Sharma Traders" value="${esc(b.customer || "")}" maxlength="80" autocomplete="off" /></div>
      <div class="field-row">
        <div class="field"><label>Pickup location <span class="req">*</span></label>
          <input name="from" placeholder="e.g. Ahmedabad" value="${esc(b.from || "")}" maxlength="80" autocomplete="off" /></div>
        <div class="field"><label>Drop location <span class="req">*</span></label>
          <input name="to" placeholder="e.g. Vadodara" value="${esc(b.to || "")}" maxlength="80" autocomplete="off" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Vehicle</label>
          <select name="vehicleId">${vehicleOptions(b.vehicleId || "")}</select>
          ${state.vehicles.length === 0 ? `<span class="hint">No vehicles yet — <a href="#" data-add="vehicle">add one</a> to track per-vehicle profit.</span>` : ""}</div>
        <div class="field"><label>Driver</label>
          <select name="driverId">${driverOptions(b.driverId || "")}</select></div>
      </div>
      <div class="field"><label>Payment status</label>
        <select name="status">
          <option value="Pending" ${(b.status || "Pending") === "Pending" ? "selected" : ""}>⏳ Pending (unpaid)</option>
          <option value="Paid" ${b.status === "Paid" ? "selected" : ""}>✓ Paid</option>
        </select></div>
      <div class="field"><label>Notes</label>
        <textarea name="notes" placeholder="Load details, advance received…">${esc(b.notes || "")}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn accent">${b.id ? "Save changes" : "Add booking"}</button>
      </div>
    </form>`);
  $("#entityForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    const data = {
      date: String(fd.get("date") || ""),
      customer: String(fd.get("customer") || "").trim(),
      from: String(fd.get("from") || "").trim(),
      to: String(fd.get("to") || "").trim(),
      vehicleId: String(fd.get("vehicleId") || ""),
      driverId: String(fd.get("driverId") || ""),
      amount: Math.max(0, Math.round(Number(fd.get("amount")) || 0)),
      status: String(fd.get("status") || "Pending"),
      notes: String(fd.get("notes") || "").trim(),
    };
    let ok = true;
    if (!data.date) { markInvalid(f.date); ok = false; }
    if (!data.amount) { markInvalid(f.amount); ok = false; }
    if (!data.customer) { markInvalid(f.customer); ok = false; }
    if (!data.from) { markInvalid(f.from); ok = false; }
    if (!data.to) { markInvalid(f.to); ok = false; }
    if (!ok) { toast("Please fill the highlighted fields.", "error"); return; }
    if (b.id) Object.assign(state.bookings.find((x) => x.id === b.id), data);
    else state.bookings.push({ id: uid(), createdAt: Date.now(), ...data });
    saveState(); closeModal(); render();
    toast(b.id ? "Booking updated." : `Booking added · ${fmtINR(data.amount)}`, "success");
  });
}

/* ----- driver form ----- */
function driverForm(d = {}) {
  openModal(d.id ? "Edit driver" : "Add driver", `
    <form id="entityForm" novalidate>
      <div class="field"><label>Full name <span class="req">*</span></label>
        <input name="name" placeholder="e.g. Ramesh Kumar" value="${esc(d.name || "")}" maxlength="80" autocomplete="off" /></div>
      <div class="field-row">
        <div class="field"><label>Phone number</label>
          <input name="phone" inputmode="tel" placeholder="e.g. 98765 43210" value="${esc(d.phone || "")}" maxlength="16" autocomplete="off" /></div>
        <div class="field"><label>Vehicle assigned</label>
          <select name="vehicleId">${vehicleOptions(d.vehicleId || "")}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Salary type</label>
          <select name="salaryType">
            <option value="Fixed monthly" ${(d.salaryType || "Fixed monthly") === "Fixed monthly" ? "selected" : ""}>Fixed monthly</option>
            <option value="Per trip" ${d.salaryType === "Per trip" ? "selected" : ""}>Per trip</option>
          </select></div>
        <div class="field"><label>Salary amount (₹)</label>
          <input type="number" name="salaryAmount" min="0" step="1" placeholder="e.g. 15000" value="${d.salaryAmount ?? ""}" /></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn accent">${d.id ? "Save changes" : "Add driver"}</button>
      </div>
    </form>`);
  $("#entityForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get("name") || "").trim();
    if (!name) { markInvalid(e.target.name); toast("Driver name is required.", "error"); return; }
    const data = {
      name,
      phone: String(fd.get("phone") || "").trim(),
      vehicleId: String(fd.get("vehicleId") || ""),
      salaryType: String(fd.get("salaryType") || "Fixed monthly"),
      salaryAmount: Math.max(0, Math.round(Number(fd.get("salaryAmount")) || 0)),
    };
    if (d.id) Object.assign(driverById(d.id), data);
    else state.drivers.push({ id: uid(), createdAt: Date.now(), ...data });
    saveState(); closeModal(); render();
    toast(d.id ? "Driver updated." : "Driver added.", "success");
  });
}

/* ----- expense form ----- */
function expenseForm(x = {}) {
  openModal(x.id ? "Edit expense" : "New expense", `
    <form id="entityForm" novalidate>
      <div class="field-row">
        <div class="field"><label>Date <span class="req">*</span></label>
          <input type="date" name="date" value="${esc(x.date || todayISO())}" max="2100-01-01" /></div>
        <div class="field"><label>Amount (₹) <span class="req">*</span></label>
          <input type="number" name="amount" inputmode="numeric" min="0" step="1" placeholder="e.g. 2000" value="${x.amount ?? ""}" /></div>
      </div>
      <div class="field"><label>Type</label>
        <select name="type">
          ${["Fuel", "Driver salary", "Maintenance", "Other"].map((t) => `<option ${x.type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select></div>
      <div class="field-row">
        <div class="field"><label>Linked vehicle</label>
          <select name="vehicleId">${vehicleOptions(x.vehicleId || "")}</select></div>
        <div class="field"><label>Linked driver</label>
          <select name="driverId">${driverOptions(x.driverId || "")}</select></div>
      </div>
      <div class="field"><label>Notes</label>
        <textarea name="notes" placeholder="e.g. Diesel 40L, Oct salary, tyre puncture…">${esc(x.notes || "")}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn accent">${x.id ? "Save changes" : "Add expense"}</button>
      </div>
    </form>`);
  $("#entityForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    const data = {
      date: String(fd.get("date") || ""),
      type: String(fd.get("type") || "Other"),
      vehicleId: String(fd.get("vehicleId") || ""),
      driverId: String(fd.get("driverId") || ""),
      amount: Math.max(0, Math.round(Number(fd.get("amount")) || 0)),
      notes: String(fd.get("notes") || "").trim(),
    };
    let ok = true;
    if (!data.date) { markInvalid(f.date); ok = false; }
    if (!data.amount) { markInvalid(f.amount); ok = false; }
    if (!ok) { toast("Date and amount are required.", "error"); return; }
    if (x.id) Object.assign(state.expenses.find((i) => i.id === x.id), data);
    else state.expenses.push({ id: uid(), createdAt: Date.now(), ...data });
    saveState(); closeModal(); render();
    toast(x.id ? "Expense updated." : `Expense added · ${fmtINR(data.amount)}`, "success");
  });
}

/* ============================================================
   DELETE (with safe unlinking)
   ============================================================ */
async function deleteVehicle(id) {
  const v = vehicleById(id);
  if (!v) return;
  const nb = state.bookings.filter((b) => b.vehicleId === id).length;
  const ne = state.expenses.filter((e) => e.vehicleId === id).length;
  const nd = state.drivers.filter((d) => d.vehicleId === id).length;
  const linked = nb + ne + nd;
  const ok = await confirmDialog({
    title: `Delete ${v.number}?`,
    text: linked
      ? `This vehicle has ${nb} booking(s), ${ne} expense(s) and ${nd} driver(s) linked. They will be kept but unassigned from it. This cannot be undone.`
      : "This vehicle will be permanently removed. This cannot be undone.",
  });
  if (!ok) return;
  state.vehicles = state.vehicles.filter((x) => x.id !== id);
  state.bookings.forEach((b) => { if (b.vehicleId === id) b.vehicleId = ""; });
  state.expenses.forEach((e) => { if (e.vehicleId === id) e.vehicleId = ""; });
  state.drivers.forEach((d) => { if (d.vehicleId === id) d.vehicleId = ""; });
  saveState(); render(); toast("Vehicle deleted.", "success");
}

async function deleteDriver(id) {
  const d = driverById(id);
  if (!d) return;
  const nb = state.bookings.filter((b) => b.driverId === id).length;
  const ne = state.expenses.filter((e) => e.driverId === id).length;
  const ok = await confirmDialog({
    title: `Delete ${d.name}?`,
    text: (nb + ne)
      ? `${nb} booking(s) and ${ne} expense(s) reference this driver. They will be kept but unassigned. This cannot be undone.`
      : "This driver will be permanently removed. This cannot be undone.",
  });
  if (!ok) return;
  state.drivers = state.drivers.filter((x) => x.id !== id);
  state.bookings.forEach((b) => { if (b.driverId === id) b.driverId = ""; });
  state.expenses.forEach((e) => { if (e.driverId === id) e.driverId = ""; });
  saveState(); render(); toast("Driver deleted.", "success");
}

async function deleteBooking(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;
  const ok = await confirmDialog({
    title: "Delete this booking?",
    text: `${b.customer || ""} · ${b.from || ""} → ${b.to || ""} · ${fmtINR(b.amount)}. This cannot be undone.`,
  });
  if (!ok) return;
  state.bookings = state.bookings.filter((x) => x.id !== id);
  saveState(); render(); toast("Booking deleted.", "success");
}

async function deleteExpense(id) {
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return;
  const ok = await confirmDialog({
    title: "Delete this expense?",
    text: `${e.type || "Expense"} · ${fmtINR(e.amount)}${e.notes ? " · " + e.notes : ""}. This cannot be undone.`,
  });
  if (!ok) return;
  state.expenses = state.expenses.filter((x) => x.id !== id);
  saveState(); render(); toast("Expense deleted.", "success");
}

/* ============================================================
   BACKUP / SETTINGS / SAMPLE DATA
   ============================================================ */
function openSettings() {
  const t = totals();
  openModal("Backup & settings", `
    <div class="settings-list">
      <button class="settings-item" data-action="export"><span class="s-ico">💾</span><span>Download backup<small>${state.vehicles.length} vehicles · ${state.bookings.length} bookings · ${state.expenses.length} expenses · ${fmtINR(t.profit)} profit</small></span></button>
      <button class="settings-item" data-action="import"><span class="s-ico">📥</span><span>Restore from backup<small>Import a previously downloaded JSON file</small></span></button>
      <button class="settings-item" data-action="sample"><span class="s-ico">🛣️</span><span>Load sample data<small>Explore the app with a demo fleet (adds to existing data)</small></span></button>
      <button class="settings-item danger-zone" data-action="clear"><span class="s-ico">🗑️</span><span>Delete all data<small>Removes everything on this device</small></span></button>
    </div>
    <p class="hint" style="font-size:12.5px;color:var(--muted);margin:14px 2px 0">RoadBook v1 · single-owner · data stays in this browser's local storage.</p>`);
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: "RoadBook", version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `roadbook-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Backup downloaded.", "success");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed.data || parsed;
      if (!data || !Array.isArray(data.bookings)) throw new Error("bad file");
      const ok = await confirmDialog({
        title: "Restore this backup?",
        text: `It contains ${data.vehicles?.length || 0} vehicles, ${data.bookings?.length || 0} bookings and ${data.expenses?.length || 0} expenses. Current data on this device will be replaced.`,
        yes: "Restore", danger: false,
      });
      if (!ok) return;
      for (const k of ["vehicles", "drivers", "bookings", "expenses"]) {
        state[k] = Array.isArray(data[k]) ? data[k] : [];
      }
      saveState(); closeModal(); render();
      toast("Backup restored.", "success");
    } catch { toast("That file is not a valid RoadBook backup.", "error"); }
  };
  reader.readAsText(file);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadSampleData() {
  const v1 = uid(), v2 = uid(), v3 = uid();
  const d1 = uid(), d2 = uid(), d3 = uid();
  state.vehicles.push(
    { id: v1, createdAt: Date.now(), number: "GJ-01-AB-1234", model: "Tata Ace", notes: "City deliveries" },
    { id: v2, createdAt: Date.now(), number: "MH-12-CD-5678", model: "Eicher 14ft", notes: "Long routes" },
    { id: v3, createdAt: Date.now(), number: "RJ-14-EF-9012", model: "Bolero Pickup", notes: "" },
  );
  state.drivers.push(
    { id: d1, createdAt: Date.now(), name: "Ramesh Kumar", phone: "98765 43210", vehicleId: v1, salaryType: "Fixed monthly", salaryAmount: 15000 },
    { id: d2, createdAt: Date.now(), name: "Suresh Patel", phone: "98250 11123", vehicleId: v2, salaryType: "Per trip", salaryAmount: 800 },
    { id: d3, createdAt: Date.now(), name: "Amit Singh", phone: "99820 45678", vehicleId: v3, salaryType: "Fixed monthly", salaryAmount: 14000 },
  );
  const B = (days, customer, from, to, vehicleId, driverId, amount, status, notes = "") =>
    ({ id: uid(), createdAt: Date.now() - days * 86400000, date: daysAgo(days), customer, from, to, vehicleId, driverId, amount, status, notes });
  state.bookings.push(
    B(1, "Sharma Traders", "Ahmedabad", "Vadodara", v1, d1, 4500, "Paid", "Electronics cartons"),
    B(2, "FreshFoods Mart", "Indore", "Bhopal", v2, d2, 9200, "Pending", "Cold storage goods"),
    B(4, "Rajesh Textiles", "Surat", "Ahmedabad", v1, d1, 5200, "Paid"),
    B(6, "BuildWell Cement", "Jaipur", "Ajmer", v3, d3, 6800, "Paid", "50 bags"),
    B(9, "Sharma Traders", "Vadodara", "Surat", v1, d1, 4800, "Pending"),
    B(12, "CityKart Logistics", "Bhopal", "Indore", v2, d2, 8900, "Paid", "Return load"),
    B(15, "AgroFresh Co.", "Nashik", "Pune", v2, d2, 7400, "Paid", "Onions 2T"),
    B(18, "Marble House", "Ajmer", "Jaipur", v3, d3, 6100, "Paid"),
  );
  const X = (days, type, vehicleId, driverId, amount, notes) =>
    ({ id: uid(), createdAt: Date.now() - days * 86400000, date: daysAgo(days), type, vehicleId, driverId, amount, notes });
  state.expenses.push(
    X(1, "Fuel", v1, "", 2000, "Diesel 22L"),
    X(2, "Fuel", v2, "", 4500, "Diesel 50L"),
    X(3, "Driver salary", "", d1, 15000, "Monthly salary"),
    X(5, "Maintenance", v1, "", 1200, "Tyre puncture + service"),
    X(7, "Fuel", v3, "", 2800, "Diesel 30L"),
    X(10, "Driver salary", "", d2, 2400, "3 trips × ₹800"),
    X(13, "Fuel", v2, "", 4200, "Diesel 46L"),
    X(16, "Maintenance", v2, "", 3500, "Brake pads"),
    X(17, "Other", "", "", 600, "Toll + parking"),
  );
  saveState(); closeModal(); render();
  toast("Sample fleet loaded — explore away!", "success");
}

/* ============================================================
   EVENTS
   ============================================================ */
function bindEvents() {
  document.addEventListener("click", async (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav) { switchView(nav.dataset.view); return; }

    const add = e.target.closest("[data-add]");
    if (add) {
      e.preventDefault();
      $("#sheetBackdrop").hidden = true;
      const kind = add.dataset.add;
      if (kind === "vehicle") vehicleForm();
      else if (kind === "booking") bookingForm();
      else if (kind === "driver") driverForm();
      else if (kind === "expense") expenseForm();
      return;
    }

    if (e.target.closest('[data-action="quick-add"]') || e.target.closest('[data-action="open-sheet"]')) {
      $("#sheetBackdrop").hidden = false; return;
    }
    const quickAdd = e.target.closest('[data-action="quick-add"]');
    if (quickAdd) return;

    const goto = e.target.closest("[data-goto]");
    if (goto) { switchView(goto.dataset.goto); return; }

    if (e.target.closest("[data-goto-pending]")) {
      bookingFilter.status = "Pending"; bookingFilter.q = ""; bookingFilter.vehicle = "all";
      switchView("bookings"); return;
    }

    const chip = e.target.closest("[data-bstatus]");
    if (chip) { bookingFilter.status = chip.dataset.bstatus; renderBookings(); return; }
    const echip = e.target.closest("[data-etype]");
    if (echip) { expenseFilter.type = echip.dataset.etype; renderExpenses(); return; }

    const tgl = e.target.closest("[data-toggle-status]");
    if (tgl) {
      const b = state.bookings.find((x) => x.id === tgl.dataset.toggleStatus);
      if (b) {
        b.status = b.status === "Paid" ? "Pending" : "Paid";
        saveState(); render();
        toast(b.status === "Paid" ? "Marked as paid. ✓" : "Marked as pending.", "success");
      }
      return;
    }

    const openB = e.target.closest("[data-open-booking]");
    if (openB && !e.target.closest("button")) {
      const b = state.bookings.find((x) => x.id === openB.dataset.openBooking);
      if (b) bookingForm(b);
      return;
    }
    const openX = e.target.closest("[data-open-expense]");
    if (openX && !e.target.closest("button")) {
      const x = state.expenses.find((i) => i.id === openX.dataset.openExpense);
      if (x) expenseForm(x);
      return;
    }

    const ev = e.target.closest("[data-edit-vehicle]"); if (ev) { vehicleForm(vehicleById(ev.dataset.editVehicle)); return; }
    const dv = e.target.closest("[data-del-vehicle]"); if (dv) { deleteVehicle(dv.dataset.delVehicle); return; }
    const eb = e.target.closest("[data-edit-booking]"); if (eb) { bookingForm(state.bookings.find((x) => x.id === eb.dataset.editBooking)); return; }
    const db = e.target.closest("[data-del-booking]"); if (db) { deleteBooking(db.dataset.delBooking); return; }
    const ed = e.target.closest("[data-edit-driver]"); if (ed) { driverForm(driverById(ed.dataset.editDriver)); return; }
    const dd = e.target.closest("[data-del-driver]"); if (dd) { deleteDriver(dd.dataset.delDriver); return; }
    const ee = e.target.closest("[data-edit-expense]"); if (ee) { expenseForm(state.expenses.find((x) => x.id === ee.dataset.editExpense)); return; }
    const de = e.target.closest("[data-del-expense]"); if (de) { deleteExpense(de.dataset.delExpense); return; }

    if (e.target.closest("[data-close]")) { closeModal(); return; }

    const action = e.target.closest("[data-action]");
    if (action) {
      const a = action.dataset.action;
      if (a === "sample") loadSampleData();
      else if (a === "export") exportData();
      else if (a === "import") $("#importFile").click();
      else if (a === "clear") {
        const ok = await confirmDialog({ title: "Delete ALL data?", text: "Every vehicle, booking, driver and expense on this device will be permanently removed.", yes: "Delete everything" });
        if (ok) { state = { vehicles: [], drivers: [], bookings: [], expenses: [] }; saveState(); closeModal(); render(); toast("All data cleared."); }
      }
      return;
    }
  });

  // mobile "+" tab opens the action sheet
  $("#tabbar").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="quick-add"]')) $("#sheetBackdrop").hidden = false;
  });
  $("#sheetBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "sheetBackdrop" || e.target.closest('[data-add=""]')) $("#sheetBackdrop").hidden = true;
  });

  $("#btnBackup").addEventListener("click", openSettings);
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
  $("#confirmBackdrop").addEventListener("click", (e) => { if (e.target.id === "confirmBackdrop") closeConfirm(false); });
  $("#confirmYes").addEventListener("click", () => closeConfirm(true));
  $("#confirmNo").addEventListener("click", () => closeConfirm(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#confirmBackdrop").hidden) closeConfirm(false);
      else if (!$("#sheetBackdrop").hidden) $("#sheetBackdrop").hidden = true;
      else if (!$("#modalBackdrop").hidden) closeModal();
    }
  });
  $("#importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
}

/* ---------------- init ---------------- */
loadState();
bindEvents();
switchView("dashboard");
