/* ============================================================
   StockBook — core: helpers, API client, state, UI primitives
   ============================================================ */
"use strict";

/* ---------------- DOM helpers ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- numbers & dates ---------------- */
const nf = new Intl.NumberFormat("en-IN");
const num = (n) => nf.format(Math.trunc(Number(n) || 0));
const signed = (n) => (Number(n) > 0 ? "+" : Number(n) < 0 ? "−" : "") + num(Math.abs(Number(n) || 0));

const pad = (n) => String(n).padStart(2, "0");
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function fmtShort(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]}`;
}
function fmtDateTime(isoTs) {
  if (!isoTs) return "—";
  const d = new Date(isoTs);
  if (isNaN(d)) return isoTs;
  return `${fmtDate(isoTs.slice(0, 10))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const isToday = (iso) => String(iso || "").slice(0, 10) === todayISO();

/* ---------------- icons ---------------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  box: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  boxes: '<path d="M3 8l5-2.5L13 8l-5 2.5z"/><path d="M3 8v6l5 2.5V10"/><path d="M13 8v6l-5 2.5"/><path d="M13 14l5-2.5 5 2.5-5 2.5z"/><path d="M13 14v4l5 2.5v-4"/>',
  warehouse: '<path d="M3 21V9l9-5 9 5v12"/><path d="M3 21h18"/><path d="M8 21v-6h8v6"/><path d="M8 17h8"/>',
  down: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  up: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  list: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".7" fill="currentColor"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  cart: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 11h18"/><path d="M9 7V5h6v2"/>',
  pieces: '<circle cx="7" cy="8" r="2.4"/><circle cx="16" cy="8" r="2.4"/><circle cx="7" cy="16.5" r="2.4"/><circle cx="16" cy="16.5" r="2.4"/>',
  total: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/><path d="M18 15l3 3-3 3"/>',
  download: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/>',
  filter: '<path d="M4 6h16l-6 7v5l-4 2v-7z"/>',
  swap: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  undo: '<path d="M4 10h10a5 5 0 0 1 0 10h-4"/><path d="M8 6l-4 4 4 4"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

/* ---------------- transaction types ---------------- */
const TYPE_META = {
  OPENING:    { label: "Opening",    cls: "open",     icon: "box",     sign: 1 },
  INBOUND:    { label: "Inbound",    cls: "in",       icon: "down",    sign: 1 },
  OUTBOUND:   { label: "Outbound",   cls: "out",      icon: "up",      sign: -1 },
  ADJUSTMENT: { label: "Adjustment", cls: "adj",      icon: "swap",    sign: 0 },
  TRANSFER:   { label: "Transfer",   cls: "transfer", icon: "swap",    sign: 0 },
};
const typeBadge = (t) => {
  const m = TYPE_META[t] || { label: t, cls: "transfer", icon: "box" };
  return `<span class="badge ${m.cls}">${icon(m.icon)}${esc(m.label)}</span>`;
};

/* quantity helpers -------------------------------------------------
   `s` is a { total_pcs, cartons, pcs } object produced by the server. */
const qtyShort = (s) => (s ? `${num(s.cartons)} ctn + ${num(s.pcs)} pcs` : "—");
const qtyLong = (s) => (s ? `${num(s.cartons)} Cartoon + ${num(s.pcs)} PCS  ( ${num(s.total_pcs)} PCS )` : "—");

function stockHtml(s, { big = false } = {}) {
  if (!s) return `<span class="unit-sub">—</span>`;
  const zero = !s.total_pcs;
  return `<span class="stock-strong ${big ? "big-num " : ""}${zero ? "zero" : ""}">${num(s.cartons)} <span class="unit-sub">ctn</span> ${num(s.pcs)} <span class="unit-sub">pcs</span></span>`;
}

function thumbHtml(p, size = "") {
  if (p && p.image) {
    return `<img class="thumb ${size}" src="${esc(p.image)}" alt="${esc(p.name || "product")}" loading="lazy"
              data-action="zoom" data-src="${esc(p.image)}" data-cap="${esc(p.name || "")}"
              onerror="this.style.display='none'" />`;
  }
  return `<span class="thumb-ph ${size}">${icon("image")}</span>`;
}

/* ---------------- API client ---------------- */
class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function apiRequest(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    state.online = false;
    renderOffline();
    throw new ApiError("Cannot reach the server. Check that StockBook is running (npm start).", 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    state.online = false;
    renderOffline();
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.detail);
  }
  if (!state.online) { state.online = true; renderOffline(); }
  return data;
}

const API = {
  health: () => apiRequest("/api/health"),
  bootstrap: (params = {}) => apiRequest(`/api/bootstrap?${qs(params)}`),
  products: (params = {}) => apiRequest(`/api/products?${qs(params)}`),
  createProduct: (body) => apiRequest("/api/products", { method: "POST", body }),
  updateProduct: (id, body) => apiRequest(`/api/products/${id}`, { method: "PATCH", body }),
  transactions: (params = {}) => apiRequest(`/api/transactions?${qs(params)}`),
  addTransaction: (body) => apiRequest("/api/transactions", { method: "POST", body }),
  updateTransaction: (id, body) => apiRequest(`/api/transactions/${id}`, { method: "PATCH", body }),
  voidTransaction: (id, reason) => apiRequest(`/api/transactions/${id}?${qs({ reason })}`, { method: "DELETE" }),
  restoreTransaction: (id) => apiRequest(`/api/transactions/${id}/restore`, { method: "POST" }),
  summary: (params = {}) => apiRequest(`/api/summary?${qs(params)}`),
  csvUrl: (params = {}) => `/api/export/transactions.csv?${qs(params)}`,
};

function qs(obj) {
  return Object.entries(obj || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/* ---------------- app state ---------------- */
const state = {
  ready: false,
  online: true,
  view: "dashboard",
  warehouseId: 0,             // 0 = all warehouses (global scope)
  warehouses: [],
  products: [],               // products in the current scope
  allProducts: [],            // every product (used by pickers/selects)
  summary: null,
  recent: [],
  todayTx: [],
  today: todayISO(),
  inv: { q: "" },             // inventory search
  hist: { q: "", from: "", to: "", warehouseId: 0, productId: 0, type: "" },
  history: [],
  historyTotals: null,
  pendingImage: null,         // { data, mime, name } waiting to be uploaded
};

const warehouseName = (id) => state.warehouses.find((w) => w.id === Number(id))?.name || "—";
const scopeName = () => (state.warehouseId ? warehouseName(state.warehouseId) : "All warehouses");
const productById = (id) => state.allProducts.find((p) => p.id === Number(id)) || null;

/* ---------------- toasts ---------------- */
function toast(message, kind = "ok", ms = 2600) {
  const wrap = $("#toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "ok" ? "check" : kind === "warn" ? "alert" : "alert")}<span>${esc(message)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .2s, transform .2s";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ---------------- modal ---------------- */
let lastFocus = null;
function openModal(title, bodyHtml, { wide = false } = {}) {
  lastFocus = document.activeElement;
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHtml;
  $(".modal", $("#modalBackdrop")).style.maxWidth = wide ? "760px" : "";
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  const first = $("#modalBody").querySelector("input:not([type=hidden]), select, textarea, button");
  if (first) setTimeout(() => first.focus(), 40);
}
function closeModal() {
  $("#modalBackdrop").hidden = true;
  $("#modalBody").innerHTML = "";
  document.body.style.overflow = "";
  state.pendingImage = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

/* ---------------- confirm ---------------- */
let confirmResolve = null;
function confirmDialog({ title = "Are you sure?", text = "", yes = "Yes, continue", danger = true }) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").innerHTML = text;
  const btn = $("#confirmYes");
  btn.textContent = yes;
  btn.className = `btn ${danger ? "danger" : "primary"}`;
  $("#confirmBackdrop").hidden = false;
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  $("#confirmBackdrop").hidden = true;
  if (confirmResolve) confirmResolve(result);
  confirmResolve = null;
}

/* ---------------- lightbox ---------------- */
function openLightbox(src, caption = "") {
  $("#lightboxImg").src = src;
  $("#lightboxCap").textContent = caption || "";
  $("#lightbox").hidden = false;
}
function closeLightbox() {
  $("#lightbox").hidden = true;
  $("#lightboxImg").src = "";
}

/* ---------------- image handling ---------------- */
const MAX_IMG_EDGE = 900;
function fileToResizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error("Please choose an image file (JPG or PNG)."));
    if (file.size > 12 * 1024 * 1024) return reject(new Error("Image is larger than 12 MB."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image could not be opened."));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const mime = file.type === "image/png" && w * h < 160000 ? "image/png" : "image/jpeg";
        resolve({ data: canvas.toDataURL(mime, 0.85), mime, name: file.name, width: w, height: h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
