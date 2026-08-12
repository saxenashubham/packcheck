/* PackCheck — couple version.
   Frameworkless PWA. Firebase Auth (locked to config.allowedEmails) + Firestore
   with offline persistence, so two people share trips with realtime sync and it
   still works with no signal. Templates compose client-side; items live as
   per-item docs so concurrent edits merge (PRD §37). */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup,
  signInWithRedirect, getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  writeBatch, getDocs, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ---------------- boot / config ---------------- */
const CFG = window.PACKCHECK;
const app = document.getElementById("app");
if (!CFG || !CFG.firebase || CFG.firebase.apiKey === "YOUR_API_KEY") {
  app.innerHTML = `<div style="max-width:520px;margin:60px auto;padding:24px">
    <h1 style="font-size:22px;margin-bottom:12px">Almost there</h1>
    <p style="color:#6b7192;line-height:1.6">Copy <code>config.example.js</code> to
    <code>config.js</code>, paste your Firebase web config and the two allowed emails,
    then reload. See the README for the 5-minute setup.</p></div>`;
  throw new Error("PackCheck: config.js missing or unfilled");
}
const P = CFG.prefix || "packcheck_";
const ALLOWED = (CFG.allowedEmails || []).map((e) => e.toLowerCase());

const fb = initializeApp(CFG.firebase);
const auth = getAuth(fb);
const db = initializeFirestore(fb, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

/* ---------------- utils ---------------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nowISODate = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const parseDate = (s) => { if (!s) return null; const d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; };
const fmtRange = (a, b) => {
  const da = parseDate(a), dbb = parseDate(b), o = { month: "short", day: "numeric" };
  if (!da) return "No dates";
  if (!dbb || +da === +dbb) return da.toLocaleDateString(undefined, o);
  return da.toLocaleDateString(undefined, o) + " – " + dbb.toLocaleDateString(undefined, o);
};
let toastT;
const toast = (msg) => { const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 1900); };
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const firstName = (u) => ((u && (u.displayName || u.email)) || "").split(/[@ ]/)[0] || "You";
const initialOf = (u) => (firstName(u)[0] || "?").toUpperCase();

/* ---------------- verification questions ---------------- */
const CAT_Q = {
  Documents: (n) => `Is your ${n.toLowerCase()} physically in your travel bag?`,
  Electronics: (n) => `Is the ${n.toLowerCase()} packed with its cable, and charged if needed?`,
  Baby: (n) => `Do you have enough ${n.toLowerCase()} for the trip plus a backup?`,
  Toiletries: (n) => `Is ${n.toLowerCase()} packed and not left in the bathroom?`,
  Car: (n) => `Is the ${n.toLowerCase()} in the car and accessible?`,
  Essentials: (n) => `Is your ${n.toLowerCase()} on you or in your bag right now?`,
};
const qFor = (name, cat) => (CAT_Q[cat] ? CAT_Q[cat](name) : `Is ${name.toLowerCase()} physically packed?`);

/* ---------------- templates (composable) ---------------- */
const D = (n, c, req = false) => ({ n, c, req });
const TYPE = {
  Weekend: [
    D("T-shirts","Clothes"),D("Pants / shorts","Clothes"),D("Underwear","Clothes",true),
    D("Socks","Clothes"),D("Sleepwear","Clothes"),
    D("Toothbrush","Toiletries",true),D("Toothpaste","Toiletries"),D("Deodorant","Toiletries"),
    D("Phone charger","Electronics",true),D("Power bank","Electronics"),
    D("ID","Documents",true),D("Wallet","Essentials",true),D("Medications","Essentials",true),
  ],
  "Long trip": [
    D("T-shirts","Clothes"),D("Pants","Clothes"),D("Underwear","Clothes",true),D("Socks","Clothes"),
    D("Sleepwear","Clothes"),D("Jacket","Clothes"),
    D("Toothbrush","Toiletries",true),D("Toothpaste","Toiletries"),D("Shampoo","Toiletries"),D("Deodorant","Toiletries"),
    D("Phone charger","Electronics",true),D("Watch charger","Electronics"),D("Power bank","Electronics"),
    D("ID","Documents",true),D("Travel documents","Documents",true),D("Reservations","Documents"),
    D("Wallet","Essentials",true),D("Medications","Essentials",true),
  ],
  "Road trip": [
    D("Driver's license","Car",true),D("Registration","Car",true),D("Insurance card","Car",true),
    D("Charging cable","Car"),D("Emergency kit","Car"),D("Sunglasses","Car"),
    D("Snacks","Food"),D("Water","Food"),
    D("Phone charger","Electronics",true),D("Power bank","Electronics"),
  ],
  "Camping / Glamping": [
    D("Warm layer","Clothes",true),D("Extra socks","Clothes"),D("Bug spray","Toiletries"),
    D("Flashlight","Electronics",true),D("First-aid kit","Essentials",true),
    D("Food","Food",true),D("Water","Food",true),D("Power bank","Electronics"),
  ],
  Beach: [
    D("Swimsuit","Clothes",true),D("Shorts","Clothes"),D("Sandals","Clothes"),
    D("Sunscreen","Toiletries",true),D("Sunglasses","Clothes"),D("Beach towel","Essentials"),D("Water","Food"),
  ],
  International: [
    D("Passport","Documents",true),D("Visa / entry documents","Documents",true),
    D("Travel insurance","Documents",true),D("Reservations","Documents"),D("Travel adapter","Electronics",true),
    D("Medications","Essentials",true),D("Wallet","Essentials",true),
  ],
  "Trip with baby": [
    D("Diapers","Baby",true),D("Wipes","Baby",true),D("Diaper cream","Baby"),
    D("Baby clothes","Baby",true),D("Baby sleepwear","Baby"),D("Feeding supplies","Baby",true),
    D("Baby toiletries","Baby"),D("Favorite toy","Baby"),D("Blanket","Baby"),
  ],
  "Custom / Blank": [],
};
const SEASON = {
  Summer: [D("Sunscreen","Toiletries"),D("Sunglasses","Clothes"),D("Hat","Clothes"),D("Portable fan","Essentials")],
  Winter: [D("Warm jacket","Clothes",true),D("Thermal layers","Clothes"),D("Gloves","Clothes"),D("Beanie","Clothes")],
  Spring: [D("Light jacket","Clothes"),D("Umbrella","Essentials")],
  Fall: [D("Jacket","Clothes"),D("Light layers","Clothes")],
};
const BABY = TYPE["Trip with baby"];
const TYPE_LIST = Object.keys(TYPE);
const SEASON_LIST = ["Auto","Spring","Summer","Fall","Winter"];
const KNOWN_CATS = ["Clothes","Toiletries","Electronics","Documents","Baby","Food","Car","Essentials"];

const autoSeason = (startISO) => {
  const d = parseDate(startISO) || new Date(); const m = d.getMonth();
  return m <= 1 || m === 11 ? "Winter" : m <= 4 ? "Spring" : m <= 7 ? "Summer" : "Fall";
};
const mkItem = (name, cat, extra = {}) => ({
  id: uid(), name: name.trim(), category: cat || "Essentials", qty: 1,
  required: false, packed: false, verified: false, attention: null,
  verifyQuestion: qFor(name.trim(), cat || "Essentials"),
  notes: "", tags: [], assignee: "", source: "manual",
  packedBy: "", packedByName: "", selfVerified: false, toBuy: false,
  verifiedAt: null, verifiedBy: "", createdAt: Date.now(), ...extra,
});
const composeList = ({ types, season, startDate, travelers }) => {
  const defs = [];
  (types || []).forEach((t) => (TYPE[t] || []).forEach((d) => defs.push(d)));
  const s = season === "Auto" ? autoSeason(startDate) : season;
  (SEASON[s] || []).forEach((d) => defs.push(d));
  const hasBaby = (travelers || []).some((t) => /baby|infant/i.test(t)) || (types || []).includes("Trip with baby");
  if (hasBaby) BABY.forEach((d) => defs.push(d));
  const byKey = new Map();
  defs.forEach((d) => {
    const k = d.n.toLowerCase();
    if (byKey.has(k)) { if (d.req) byKey.get(k).required = true; return; }
    byKey.set(k, mkItem(d.n, d.c, { required: d.req, source: "template" }));
  });
  return [...byKey.values()];
};
const baseCats = () => (state.categoriesLoaded && state.categories.length ? state.categories : KNOWN_CATS);
const catList = (t) => { const s = new Set(baseCats());
  (t ? t.items : state.items).forEach((i) => i.category && s.add(i.category)); return [...s]; };
const catMatch = (raw) => { const t = raw.trim().toLowerCase();
  return baseCats().find((c) => c.toLowerCase() === t) || KNOWN_CATS.find((c) => c.toLowerCase() === t) || null; };
const parseBulk = (text, fallbackCat = "Essentials") => {
  const out = []; let cur = fallbackCat;
  text.split(/\r?\n/).forEach((line0) => {
    const line = line0.trim(); if (!line) return;
    const asCat = catMatch(line); if (asCat) { cur = asCat; return; }
    let m = line.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (m) { out.push([m[2].trim(), catMatch(m[1]) || m[1].trim()]); return; }
    m = line.match(/^([A-Za-z ]{2,20}):\s*(.+)$/);
    if (m && catMatch(m[1])) { out.push([m[2].trim(), catMatch(m[1])]); return; }
    if (line.includes(",")) { line.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => out.push([s, cur])); return; }
    out.push([line, cur]);
  });
  return out;
};

/* ---------------- derived ---------------- */
const verifyEligible = (t) => {
  if (!t.startDate) return true;
  const start = parseDate(t.startDate); if (!start) return true;
  const gate = new Date(start); gate.setDate(gate.getDate() - 1);
  return nowISODate() >= gate;
};
const attentionList = (t, eligible) => {
  const list = [];
  t.items.forEach((i) => {
    if (i.attention) list.push({ id: i.id, name: i.name, why: i.attention });
    else if (i.required && !i.packed) list.push({ id: i.id, name: i.name, why: "Not packed" });
    else if (i.required && i.packed && eligible && !i.verified) list.push({ id: i.id, name: i.name, why: "Not verified" });
  });
  return list;
};
const stats = (t) => {
  const req = t.items.filter((i) => i.required);
  const eligible = verifyEligible(t);
  return {
    total: t.items.length,
    packed: t.items.filter((i) => i.packed).length,
    verified: t.items.filter((i) => i.verified).length,
    req: req.length, eligible, attention: attentionList(t, eligible),
    ready: t.items.length > 0 && req.every((i) => i.packed && i.verified && !i.attention),
  };
};
const catsOf = (t) => {
  const order = ["Documents","Essentials","Clothes","Toiletries","Electronics","Baby","Food","Car"];
  const map = {};
  t.items.forEach((i) => (map[i.category] = map[i.category] || []).push(i));
  return Object.keys(map).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  }).map((c) => [c, map[c]]);
};

/* ---------------- firestore refs ---------------- */
const tripsCol = () => collection(db, P + "trips");
const tripDoc = (id) => doc(db, P + "trips", id);
const itemsCol = (tid) => collection(db, P + "trips", tid, "items");
const itemDoc = (tid, iid) => doc(db, P + "trips", tid, "items", iid);
const configDoc = () => doc(db, P + "meta", "config");

/* ---------------- app state ---------------- */
let me = null;
const state = { trips: [], items: [], tripId: null, tripsReady: false, categories: [], categoriesLoaded: false };
let unsubTrips = null, unsubItems = null, unsubConfig = null;
let route = { name: "home" };
let openCats = {};
const go = (r) => { route = r; render(); window.scrollTo(0, 0); };
const currentTrip = () => {
  const meta = state.trips.find((t) => t.id === state.tripId);
  return meta ? { ...meta, items: state.items } : null;
};

/* ---------------- auth ---------------- */
const allowed = (u) => u && ALLOWED.includes((u.email || "").toLowerCase());
getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, (user) => {
  me = user;
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }
  if (unsubItems) { unsubItems(); unsubItems = null; }
  if (unsubConfig) { unsubConfig(); unsubConfig = null; }
  state.trips = []; state.items = []; state.tripsReady = false;
  state.categories = []; state.categoriesLoaded = false;
  if (user && allowed(user)) { watchTrips(); watchConfig(); }
  render();
});
async function signIn() {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch { try { await signInWithRedirect(auth, provider); } catch { toast("Sign-in failed"); } }
}

/* ---------------- watchers ---------------- */
function watchTrips() {
  unsubTrips = onSnapshot(tripsCol(), (snap) => {
    state.trips = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.tripsReady = true;
    if (route.name === "home" || route.name === "trip") render();
  }, () => toast("Sync error — check rules/emails"));
}
// A trip becomes "2-person" once both accounts have opened it. Recorded once
// per account (arrayUnion is idempotent, and we guard so it writes at most once).
function ensureMember(t) {
  if (!me) return;
  if ((t.memberUids || []).includes(me.uid)) return;
  updateDoc(tripDoc(t.id), { memberUids: arrayUnion(me.uid) }).catch(() => {});
}
// Shared, editable category list lives in one config doc for both accounts.
function watchConfig() {
  unsubConfig = onSnapshot(configDoc(), (snap) => {
    if (!snap.exists()) { setDoc(configDoc(), { categories: KNOWN_CATS.slice() }).catch(()=>{}); return; }
    const c = snap.data() || {};
    state.categories = Array.isArray(c.categories) && c.categories.length ? c.categories : KNOWN_CATS.slice();
    state.categoriesLoaded = true;
    if (route.name === "trip" || route.name === "new") render();
  }, () => {});
}
async function addCategory(name) {
  name = (name || "").trim(); if (!name) return "";
  if (baseCats().some((c) => c.toLowerCase() === name.toLowerCase())) return name;
  await setDoc(configDoc(), { categories: arrayUnion(name) }, { merge: true }).catch(()=>{});
  return name;
}
const CAT_ADD = "＋ Add category…";
const catSelectHTML = (id, list, selected) =>
  `<select id="${id}">${list.map((c)=>`<option ${c===selected?"selected":""}>${esc(c)}</option>`).join("")}<option value="__add">${CAT_ADD}</option></select>`;
async function onCatSelect(sel) {
  if (sel.value !== "__add") return sel.value;
  const name = await addCategory(prompt("New category name") || "");
  if (!name) { sel.selectedIndex = 0; return sel.value; }
  if (![...sel.options].some((o) => o.textContent === name)) {
    const opt = document.createElement("option"); opt.textContent = name;
    sel.insertBefore(opt, sel.querySelector('option[value="__add"]'));
  }
  sel.value = name; return name;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); return; } catch {}
  const ta = document.createElement("textarea"); ta.value = text;
  ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch {}
  ta.remove(); toast(ok ? "Copied to clipboard" : "Couldn't auto-copy — long-press to select");
}
function watchItems(tid) {
  if (unsubItems) unsubItems();
  state.items = []; state.tripId = tid;
  unsubItems = onSnapshot(itemsCol(tid), (snap) => {
    state.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (route.name === "trip" && route.id === tid) render();
  }, () => toast("Sync error"));
}

/* ================= RENDER ================= */
function render() {
  if (!me) return renderSignIn();
  if (!allowed(me)) return renderDenied();
  if (route.name === "new") return renderNew();
  if (route.name === "trip") {
    if (state.tripId !== route.id) watchItems(route.id);
    const t = currentTrip();
    if (!t) { if (state.tripsReady) return go({ name: "home" }); return renderLoading(); }
    return renderTrip(t);
  }
  return renderHome();
}

const renderLoading = () => { app.innerHTML = `<div class="empty" style="padding-top:120px"><div class="big">🧳</div><p>Loading…</p></div>`; };

function renderSignIn() {
  app.innerHTML = `<div class="auth">
    <div class="brand" style="justify-content:center;margin-bottom:20px">
      <div class="mark" style="width:52px;height:52px;font-size:20px;border-radius:15px">PC</div></div>
    <h1 style="text-align:center;font-size:26px">PackCheck</h1>
    <p style="text-align:center;color:var(--muted);margin:8px 0 26px">Pack, verify, and share the list with each other.</p>
    <button class="btn wide" data-signin>Continue with Google</button>
    <p class="hint" style="text-align:center;margin-top:14px">Only the two accounts set up for this trip can sign in.</p>
  </div>`;
  $("[data-signin]").onclick = signIn;
}
function renderDenied() {
  app.innerHTML = `<div class="auth">
    <div class="empty"><div class="big">🚫</div><h2>Not on this list</h2>
    <p>${esc(me.email)} isn't one of the allowed accounts. Ask your partner to add you, or sign in with the right account.</p>
    <button class="btn sec" style="width:auto" data-out>Sign out</button></div></div>`;
  $("[data-out]").onclick = () => signOut(auth);
}

/* ---- Home ---- */
function renderHome() {
  const trips = [...state.trips].sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999"));
  const cards = trips.map((t0) => {
    const t = { ...t0, items: t0.id === state.tripId ? state.items : (t0._items || []) };
    // home shows meta + (if we have items cached for the open trip) progress; otherwise counts come from a light read
    const s = stats({ ...t, items: t.items });
    const hasItems = t.items.length > 0;
    return `<button class="trip-card card" data-open="${t.id}">
      <div class="name">${esc(t.name)}</div>
      <div class="meta">${esc(t.destination || "")}${t.destination ? " · " : ""}${fmtRange(t.startDate, t.endDate)}</div>
      ${hasItems ? `
      <div class="prog"><div class="lbl"><span>Packed</span><span>${s.packed}/${s.total}</span></div>
        <div class="bar pack"><span style="width:${pct(s.packed,s.total)}%"></span></div></div>
      <div class="prog"><div class="lbl"><span>Verified</span><span>${s.verified}/${s.total}</span></div>
        <div class="bar ver"><span style="width:${pct(s.verified,s.total)}%"></span></div></div>
      <span class="ready ${s.ready ? "yes" : "no"}"><span class="dot"></span>${s.ready ? "Ready to go" : "Not ready"}</span>`
      : `<div class="meta" style="margin-top:8px">Tap to open</div>`}
    </button>`;
  }).join("");

  app.innerHTML = `<div class="screen">
    <div class="top"><div class="brand"><div class="mark">PC</div><h1>PackCheck</h1></div>
      <button class="who" data-menu aria-label="Account and data">${initialOf(me)}</button></div>
    ${trips.length ? `<div class="eyebrow">Your trips</div>${cards}`
      : (state.tripsReady ? emptyHome() : renderLoadingInline())}
  </div>
  <button class="fab" data-new>＋ New trip</button>`;

  $("[data-new]").onclick = () => go({ name: "new" });
  app.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => go({ name: "trip", id: b.dataset.open, tab: "packing" })));
  $("[data-menu]").onclick = dataMenu;
}
const renderLoadingInline = () => `<div class="empty"><div class="big">🧳</div><p>Loading your trips…</p></div>`;
const emptyHome = () => `<div class="empty"><div class="big">🧳</div><h2>No trips yet</h2>
  <p>Create a trip and PackCheck builds a starting list from the type and season. Your partner sees it instantly.</p></div>`;

/* ---- New trip ---- */
let ntState = null;
const nt = () => (ntState || (ntState = { name: "", destination: "", startDate: "", endDate: "", types: [], season: "Auto", travelers: "" }));
function renderNew() {
  const f = nt();
  app.innerHTML = `<div class="screen">
    <div class="top"><button class="back" data-back aria-label="Back">‹</button><h1>New trip</h1></div>
    <div class="field"><label>Trip name</label><input type="text" id="f-name" placeholder="Big Bend Weekend" value="${esc(f.name)}"></div>
    <div class="field"><label>Destination</label><input type="text" id="f-dest" placeholder="Big Bend, TX" value="${esc(f.destination)}"></div>
    <div class="row">
      <div class="field"><label>Start date</label><input type="date" id="f-start" value="${esc(f.startDate)}"></div>
      <div class="field"><label>End date</label><input type="date" id="f-end" value="${esc(f.endDate)}"></div></div>
    <div class="field"><label>Trip type <span class="hint" style="font-weight:600">— pick one or more</span></label>
      <div class="opts" id="f-types">${TYPE_LIST.map((t) => `<button type="button" class="opt" data-type="${esc(t)}" aria-pressed="${f.types.includes(t)}">${esc(t)}</button>`).join("")}</div></div>
    <div class="field"><label>Season</label>
      <div class="opts" id="f-season">${SEASON_LIST.map((s) => `<button type="button" class="opt" data-season="${esc(s)}" aria-pressed="${f.season===s}">${esc(s)}</button>`).join("")}</div>
      <div class="hint">Auto reads the season from your start date. Season adds a layer on top of the trip type.</div></div>
    <div class="field"><label>Travelers</label>
      <input type="text" id="f-trav" placeholder="${esc(firstName(me))}, Partner, Baby" value="${esc(f.travelers)}">
      <div class="hint">Add “Baby” to include baby items automatically.</div></div>
    <button class="btn wide" data-create>Generate packing list</button><div style="height:12px"></div></div>`;

  $("[data-back]").onclick = () => { ntState = null; go({ name: "home" }); };
  const sync = () => { f.name=$("#f-name").value; f.destination=$("#f-dest").value;
    f.startDate=$("#f-start").value; f.endDate=$("#f-end").value; f.travelers=$("#f-trav").value; };
  ["f-name","f-dest","f-start","f-end","f-trav"].forEach((id) => $("#"+id).oninput = sync);
  $("#f-types").querySelectorAll("[data-type]").forEach((b) => b.onclick = () => {
    const t=b.dataset.type, i=f.types.indexOf(t); i<0?f.types.push(t):f.types.splice(i,1); b.setAttribute("aria-pressed", i<0); });
  $("#f-season").querySelectorAll("[data-season]").forEach((b) => b.onclick = () => {
    f.season=b.dataset.season;
    $("#f-season").querySelectorAll("[data-season]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.season===f.season)); });
  $("[data-create]").onclick = async () => {
    sync();
    if (!f.name.trim()) return toast("Give the trip a name");
    const travelers = f.travelers.split(",").map((s) => s.trim()).filter(Boolean);
    const items = composeList({ types: f.types, season: f.season, startDate: f.startDate, travelers });
    const btn = $("[data-create]"); btn.disabled = true; btn.textContent = "Creating…";
    try {
      const ref = await addDoc(tripsCol(), {
        name: f.name.trim(), destination: f.destination.trim(), startDate: f.startDate, endDate: f.endDate,
        types: f.types.slice(), season: f.season, travelers, createdAt: Date.now(),
        createdBy: firstName(me), memberUids: [me.uid],
      });
      const batch = writeBatch(db);
      items.forEach((it) => batch.set(itemDoc(ref.id, it.id), it));
      await batch.commit();
      ntState = null; go({ name: "trip", id: ref.id, tab: "packing" });
      toast(`Starting list: ${items.length} items`);
    } catch (e) { btn.disabled = false; btn.textContent = "Generate packing list"; toast("Couldn't create — check connection/rules"); }
  };
}

/* ---- Trip ---- */
function renderTrip(t) {
  const tab = route.tab || "packing";
  ensureMember(t);
  const s = stats(t);
  app.innerHTML = `<div class="screen">
    <div class="top"><button class="back" data-home aria-label="Back">‹</button>
      <div style="flex:1;min-width:0"><h1 style="font-size:20px">${esc(t.name)}</h1>
        <div class="sub">${esc(t.destination||"")}${t.destination?" · ":""}${fmtRange(t.startDate,t.endDate)}</div></div>
      <button class="who" data-tmenu aria-label="Trip menu">⋯</button></div>

    <div class="tripbar"><div class="card">
      <div class="prog"><div class="lbl"><span>Packed</span><span>${s.packed}/${s.total}</span></div>
        <div class="bar pack"><span style="width:${pct(s.packed,s.total)}%"></span></div></div>
      <div class="prog"><div class="lbl"><span>Verified</span><span>${s.verified}/${s.total}</span></div>
        <div class="bar ver"><span style="width:${pct(s.verified,s.total)}%"></span></div></div>
      <span class="ready ${s.ready?"yes":"no"}"><span class="dot"></span>${s.ready?"Ready to go":"Not ready"}${s.attention.length?` · ${s.attention.length} need${s.attention.length>1?"":"s"} attention`:""}</span>
    </div></div>

    <div class="tabs" role="tablist">
      ${["packing","verify","attention"].map((k)=>`<button class="tab" role="tab" data-tab="${k}" aria-selected="${tab===k}">
        ${k==="packing"?"Packing":k==="verify"?"Verify":"Attention"}
        ${k==="attention"&&s.attention.length?`<span class="badge">${s.attention.length}</span>`:""}</button>`).join("")}
    </div>
    <div id="tabbody"></div></div>
    ${tab==="packing"?`<button class="fab" data-add>＋ Add items</button>`:""}`;

  $("[data-home]").onclick = () => go({ name: "home" });
  $("[data-tmenu]").onclick = () => tripMenu(t);
  app.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => go({ name:"trip", id:t.id, tab:b.dataset.tab }));
  const addBtn = $("[data-add]"); if (addBtn) addBtn.onclick = () => addSheet(t);

  const body = $("#tabbody");
  if (tab === "packing") renderPacking(t, body);
  else if (tab === "verify") renderVerify(t, body);
  else renderAttention(t, body, s);
}

function renderPacking(t, body) {
  if (!t.items.length) {
    body.innerHTML = `<div class="empty"><div class="big">📝</div><h2>Empty list</h2>
      <p>Add items in bulk — paste a list and PackCheck sorts it into categories.</p></div>`; return;
  }
  const cats = catsOf(t);
  body.innerHTML = cats.map(([c, items]) => {
    const done = items.filter((i)=>i.packed).length;
    const open = openCats[c] !== undefined ? openCats[c] : true;
    return `<div class="panel" data-open="${open}" data-cat="${esc(c)}">
      <button class="head" data-toggle="${esc(c)}"><span class="caret">▶</span>
        <span class="cat">${esc(c)}</span><span class="count ${done===items.length?"done":""}">${done}/${items.length}</span></button>
      <div class="body">${items.map((i)=>itemRow(i)).join("")}</div></div>`;
  }).join("");
  bindRows(t, body);
  body.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => {
    const c=b.dataset.toggle, p=b.closest(".panel"); const now = p.dataset.open !== "true";
    p.dataset.open = now; openCats[c]=now; });
}

function itemRow(i) {
  const sub = [];
  if (i.assignee) sub.push(`<span class="tag">${esc(i.assignee)}</span>`);
  (i.tags||[]).forEach((tg)=>sub.push(`<span class="tag">#${esc(tg)}</span>`));
  if (i.toBuy) sub.push(`<span class="tag buy">🛒 Buy</span>`);
  if (i.notes) sub.push(`📝 ${esc(i.notes)}`);
  let state_ = "";
  if (i.attention) state_ = `<span class="state warn">⚠ Attention</span>`;
  else if (i.verified) state_ = `<span class="state ok">✓ Verified${i.verifiedBy?" · "+esc(i.verifiedBy):""}</span>`;
  else if (i.packed) state_ = `<span class="state pack">Packed</span>`;
  return `<div class="item" data-id="${i.id}">
    <button class="check ${i.packed?"on":""}" data-check="${i.id}" aria-label="${i.packed?"Mark not packed":"Mark packed"}">${i.packed?"✓":""}</button>
    <div class="main" data-edit="${i.id}"><div class="nm">${esc(i.name)}${i.qty>1?`<span class="qty">×${i.qty}</span>`:""}${i.required?`<span class="req">REQUIRED</span>`:""}</div>
      ${sub.length?`<div class="sub">${sub.join("")}</div>`:""}</div>
    ${state_}<button class="edit" data-edit="${i.id}" aria-label="Edit ${esc(i.name)}">✎</button></div>`;
}
function bindRows(t, body) {
  body.querySelectorAll("[data-check]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const i = t.items.find((x)=>x.id===b.dataset.check); if (!i) return;
    const patch = { packed: !i.packed };
    if (i.packed) { // unpacking clears verify + packer
      patch.verified = false; patch.verifiedAt = null; patch.verifiedBy = "";
      patch.selfVerified = false; patch.packedBy = ""; patch.packedByName = "";
    } else { // packing records who packed it
      patch.packedBy = me.uid; patch.packedByName = firstName(me);
    }
    updateDoc(itemDoc(t.id, i.id), patch).catch(()=>toast("Change queued (offline)"));
  });
  body.querySelectorAll("[data-edit]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation(); itemSheet(t, t.items.find((x)=>x.id===b.dataset.edit)); });
}

/* ---- Verify ---- */
function renderVerify(t, body) {
  const s = stats(t);
  if (!s.eligible) {
    const start = parseDate(t.startDate);
    body.innerHTML = `<div class="gate">🔒 Final verification opens the day before your trip.
      ${start?`It unlocks on ${new Date(start.getTime()-86400000).toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}.`:""}
      <br><br>Verification is a deliberate second pass — doing it too early defeats the point. Keep packing for now.</div>`;
    return;
  }
  const packed = t.items.filter((i)=>i.packed);
  const done = packed.filter((i)=>i.verified);
  const pending = packed.filter((i)=>!i.verified);
  if (!packed.length) {
    body.innerHTML = `<div class="empty"><div class="big">🧐</div><h2>Nothing to verify yet</h2>
      <p>Pack items first, then come back to verify each one is truly ready.</p></div>`;
    return;
  }
  // Cross-verification: once both accounts have opened the trip, you can't verify
  // what you packed — the other person gives it a fresh check.
  const twoPeople = (t.memberUids || []).length >= 2;
  const blockedForMe = (i) => twoPeople && i.packedBy === me.uid;
  const verifiable = pending.filter((i) => !blockedForMe(i));
  const yours = pending.filter(blockedForMe);

  const vcard = (i) => `<div class="card vcard">
      <div class="nm">${esc(i.name)}${(i.packedByName && i.packedBy !== me.uid) ? ` · packed by ${esc(i.packedByName)}` : ""}</div>
      <div class="q">${esc(i.verifyQuestion)}</div>${i.notes?`<div class="note">📝 ${esc(i.notes)}</div>`:""}
      <div class="acts"><button class="btn sec" data-fail="${i.id}">⚠ Needs attention</button>
        <button class="btn" data-pass="${i.id}">✓ Verified</button></div></div>`;
  const yourcard = (i) => `<div class="card vcard blocked">
      <div class="nm">${esc(i.name)} · packed by you</div>
      <div class="q">${esc(i.verifyQuestion)}</div>
      <div class="note">You packed this, so the other person should verify it for a fresh check. No one else? Verify anyway.</div>
      <div class="acts"><button class="btn sec" data-fail="${i.id}">⚠ Needs attention</button>
        <button class="btn ghost" data-selfpass="${i.id}">Verify anyway</button></div></div>`;

  body.innerHTML =
    (verifiable.length ? `<div class="eyebrow" style="margin-top:6px">To verify — ${verifiable.length}</div>` + verifiable.map(vcard).join("") : "") +
    (yours.length ? `<div class="eyebrow">Packed by you — needs the other person (${yours.length})</div>` + yours.map(yourcard).join("") : "") +
    ((!verifiable.length && !yours.length) ? `<div class="card vcard"><div class="q">🎉 Everything packed is verified.</div>
        <div class="note" style="margin-top:12px">Check the Attention tab for anything still required but not packed.</div></div>` : "") +
    (done.length ? `<div class="eyebrow">Verified — ${done.length}</div>` + done.map((i)=>`<div class="item" style="background:var(--card);border-radius:12px;margin-bottom:6px;padding:10px 12px;border:1px solid var(--line)">
        <button class="check ver on" data-unverify="${i.id}" aria-label="Undo verify">✓</button>
        <div class="main"><div class="nm">${esc(i.name)}</div>
          <div class="sub">${i.verifiedBy?"Verified by "+esc(i.verifiedBy):"Verified"}${i.selfVerified?" · self-verified":""}${i.verifiedAt?" · "+new Date(i.verifiedAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):""}</div></div></div>`).join("") : "");

  body.querySelectorAll("[data-pass]").forEach((b) => b.onclick = () => {
    const i=t.items.find((x)=>x.id===b.dataset.pass);
    updateDoc(itemDoc(t.id,i.id), { verified:true, attention:null, verifiedAt:Date.now(), verifiedBy:firstName(me), selfVerified:false }).catch(()=>{});
    toast("Verified");
  });
  body.querySelectorAll("[data-selfpass]").forEach((b) => b.onclick = () => {
    const i=t.items.find((x)=>x.id===b.dataset.selfpass);
    if(!confirm("No second person checked this. Verify it yourself anyway?")) return;
    updateDoc(itemDoc(t.id,i.id), { verified:true, attention:null, verifiedAt:Date.now(), verifiedBy:firstName(me), selfVerified:true }).catch(()=>{});
    toast("Self-verified");
  });
  body.querySelectorAll("[data-fail]").forEach((b) => b.onclick = () => failSheet(t, t.items.find((x)=>x.id===b.dataset.fail)));
  body.querySelectorAll("[data-unverify]").forEach((b) => b.onclick = () => {
    const i=t.items.find((x)=>x.id===b.dataset.unverify);
    updateDoc(itemDoc(t.id,i.id), { verified:false, verifiedAt:null, verifiedBy:"", selfVerified:false }).catch(()=>{});
  });
}

/* ---- Attention ---- */
function renderAttention(t, body, s) {
  if (!s.attention.length) {
    body.innerHTML = `<div class="empty"><div class="big">${s.ready?"🟢":"👍"}</div>
      <h2>${s.ready?"Ready to go":"Nothing needs attention"}</h2>
      <p>${s.ready?"All required items are packed and verified.":"Required items still need packing or verifying — they'll show up here."}</p></div>`; return;
  }
  body.innerHTML = s.attention.map((a)=>`<div class="card att" data-goto="${a.id}"><div class="ic">⚠</div>
    <div style="flex:1"><div class="nm">${esc(a.name)}</div><div class="why">${esc(a.why)}</div></div>
    <button class="edit" data-editatt="${a.id}" aria-label="Open">›</button></div>`).join("");
  body.querySelectorAll("[data-editatt]").forEach((b) => b.onclick = () => itemSheet(t, t.items.find((x)=>x.id===b.dataset.editatt)));
}

/* ================= SHEETS ================= */
function sheet(inner) {
  const scrim = document.createElement("div");
  scrim.className = "scrim"; scrim.innerHTML = `<div class="sheet">${inner}</div>`;
  scrim.onclick = (e) => { if (e.target === scrim) close(); };
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  return { scrim, close, el: (s) => scrim.querySelector(s) };
}

function addSheet(t) {
  const cats = catList(t);
  const s = sheet(`<div class="grip"></div>
    <div class="shead"><h2>Add items</h2><button class="x" data-x>✕</button></div>
    <div class="seg"><button data-m="bulk" aria-pressed="true">Paste list</button><button data-m="one" aria-pressed="false">One item</button></div>
    <div id="add-body"></div>`);
  const render_ = (mode) => {
    const b = s.el("#add-body");
    if (mode === "one") {
      b.innerHTML = `<div class="field"><label>Item</label><input type="text" id="a1" placeholder="Passport"></div>
        <div class="field"><label>Category</label>${catSelectHTML("a1c", cats)}</div>
        <button class="btn wide" data-add1>Add item</button>`;
      s.el("#a1").focus();
      s.el("#a1c").onchange = (e) => onCatSelect(e.target);
      s.el("[data-add1]").onclick = async () => {
        const n=s.el("#a1").value.trim(); if(!n) return;
        const it = mkItem(n, s.el("#a1c").value);
        await setDoc(itemDoc(t.id, it.id), it).catch(()=>{}); s.close(); toast("Added");
      };
    } else {
      b.innerHTML = `<div class="field"><label>Paste items — one per line, or comma-separated</label>
        <textarea id="ab" placeholder="Passport
Charger
Toothbrush

Or with categories:
ELECTRONICS
Power bank
[Baby] Diapers
Toiletries: Sunscreen"></textarea>
        <div class="hint">Headings like ELECTRONICS, [Baby], or Toiletries: set the category. Duplicates are skipped.</div></div>
        <div class="field"><label>Default category for un-categorized lines</label>
          ${catSelectHTML("abc", cats, "Essentials")}</div>
        <button class="btn wide" data-addbulk>Add to list</button>`;
      s.el("#abc").onchange = (e) => onCatSelect(e.target);
      s.el("[data-addbulk]").onclick = async () => {
        const txt=s.el("#ab").value; if(!txt.trim()) return;
        const parsed = parseBulk(txt, s.el("#abc").value);
        const existing = new Set(t.items.map((i)=>i.name.toLowerCase()+"|"+i.category.toLowerCase()));
        const toAdd=[]; let skipped=0;
        parsed.forEach(([n,c])=>{ const key=n.toLowerCase()+"|"+c.toLowerCase();
          if(existing.has(key)){skipped++;return;} existing.add(key); toAdd.push(mkItem(n,c)); });
        const batch = writeBatch(db);
        toAdd.forEach((it)=>batch.set(itemDoc(t.id, it.id), it));
        await batch.commit().catch(()=>{});
        s.close(); toast(`Added ${toAdd.length}${skipped?` · ${skipped} duplicate${skipped>1?"s":""} skipped`:""}`);
      };
    }
  };
  render_("bulk");
  s.scrim.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => {
    s.scrim.querySelectorAll("[data-m]").forEach((x)=>x.setAttribute("aria-pressed", x===b)); render_(b.dataset.m); });
  s.el("[data-x]").onclick = s.close;
}

function itemSheet(t, i) {
  if (!i) return;
  const cats = catList(t); if (!cats.includes(i.category)) cats.push(i.category);
  const s = sheet(`<div class="grip"></div>
    <div class="shead"><h2>Edit item</h2><button class="x" data-x>✕</button></div>
    <div class="field"><label>Name</label><input type="text" id="e-n" value="${esc(i.name)}"></div>
    <div class="row"><div class="field"><label>Category</label>${catSelectHTML("e-c", cats, i.category)}</div>
      <div class="field"><label>Quantity</label><input type="text" id="e-q" inputmode="numeric" value="${i.qty}"></div></div>
    <div class="field"><label>Required for this trip?</label>
      <div class="opts"><button type="button" class="opt" data-req="true" aria-pressed="${i.required}">Required</button>
        <button type="button" class="opt" data-req="false" aria-pressed="${!i.required}">Optional</button></div></div>
    <div class="field"><label>Shopping</label>
      <div class="opts"><button type="button" class="opt" data-buy aria-pressed="${!!i.toBuy}">🛒 Need to buy</button></div></div>
    <div class="field"><label>Assign to (optional)</label>
      <input type="text" id="e-a" value="${esc(i.assignee||"")}" placeholder="${esc((t.travelers&&t.travelers[0])||"Traveler")}"></div>
    <div class="field"><label>Verification question</label><input type="text" id="e-vq" value="${esc(i.verifyQuestion)}"></div>
    <div class="field"><label>Notes (optional)</label><input type="text" id="e-note" value="${esc(i.notes||"")}" placeholder="Keep in personal bag, not checked luggage"></div>
    <div class="row" style="margin-top:4px"><button class="btn sec danger" data-del>Delete</button><button class="btn" data-save>Save</button></div>
    <div style="height:6px"></div>`);
  let req = i.required, buy = !!i.toBuy;
  s.el("#e-c").onchange = (e) => onCatSelect(e.target);
  s.scrim.querySelectorAll("[data-req]").forEach((b) => b.onclick = () => {
    req = b.dataset.req === "true";
    s.scrim.querySelectorAll("[data-req]").forEach((x)=>x.setAttribute("aria-pressed", (x.dataset.req==="true")===req)); });
  const buyBtn = s.el("[data-buy]");
  buyBtn.onclick = () => { buy = !buy; buyBtn.setAttribute("aria-pressed", buy); };
  s.el("[data-save]").onclick = async () => {
    const n=s.el("#e-n").value.trim(); if(!n) return toast("Name can't be empty");
    await updateDoc(itemDoc(t.id, i.id), {
      name:n, category:s.el("#e-c").value, qty:Math.max(1, parseInt(s.el("#e-q").value,10)||1),
      required:req, toBuy:buy, assignee:s.el("#e-a").value.trim(),
      verifyQuestion:s.el("#e-vq").value.trim()||qFor(n, s.el("#e-c").value), notes:s.el("#e-note").value.trim(),
    }).catch(()=>{}); s.close(); toast("Saved");
  };
  s.el("[data-del]").onclick = async () => {
    if(!confirm(`Delete "${i.name}" from this trip?`)) return;
    await deleteDoc(itemDoc(t.id, i.id)).catch(()=>{}); s.close(); toast("Deleted");
  };
  s.el("[data-x]").onclick = s.close;
}

function failSheet(t, i) {
  const reasons = ["Not packed","Insufficient quantity","Needs charging","Needs to buy","Needs retrieval","Missing document","Flagged"];
  const s = sheet(`<div class="grip"></div>
    <div class="shead"><h2>Needs attention</h2><button class="x" data-x>✕</button></div>
    <div class="field"><label>What's wrong with “${esc(i.name)}”?</label>
      <div class="opts">${reasons.map((r)=>`<button type="button" class="opt" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div></div>`);
  s.scrim.querySelectorAll("[data-r]").forEach((b) => b.onclick = async () => {
    const patch = { attention:b.dataset.r, verified:false, verifiedAt:null, verifiedBy:"", selfVerified:false };
    if (b.dataset.r==="Not packed") { patch.packed=false; patch.packedBy=""; patch.packedByName=""; }
    await updateDoc(itemDoc(t.id,i.id), patch).catch(()=>{}); s.close(); toast("Flagged for attention");
  });
  s.el("[data-x]").onclick = s.close;
}

/* ================= MENUS ================= */
function tripMenu(t) {
  const s = sheet(`<div class="grip"></div>
    <div class="shead"><h2>${esc(t.name)}</h2><button class="x" data-x>✕</button></div>
    <button class="btn sec wide" data-buy style="margin-bottom:10px">🛒 Shopping list (to buy)</button>
    <button class="btn sec wide" data-copy style="margin-bottom:10px">Copy as new trip</button>
    <button class="btn sec danger wide" data-del>Delete trip</button><div style="height:6px"></div>`);
  s.el("[data-buy]").onclick = () => { s.close(); buySheet(t); };
  s.el("[data-copy]").onclick = async () => {
    const nextYear = (parseDate(t.startDate) && parseDate(t.startDate) < nowISODate());
    const meta = {
      name: t.name.replace(/\s*\d{4}$/,"") + " " + (new Date().getFullYear() + (nextYear?1:0)),
      destination: t.destination||"", startDate:"", endDate:"", types:(t.types||[]).slice(),
      season:t.season||"Auto", travelers:(t.travelers||[]).slice(), createdAt:Date.now(),
      createdBy:firstName(me), memberUids:[me.uid],
    };
    const ref = await addDoc(tripsCol(), meta);
    const batch = writeBatch(db);
    t.items.forEach((i)=>{ const it = { ...i, id:uid(), packed:false, verified:false, attention:null,
      verifiedAt:null, verifiedBy:"", selfVerified:false, packedBy:"", packedByName:"", toBuy:false };
      batch.set(itemDoc(ref.id, it.id), it); });
    await batch.commit().catch(()=>{});
    s.close(); go({ name:"trip", id:ref.id, tab:"packing" }); toast("Copied — states reset, items kept");
  };
  s.el("[data-del]").onclick = async () => {
    if(!confirm(`Delete "${t.name}"? This can't be undone.`)) return;
    const snap = await getDocs(itemsCol(t.id));
    const batch = writeBatch(db); snap.forEach((d)=>batch.delete(d.ref)); batch.delete(tripDoc(t.id));
    await batch.commit().catch(()=>{}); s.close(); go({ name:"home" }); toast("Trip deleted");
  };
  s.el("[data-x]").onclick = s.close;
}

function dataMenu() {
  const s = sheet(`<div class="grip"></div>
    <div class="shead"><h2>Account</h2><button class="x" data-x>✕</button></div>
    <div class="card" style="padding:14px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <div class="who" style="pointer-events:none">${initialOf(me)}</div>
      <div><div style="font-weight:750">${esc(firstName(me))}</div><div class="hint">${esc(me.email||"")}</div></div></div>
    <p class="hint" style="margin:0 0 14px">Trips sync automatically between the allowed accounts, online or off.</p>
    <button class="btn sec wide" data-cats style="margin-bottom:10px">Manage categories</button>
    <button class="btn sec wide" data-out>Sign out</button><div style="height:6px"></div>`);
  s.el("[data-cats]").onclick = () => { s.close(); categoriesSheet(); };
  s.el("[data-out]").onclick = () => { s.close(); signOut(auth); };
  s.el("[data-x]").onclick = s.close;
}

/* shopping list: collect items marked "to buy", copy out for the shopping app */
function buySheet(t) {
  let list = t.items.filter((i) => i.toBuy);
  const s = sheet(`<div class="grip"></div>
    <div class="shead"><h2>Shopping list</h2><button class="x" data-x>✕</button></div>
    <div id="buy-body"></div>`);
  const draw = () => {
    const b = s.el("#buy-body");
    if (!list.length) {
      b.innerHTML = `<div class="empty" style="padding:30px 10px"><div class="big">🛒</div>
        <p>Nothing marked to buy yet. Open any item, toggle “Need to buy”, and it collects here.</p></div>`;
      return;
    }
    b.innerHTML = `<p class="hint" style="margin:0 0 12px">${list.length} item${list.length>1?"s":""} to buy. Copy them straight into your shopping list.</p>
      <div class="buylist">${list.map((i)=>`<div class="buyrow"><span>${esc(i.name)}${i.qty>1?` ×${i.qty}`:""}</span>
        <button class="x" data-unbuy="${i.id}" aria-label="Remove ${esc(i.name)}">✕</button></div>`).join("")}</div>
      <div class="row" style="margin-top:16px">
        <button class="btn sec" data-copynl>Copy — new lines</button>
        <button class="btn sec" data-copycomma>Copy — comma</button></div>`;
    b.querySelectorAll("[data-unbuy]").forEach((btn) => btn.onclick = () => {
      const id = btn.dataset.unbuy;
      updateDoc(itemDoc(t.id, id), { toBuy:false }).catch(()=>{});
      list = list.filter((x)=>x.id!==id); draw();
    });
    b.querySelector("[data-copynl]").onclick = () => copyText(list.map((i)=>i.name).join("\n"));
    b.querySelector("[data-copycomma]").onclick = () => copyText(list.map((i)=>i.name).join(", "));
  };
  draw();
  s.el("[data-x]").onclick = s.close;
}

/* manage the shared category list */
function categoriesSheet() {
  let cats = baseCats().slice();
  const s = sheet(`<div class="grip"></div>
    <div class="shead"><h2>Categories</h2><button class="x" data-x>✕</button></div>
    <div class="field" style="margin-bottom:10px"><div class="row" style="gap:8px">
      <input type="text" id="newcat" placeholder="New category (e.g. Photography)">
      <button class="btn" style="width:auto;flex:none;padding:0 18px" data-addcat>Add</button></div></div>
    <div id="cats-body"></div>
    <p class="hint" style="margin-top:12px">Removing a category only hides it from the picker. Items already using it keep it.</p>`);
  const draw = () => {
    s.el("#cats-body").innerHTML = `<div class="buylist">${cats.map((c)=>`<div class="buyrow">
      <span>${esc(c)}</span><button class="x" data-rm="${esc(c)}" aria-label="Remove ${esc(c)}">✕</button></div>`).join("")}</div>`;
    s.el("#cats-body").querySelectorAll("[data-rm]").forEach((btn) => btn.onclick = () => {
      const name = btn.dataset.rm;
      cats = cats.filter((c)=>c!==name); draw();
      setDoc(configDoc(), { categories: arrayRemove(name) }, { merge:true }).catch(()=>{});
    });
  };
  const add = async () => {
    const inp = s.el("#newcat"); const name = (inp.value||"").trim(); if (!name) return;
    if (cats.some((c)=>c.toLowerCase()===name.toLowerCase())) { toast("Already exists"); inp.value=""; return; }
    cats.push(name); inp.value=""; draw(); await addCategory(name);
  };
  s.el("[data-addcat]").onclick = add;
  s.el("#newcat").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  draw();
  s.el("[data-x]").onclick = s.close;
}

/* boot */
renderLoading();
