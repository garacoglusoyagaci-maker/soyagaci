import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const app = document.getElementById("app");
const modal = document.getElementById("modal");
const toastEl = document.getElementById("toast");

const S = { user: null, me: null, people: [], spouses: [], profiles: [], tab: "tree", rootId: null, q: "", zoom: 1, fCity: "", fGender: "", fStatus: "", gen: { on: true, colors: [] }, maxGen: 0, invites: [], iq: "", iFilter: "", treeFull: false, requests: [], notes: [], photoSet: new Set(), fBlood: "", sort: "alpha", bloodMissing: false, prefs: loadPrefs() };
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "0+", "0-"];
const SORTS = { alpha: "Alfabetik (A → Z)", age_old: "Yaşa göre (büyükten küçüğe)", age_young: "Yaşa göre (küçükten büyüğe)", created_old: "Kayıt sırası (ilk eklenen önce)", created_new: "Kayıt sırası (son eklenen önce)", family: "Aile içi sıralama" };
const VIS = { all: "Tüm üyeler", private: "Sadece ben", custom: "Seçili kişiler" };

// ---------- yardımcılar ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => S.people.find((p) => p.id === id);
const fullName = (p) => (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "");
const yr = (d) => (d ? String(d).slice(0, 4) : "");
const isDead = (p) => !!(p.is_deceased || p.death_date);
const years = (p) => {
  const b = yr(p.birth_date), d = yr(p.death_date);
  if (b && d) return `${b} – ${d}`;
  if (d) return `vefat ${d}`;
  if (p.is_deceased) return b ? `${b} – vefat` : "vefat";
  return b;
};
const siblingsOf = (p) => S.people.filter((x) => x.id !== p.id && ((p.father_id && x.father_id === p.father_id) || (p.mother_id && x.mother_id === p.mother_id)));

// Nesil (yatay bant) renkleri: bu tarayıcıda saklanır
const GEN_DEFAULTS = ["#f4c7a1", "#f1e08a", "#b9e3a4", "#a6d8e8", "#c9b8ee", "#f2b5d4", "#cfd6dc", "#e8c9a0"];
function loadGen() {
  try {
    const g = JSON.parse(localStorage.getItem("soyagaci_gen") || "null");
    if (g && typeof g === "object") return { on: g.on !== false, colors: Array.isArray(g.colors) ? g.colors : [] };
  } catch (_) { /* yok sayılır */ }
  return { on: true, colors: [] };
}
function saveGen() { try { localStorage.setItem("soyagaci_gen", JSON.stringify(S.gen)); } catch (_) { /* yok sayılır */ } }
const genColor = (i) => S.gen.colors[i] || GEN_DEFAULTS[i % GEN_DEFAULTS.length];
S.gen = loadGen();
// Önizleme ayarları (bu cihazda saklanır)
const PREF_LABELS = { photo: "Fotoğraf (büyütülmüş)", age: "Yaş (yıl ve ay)", city: "Yaşadığı şehir", burial: "Defin yeri (vefat edenler)", blood: "Kan grubu" };
function loadPrefs() {
  const d = { photo: true, age: true, city: true, burial: true, blood: true };
  try { Object.assign(d, JSON.parse(localStorage.getItem("soyagaci_prefs") || "{}")); } catch (_) { /* yok sayılır */ }
  return d;
}
function savePrefs() { try { localStorage.setItem("soyagaci_prefs", JSON.stringify(S.prefs)); } catch (_) { /* yok sayılır */ } }
const dparts = (d) => String(d).slice(0, 10).split("-").map(Number);
function monthsBetween(a, b) {
  const [ay, am, ad] = dparts(a), [by, bm, bd] = dparts(b);
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
}
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
// Şu anki yaş (hayattaysa) ya da vefat ettiğindeki yaş
function ageText(p) {
  if (!p.birth_date) return "";
  let end;
  if (p.death_date) end = p.death_date;
  else if (p.is_deceased) return "";
  else end = todayStr();
  const m = monthsBetween(p.birth_date, end);
  if (m < 0) return "";
  const t = `${Math.floor(m / 12)} yıl ${m % 12} ay`;
  return isDead(p) ? `${t} (vefat ettiğinde)` : t;
}
function previewBits(p) {
  const out = [];
  if (S.prefs.city && p.city) out.push(`📍 ${p.city}`);
  if (S.prefs.burial && isDead(p) && p.burial_place) out.push(`Defin yeri: ${p.burial_place}`);
  if (S.prefs.blood && p.blood_type) out.push(`🩸 ${p.blood_type}`);
  return out;
}
const genderCls = (p) => (p.gender === "E" ? "m" : p.gender === "K" ? "f" : "");
const profName = (id) => { const x = S.profiles.find((p) => p.id === id); return x ? x.full_name || x.email : ""; };
// Eşler: kayıtlı eşlikler + ortak çocuğu olan baba/anne (eşlik kaydı girilmemiş olsa bile)
const spousesOf = (id) => {
  const set = new Set(S.spouses.filter((s) => s.person_a === id || s.person_b === id).map((s) => (s.person_a === id ? s.person_b : s.person_a)));
  S.people.forEach((c) => {
    if (c.father_id && c.mother_id) {
      if (c.father_id === id) set.add(c.mother_id);
      else if (c.mother_id === id) set.add(c.father_id);
    }
  });
  return [...set].filter((x) => byId(x));
};
const childrenOf = (ids) => S.people.filter((p) => ids.includes(p.father_id) || ids.includes(p.mother_id));
const isAdmin = () => !!(S.me && S.me.is_admin);
const isFull = () => !!(S.me && S.me.approved && (S.me.is_admin || S.me.can_add)); // "tam yetki": herkes için değişiklik önerebilir
const canAdd = isFull;
// Kendi soyum: ben + atalarım + altsoyum
function lineage() {
  const me = S.me?.person_id;
  const anc = new Set(), desc = new Set();
  if (!me || !byId(me)) return { me: null, anc, desc };
  const up = (id) => { const q = byId(id); if (!q) return; [q.father_id, q.mother_id].forEach((x) => { if (x && !anc.has(x)) { anc.add(x); up(x); } }); };
  const down = (id) => childrenOf([id]).forEach((c) => { if (!desc.has(c.id)) { desc.add(c.id); down(c.id); } });
  up(me); down(me);
  return { me, anc, desc };
}
const inLine = (id) => { if (isFull()) return true; const l = lineage(); return !!l.me && (id === l.me || l.anc.has(id) || l.desc.has(id)); };
const canEditPerson = (p) => isFull() || (!!S.me && S.me.person_id === p.id);
const canDeletePerson = () => isAdmin();
const canDelSpouse = () => isAdmin();
const canAddParent = (p, role) => !(role === "father" ? p.father_id : p.mother_id) && inLine(p.id);

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}
function showModal(html) {
  modal.innerHTML = `<div class="sheet"><button type="button" class="x" data-action="closeModal" aria-label="Kapat">×</button>${html}</div>`;
  modal.classList.add("open");
}
function closeModal() {
  modal.classList.remove("open");
  modal.innerHTML = "";
}

// ---------- kurulum kontrolü ----------
if (SUPABASE_URL.includes("PROJE-ID") || SUPABASE_ANON_KEY.startsWith("ANON-")) {
  app.innerHTML = `<div class="setup"><h2>Kurulum gerekli</h2>
    <p><b>config.js</b> dosyasına Supabase adresinizi ve anon anahtarınızı yazın. Adımlar için README.md dosyasına bakın.</p></div>`;
  throw new Error("config.js ayarlanmamış");
}
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- oturum ----------
sb.auth.onAuthStateChange((event, session) => {
  const uid = session?.user?.id || null;
  if (uid === (S.user?.id || null) && event !== "INITIAL_SESSION") return;
  setTimeout(() => boot(session), 0);
});

async function boot(session) {
  if (!session) {
    Object.assign(S, { user: null, me: null, people: [], spouses: [], profiles: [], tab: "tree", rootId: null });
    closeModal();
    renderAuth("login");
    return;
  }
  S.user = session.user;
  await loadAll();
  render();
}

async function loadAll() {
  const [pr, pe, sp, rq, nt, ph] = await Promise.all([
    sb.from("profiles").select("*").order("full_name"),
    sb.from("people").select("*").order("birth_date", { ascending: true, nullsFirst: false }),
    sb.from("spouses").select("*"),
    sb.from("change_requests").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("person_notes").select("*").order("created_at"),
    sb.from("photos").select("person_id"),
  ]);
  if (rq.error) toast("Talepler yüklenemedi (guncelleme.sql çalıştırıldı mı?): " + rq.error.message);
  S.requests = rq.data || [];
  S.notes = nt.data || [];
  S.photoSet = new Set((ph.data || []).map((x) => x.person_id));
  if (pr.error) toast("Veri yüklenemedi: " + pr.error.message);
  S.profiles = pr.data || [];
  S.people = pe.data || [];
  S.spouses = sp.data || [];
  S.me = S.profiles.find((p) => p.id === S.user.id) || null;
  S.invites = [];
  if (S.me?.is_admin) {
    const iv = await sb.from("invites").select("*");
    if (iv.error) toast("Davetler yüklenemedi (guncelleme.sql çalıştırıldı mı?): " + iv.error.message);
    else S.invites = iv.data || [];
  }
}

// ---------- giriş / kayıt ----------
function renderAuth(mode = "login", msg = "") {
  const reg = mode === "register";
  app.innerHTML = `<div class="auth">
    <h1>🌳 Soyağacı</h1>
    <form data-form="auth" data-mode="${mode}">
      ${reg ? `<label>Ad Soyad<input name="full_name" required autocomplete="name"></label>` : ""}
      <label>E-posta<input type="email" name="email" required autocomplete="email"></label>
      <label>Şifre<input type="password" name="password" required minlength="6" autocomplete="${reg ? "new-password" : "current-password"}"></label>
      <button class="btn primary">${reg ? "Kayıt ol" : "Giriş yap"}</button>
      <p class="msg" id="authMsg">${esc(msg)}</p>
    </form>
    <button type="button" class="link" data-action="switchAuth" data-id="${reg ? "login" : "register"}">${reg ? "Hesabım var, giriş yap" : "Hesabım yok, kayıt ol"}</button>
  </div>`;
}

async function submitAuth(f) {
  const msg = document.getElementById("authMsg");
  const btn = f.querySelector("button.primary");
  const email = f.elements.email.value.trim();
  const password = f.elements.password.value;
  btn.disabled = true;
  msg.textContent = "";
  if (f.dataset.mode === "register") {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: f.elements.full_name.value.trim() } } });
    if (error) { msg.textContent = error.message; btn.disabled = false; return; }
    if (!data.session) { msg.textContent = "Kayıt alındı ancak oturum açılamadı. Yönetici Supabase'de e-posta onayını kapatmalı."; btn.disabled = false; }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = "E-posta veya şifre hatalı."; btn.disabled = false; }
  }
}

// ---------- ana ekran ----------
function render() {
  if (!S.me) {
    app.innerHTML = `<div class="auth"><p>Profil yüklenemedi.</p><button class="btn" data-action="logout">Çıkış</button></div>`;
    return;
  }
  if (!S.me.approved) {
    app.innerHTML = `<div class="auth"><h2>Onay bekleniyor</h2>
      <p class="muted">Kaydınız alındı (${esc(S.me.email)}). Aile ağacını görmek için yöneticinin sizi onaylaması gerekiyor.</p>
      <button class="btn" data-action="refresh">Yenile</button>
      <button class="link" data-action="logout">Çıkış</button></div>`;
    return;
  }
  const tabs = [["tree", "🌳", "Ağaç"], ["people", "👥", "Kişiler"], ["profile", "👤", "Profilim"]];
  if (S.me.is_admin) {
    const waiting = S.profiles.filter((p) => !p.approved).length;
    const pend = S.requests.filter((r) => r.status === "pending").length;
    tabs.push(["approvals", "✅", "Onaylar" + (pend ? ` (${pend})` : "")]);
    tabs.push(["invites", "✉️", "Davetler"]);
    tabs.push(["members", "⚙️", "Üyeler" + (waiting ? ` (${waiting})` : "")]);
  }
  app.innerHTML = `<header class="top">
      <div class="brand">🌳 Soyağacı</div>
      <nav>${tabs.map(([k, ic, t]) => `<button type="button" class="${S.tab === k ? "on" : ""}" data-action="tab" data-id="${k}"><span class="ic">${ic}</span><span class="tl">${t}</span></button>`).join("")}</nav>
      <div class="user">${esc(S.me.full_name || S.me.email)} <button type="button" class="link" data-action="logout">Çıkış</button></div>
    </header><main id="view"></main>`;
  renderView();
}

function renderView() {
  const v = document.getElementById("view");
  v.classList.toggle("wide", S.tab === "tree"); // ağaç sekmesi tüm genişliği kullanır
  if (S.tab === "tree") renderTree(v);
  else if (S.tab === "people") renderPeople(v);
  else if (S.tab === "profile") renderProfile(v);
  else if (S.tab === "members") renderMembers(v);
  else if (S.tab === "invites") renderInvites(v);
  else if (S.tab === "approvals") renderApprovals(v);
  else if (S.tab === "blood") renderBlood(v);
}

// ---------- ağaç ----------
function defaultRoot() {
  const roots = S.people.filter((p) => !p.father_id && !p.mother_id);
  return (roots.find((r) => childrenOf([r.id]).length) || roots[0] || S.people[0]).id;
}

function card(id) {
  const p = byId(id);
  if (!p) return "";
  return `<button type="button" class="pcard ${genderCls(p)}${isDead(p) ? " dead" : ""}" data-action="open" data-id="${id}">
    ${isDead(p) ? `<span class="dm" title="Vefat etti. Allah rahmet eylesin">&#9770;&#xFE0E;</span>` : ""}${S.photoSet.has(id) ? `<span class="cm" title="Fotoğraf var">📷</span>` : ""}
    <span class="av">${esc((p.first_name || "?")[0])}</span><span class="nm">${esc(fullName(p))}</span><small>${esc(years(p))}</small></button>`;
}

// Kartın altında "↑ Baba & Anne" bağlantıları (ağaçta üstte görünmeyen ebeveynler için)
function parentsChip(id) {
  const p = byId(id);
  if (!p) return "";
  const list = [byId(p.father_id), byId(p.mother_id)].filter(Boolean);
  if (!list.length) return "";
  return `<div class="pchip">↑ ${list.map((x) => `<a href="#" data-action="open" data-id="${x.id}">${esc(fullName(x))}</a>`).join(" &amp; ")}</div>`;
}
const partner = (id, withParents) => `<div class="partner">${card(id)}${withParents ? parentsChip(id) : ""}</div>`;

function nodeHtml(id, seen, isRoot = false, depth = 0) {
  if (seen.has(id)) return "";
  seen.add(id);
  if (depth > S.maxGen) S.maxGen = depth;
  const sp = spousesOf(id).filter((x) => !seen.has(x) && byId(x));
  sp.forEach((x) => seen.add(x));
  const kidMap = new Map();
  childrenOf([id, ...sp]).forEach((k) => { if (!seen.has(k.id)) kidMap.set(k.id, k); });
  const kids = [...kidMap.values()].sort((a, b) => String(a.birth_date || "9999").localeCompare(String(b.birth_date || "9999")));
  let h = `<li><div class="couple" data-gen="${depth}">${partner(id, isRoot)}${sp.map((s) => `<span class="amp">&amp;</span>${partner(s, true)}`).join("")}</div>`;
  if (kids.length) h += `<ul>${kids.map((k) => nodeHtml(k.id, seen, false, depth + 1)).join("")}</ul>`;
  return h + "</li>";
}

// Nesil bantları: her nesil için tüm genişlikte yatay zemin rengi
function applyBands() {
  const tree = document.querySelector(".tree");
  if (!tree) return;
  tree.querySelectorAll(".gband").forEach((b) => b.remove());
  if (!S.gen.on) return;
  const prevZoom = tree.style.zoom;
  tree.style.zoom = 1; // ölçümü gerçek boyutta yap
  const base = tree.getBoundingClientRect().top;
  const rows = new Map();
  tree.querySelectorAll(".couple[data-gen]").forEach((c) => {
    const g = Number(c.dataset.gen);
    const r = c.getBoundingClientRect();
    const cur = rows.get(g) || { top: Infinity, bottom: -Infinity };
    cur.top = Math.min(cur.top, r.top - base);
    cur.bottom = Math.max(cur.bottom, r.bottom - base);
    rows.set(g, cur);
  });
  const gens = [...rows.keys()].sort((a, b) => a - b);
  const total = tree.scrollHeight;
  gens.forEach((g, i) => {
    const r = rows.get(g);
    const prev = i > 0 ? rows.get(gens[i - 1]) : null;
    const next = i < gens.length - 1 ? rows.get(gens[i + 1]) : null;
    const top = prev ? (prev.bottom + r.top) / 2 : 0;
    const bottom = next ? (r.bottom + next.top) / 2 : total;
    const el = document.createElement("div");
    el.className = "gband";
    el.style.cssText = `top:${top}px;height:${Math.max(0, bottom - top)}px;background:${genColor(g)}`;
    el.innerHTML = `<span>${g + 1}. nesil</span>`;
    tree.prepend(el);
  });
  tree.style.zoom = prevZoom;
}

function genForm() {
  const n = Math.max(1, S.maxGen + 1);
  showModal(`<h2>Nesil renkleri</h2>
    <p class="muted">Her nesil için yatay zemin rengini seçin. Ayar bu cihazda saklanır.</p>
    <label class="check"><input type="checkbox" id="genOn" ${S.gen.on ? "checked" : ""}>Nesil renklerini göster</label>
    ${Array.from({ length: n }, (_, i) => `<label class="genrow"><span>${i + 1}. nesil</span><input type="color" data-gen-color="${i}" value="${genColor(i)}"></label>`).join("")}
    <div class="actions"><button type="button" class="btn" data-action="genReset">Varsayılana dön</button><button type="button" class="btn primary" data-action="closeModal">Tamam</button></div>`);
}

function renderTree(v) {
  if (!S.people.length) {
    v.innerHTML = `<div class="empty"><p>Henüz kimse eklenmemiş.</p>${canAdd() ? `<button type="button" class="btn primary" data-action="addPerson">İlk kişiyi ekle</button>` : `<p class="muted">Kişi ekleme yetkisi için yöneticiye başvurun.</p>`}</div>`;
    return;
  }
  if (!S.rootId || !byId(S.rootId)) S.rootId = defaultRoot();
  const root = byId(S.rootId);
  const up = root.father_id || root.mother_id;
  v.innerHTML = `<div class="toolbar">
      <select id="rootSel" aria-label="Başlangıç kişisi">${S.people.map((p) => `<option value="${p.id}" ${p.id === S.rootId ? "selected" : ""}>${esc(fullName(p))} ${esc(years(p))}</option>`).join("")}</select>
      ${up ? `<button type="button" class="btn" data-action="goUp">↑ Üst nesil</button>` : ""}
      ${canAdd() ? `<button type="button" class="btn primary" data-action="addPerson">+ Kişi</button>` : ""}
    </div>
    <div id="treeArea" class="${S.treeFull ? "full" : ""}">
    <div class="zoombar">
      <button type="button" class="btn small" data-action="toggleFull">${S.treeFull ? "✕ Küçült" : "⛶ Tam ekran"}</button>
      <button type="button" class="btn small" data-action="genForm">🎨 Nesil renkleri</button>
      <button type="button" class="btn small" data-action="zoomOut" aria-label="Uzaklaştır">🔍−</button>
      <span id="zoomPct" class="muted"></span>
      <button type="button" class="btn small" data-action="zoomIn" aria-label="Yakınlaştır">🔍+</button>
      <button type="button" class="btn small" data-action="zoomFit">Tümünü sığdır</button>
      <button type="button" class="btn small" data-action="zoomReset">%100</button>
    </div>
    <div class="tree-wrap"><div class="tree"><ul>${(S.maxGen = 0, nodeHtml(S.rootId, new Set(), true))}</ul></div></div>
    </div>
    <p class="muted hint">Bir kişiye dokunarak ayrıntı ve fotoğraflarını açın. Küçültmek için 🔍− ya da "Tümünü sığdır"ı kullanın; Ctrl + fare tekerleği de yakınlaştırır, sürükleyerek kaydırabilirsiniz.</p>`;
  applyBands();
  applyZoom();
}

// ---------- yakınlaştırma ----------
const ZOOM_MIN = 0.15, ZOOM_MAX = 2;
function applyZoom() {
  const tree = document.querySelector(".tree");
  if (!tree) return;
  tree.style.zoom = S.zoom;
  const pct = document.getElementById("zoomPct");
  if (pct) pct.textContent = Math.round(S.zoom * 100) + "%";
}
function setZoom(z) {
  S.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  applyZoom();
}
function fitZoom() {
  const wrap = document.querySelector(".tree-wrap");
  const tree = document.querySelector(".tree");
  if (!wrap || !tree) return;
  tree.style.zoom = 1;
  tree.style.minWidth = "0";
  const natural = tree.offsetWidth;
  tree.style.minWidth = "";
  setZoom(Math.min(1, (wrap.clientWidth - 4) / natural));
  wrap.scrollLeft = 0;
}

// ---------- kişiler listesi ----------
const cityKey = (c) => String(c || "").trim().toLocaleLowerCase("tr");

function filteredPeople() {
  const q = S.q.trim().toLocaleLowerCase("tr");
  return S.people.filter((p) => {
    if (q && !`${fullName(p)} ${p.city || ""}`.toLocaleLowerCase("tr").includes(q)) return false;
    if (S.fCity && cityKey(p.city) !== S.fCity) return false;
    if (S.fGender === "?" ? !!p.gender : S.fGender && p.gender !== S.fGender) return false;
    if (S.fStatus === "alive" && isDead(p)) return false;
    if (S.fStatus === "dead" && !isDead(p)) return false;
    if (S.fBlood === "?" ? !!p.blood_type : S.fBlood && p.blood_type !== S.fBlood) return false;
    return true;
  });
}

function statsHtml(list) {
  const m = list.filter((p) => p.gender === "E").length;
  const f = list.filter((p) => p.gender === "K").length;
  const u = list.length - m - f;
  const dead = list.filter(isDead).length;
  const cell = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  const cities = new Map();
  list.forEach((p) => {
    const k = cityKey(p.city);
    if (!k) return;
    const c = cities.get(k) || { name: String(p.city).trim(), n: 0 };
    c.n++;
    cities.set(k, c);
  });
  const chips = [...cities.entries()].sort((a, b) => b[1].n - a[1].n)
    .map(([k, c]) => `<button type="button" class="chip ${S.fCity === k ? "on" : ""}" data-action="pickCity" data-id="${esc(k)}">${esc(c.name)} · ${c.n}</button>`).join("");
  return `<div class="stats">${cell(list.length, "Toplam")}${cell(m, "Erkek")}${cell(f, "Kadın")}${u ? cell(u, "Cinsiyet yok") : ""}${cell(list.length - dead, "Hayatta")}${cell(dead, "Vefat")}</div>
    ${chips ? `<div class="chips">${chips}</div>` : ""}`;
}

// Aile içi sıra: ağaçtaki gibi (kişi, eşleri, sonra çocukları doğum sırasıyla)
function familyRank() {
  const rank = new Map();
  const visit = (id) => {
    if (rank.has(id) || !byId(id)) return;
    rank.set(id, rank.size);
    const sp = spousesOf(id);
    sp.forEach((x) => { if (!rank.has(x)) rank.set(x, rank.size); });
    childrenOf([id, ...sp]).sort((a, b) => String(a.birth_date || "9999").localeCompare(String(b.birth_date || "9999"))).forEach((k) => visit(k.id));
  };
  if (S.people.length) visit(defaultRoot());
  S.people.filter((p) => !p.father_id && !p.mother_id).forEach((p) => visit(p.id));
  S.people.forEach((p) => visit(p.id));
  return rank;
}
function sortPeople(list) {
  const bd = (p) => String(p.birth_date || "");
  const cmpBirth = (dir) => (a, b) => (!bd(a) - !bd(b)) || dir * bd(a).localeCompare(bd(b)) || fullName(a).localeCompare(fullName(b), "tr");
  const fns = {
    alpha: (a, b) => fullName(a).localeCompare(fullName(b), "tr"),
    age_old: cmpBirth(1),
    age_young: cmpBirth(-1),
    created_old: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
    created_new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
  };
  if (S.sort === "family") { const r = familyRank(); return list.slice().sort((a, b) => r.get(a.id) - r.get(b.id)); }
  return list.slice().sort(fns[S.sort] || fns.alpha);
}
function peopleListHtml(list) {
  if (!list.length) return `<p class="muted center">Sonuç yok.</p>`;
  return sortPeople(list)
    .map((p) => { const bits = previewBits(p); return `<button type="button" data-action="open" data-id="${p.id}"><span>${S.photoSet.has(p.id) ? "📷 " : ""}${esc(fullName(p))}${bits.length ? `<small class="city">${esc(bits.join(" · "))}</small>` : ""}</span><span class="muted">${esc(years(p))}</span></button>`; })
    .join("");
}

function refreshPeople() {
  const list = filteredPeople();
  const st = document.getElementById("pstats");
  const pl = document.getElementById("plist");
  if (st) st.innerHTML = statsHtml(list);
  if (pl) pl.innerHTML = peopleListHtml(list);
}

function renderPeople(v) {
  const seen = new Map();
  S.people.forEach((p) => { const k = cityKey(p.city); if (k && !seen.has(k)) seen.set(k, String(p.city).trim()); });
  const cityOpts = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "tr"))
    .map(([k, n]) => `<option value="${esc(k)}" ${S.fCity === k ? "selected" : ""}>${esc(n)}</option>`).join("");
  const sel = (val, cur) => (val === cur ? "selected" : "");
  v.innerHTML = `<div class="toolbar"><input id="q" type="search" placeholder="Ad veya şehir ara…" value="${esc(S.q)}">
      ${canAdd() ? `<button type="button" class="btn primary" data-action="addPerson">+ Kişi</button>` : ""}</div>
    <div class="filters">
      <select id="fCity" aria-label="Şehir"><option value="">Tüm şehirler</option>${cityOpts}</select>
      <select id="fGender" aria-label="Cinsiyet"><option value="">Erkek + Kadın</option>
        <option value="E" ${sel("E", S.fGender)}>Erkek</option><option value="K" ${sel("K", S.fGender)}>Kadın</option><option value="?" ${sel("?", S.fGender)}>Cinsiyet yok</option></select>
      <select id="fStatus" aria-label="Durum"><option value="">Hayatta + Vefat</option>
        <option value="alive" ${sel("alive", S.fStatus)}>Hayatta</option><option value="dead" ${sel("dead", S.fStatus)}>Vefat etti</option></select>
      <select id="fBlood" aria-label="Kan grubu"><option value="">Tüm kan grupları</option>
        ${BLOOD.map((b) => `<option value="${b}" ${sel(b, S.fBlood)}>${b}</option>`).join("")}<option value="?" ${sel("?", S.fBlood)}>Kan grubu girilmemiş</option></select>
      <button type="button" class="btn small" data-action="clearFilters">Temizle</button>
    </div>
    <div class="filters">
      <select id="sortSel" aria-label="Sıralama">${Object.entries(SORTS).map(([k, t]) => `<option value="${k}" ${sel(k, S.sort)}>${t}</option>`).join("")}</select>
      <button type="button" class="btn small" data-action="bloodScreen">🩸 Kan grubu girişi</button>
    </div>
    <div id="pstats"></div>
    <div class="list" id="plist"></div>`;
  refreshPeople();
}

// ---------- profilim ----------
function renderProfile(v) {
  const me = S.me;
  v.innerHTML = `<div class="panel"><h2>Profilim</h2>
    <form data-form="profile">
      <label>E-posta<input value="${esc(me.email)}" disabled></label>
      <label>Ad Soyad<input name="full_name" required value="${esc(me.full_name)}"></label>
      <p class="muted">Ağaçtaki kişim: <b>${me.person_id && byId(me.person_id) ? esc(fullName(byId(me.person_id))) : "henüz bağlı değil (yöneticiye söyleyin)"}</b></p>
      <p class="muted">Yetkiniz: ${me.is_admin ? "Yönetici (değişiklikler doğrudan uygulanır)" : me.can_add ? "Tam yetki: herkes için değişiklik önerebilir (yönetici onayına düşer)" : me.person_id ? "Kendi kaydını düzenleyebilir, kendi alt/üst soyuna ekleme önerebilir, bilgi notu paylaşabilir (yönetici onayına düşer)" : "Görüntüleme, bilgi notu ve fotoğraf ekleme"}</p>
      <div class="actions"><button class="btn primary">Kaydet</button></div>
    </form></div>
    <div class="panel" style="margin-top:1rem"><h2>Önizleme ayarları</h2>
      <p class="muted">Kişinin üzerine gelince açılan önizlemede ve listede hangi bilgiler görünsün? (Bu cihazda saklanır.)</p>
      ${Object.entries(PREF_LABELS).map(([k, t]) => `<label class="check"><input type="checkbox" data-pref="${k}" ${S.prefs[k] ? "checked" : ""}>${t}</label>`).join("")}
    </div>
    ${me.is_admin ? "" : `<div class="panel" style="margin-top:1rem"><h2>Taleplerim</h2>${myRequestsHtml()}</div>`}
    <div class="panel" style="margin-top:1rem"><h2>📱 Uygulama olarak kullan</h2>
      ${isStandalone()
        ? `<p class="muted">Şu anda uygulama olarak kullanıyorsunuz.</p>`
        : deferredInstall
          ? `<p class="muted">Telefonunuzun ana ekranına ekleyip uygulama gibi açabilirsiniz.</p><button type="button" class="btn primary" data-action="install">Uygulamayı yükle</button>`
          : `<p class="muted"><b>Android (Chrome):</b> ⋮ menü &gt; "Uygulamayı yükle" veya "Ana ekrana ekle".<br><b>iPhone (Safari):</b> Paylaş simgesi &gt; "Ana Ekrana Ekle".<br><b>Bilgisayar (Chrome/Edge):</b> Adres çubuğunun sağındaki yükle simgesi.</p>`}
    </div>
    <div class="panel" style="margin-top:1rem"><button type="button" class="btn danger" data-action="logout">Çıkış yap</button></div>`;
}
async function submitProfile(f) {
  const { error } = await sb.from("profiles").update({ full_name: f.elements.full_name.value.trim() }).eq("id", S.user.id);
  if (error) return toast("Hata: " + error.message);
  await loadAll();
  toast("Kaydedildi");
  render();
}

// ---------- üyeler (yönetici) ----------
function renderMembers(v) {
  const sorted = S.people.slice().sort((a, b) => fullName(a).localeCompare(fullName(b), "tr"));
  v.innerHTML = `<div class="panel" style="max-width:640px"><h2>Üyeler</h2>
    <p class="muted">Davetsiz kayıt olanlar onaylanana kadar hiçbir şey göremez. Davet ettiğiniz kişiler otomatik onaylanır (Davetler sekmesi).</p>
    ${S.profiles.map((p) => {
      const self = p.id === S.user.id;
      return `<div class="member"><div><b>${esc(p.full_name || "")}</b> <span class="muted">${esc(p.email)}</span></div>
        <label class="memberperson">Ağaçtaki kişisi<select data-member-person data-id="${p.id}"><option value="">— bağlı değil —</option>
          ${sorted.map((x) => `<option value="${x.id}" ${x.id === p.person_id ? "selected" : ""}>${esc(fullName(x))} ${esc(years(x))}</option>`).join("")}</select></label>
        <div class="opts">
          <label><input type="checkbox" data-member="approved" data-id="${p.id}" ${p.approved ? "checked" : ""} ${self ? "disabled" : ""}> Onaylı</label>
          <label><input type="checkbox" data-member="can_add" data-id="${p.id}" ${p.can_add || p.is_admin ? "checked" : ""} ${p.is_admin ? "disabled" : ""}> Tam yetki</label>
          <label><input type="checkbox" data-member="is_admin" data-id="${p.id}" ${p.is_admin ? "checked" : ""} ${self ? "disabled" : ""}> Yönetici</label>
        </div></div>`;
    }).join("")}</div>`;
}
async function changeMember(el) {
  const field = el.dataset.member;
  const patch = { [field]: el.checked };
  if (field === "is_admin" && el.checked) Object.assign(patch, { approved: true, can_add: true });
  if (field === "can_add" && el.checked) patch.approved = true;
  const { error } = await sb.from("profiles").update(patch).eq("id", el.dataset.id);
  if (error) toast("Hata: " + error.message);
  await loadAll();
  render();
}

async function changeMemberPerson(el) {
  const { error } = await sb.from("profiles").update({ person_id: el.value || null }).eq("id", el.dataset.id);
  if (error) toast("Hata: " + error.message);
  else toast("Kaydedildi");
  await loadAll();
  render();
}

// ---------- davetler (yönetici) ----------
const inviteOf = (pid) => S.invites.find((i) => i.person_id === pid);
const linkedOf = (pid) => S.profiles.find((x) => x.person_id === pid);
const siteUrl = () => new URL("./", location.href).href;

function inviteStatus(p) {
  const l = linkedOf(p.id);
  if (l) return { cls: "ok", text: `✅ Kayıtlı (${l.email})` };
  if (inviteOf(p.id)) return { cls: "wait", text: "✉️ Davet bekliyor" };
  return { cls: "none", text: "E-posta girilmedi" };
}

function filteredInvitePeople() {
  const q = S.iq.trim().toLocaleLowerCase("tr");
  return S.people
    .filter((p) => {
      if (q && !`${fullName(p)} ${inviteOf(p.id)?.email || ""}`.toLocaleLowerCase("tr").includes(q)) return false;
      return !S.iFilter || inviteStatus(p).cls === S.iFilter;
    })
    .sort((a, b) => fullName(a).localeCompare(fullName(b), "tr"));
}

function invitesSummary() {
  const c = { ok: 0, wait: 0, none: 0 };
  S.people.forEach((p) => { c[inviteStatus(p).cls]++; });
  return `<div class="stats">
    <div class="stat"><b>${S.people.length}</b><span>Kişi</span></div>
    <div class="stat"><b>${c.ok}</b><span>Kayıtlı</span></div>
    <div class="stat"><b>${c.wait}</b><span>Davet bekliyor</span></div>
    <div class="stat"><b>${c.none}</b><span>E-postası yok</span></div></div>`;
}

function invitesListHtml() {
  const list = filteredInvitePeople();
  if (!list.length) return `<p class="muted center">Sonuç yok.</p>`;
  return list.map((p) => {
    const i = inviteOf(p.id), st = inviteStatus(p);
    return `<div class="inv" data-person="${p.id}">
      <div class="inv-top"><b>${esc(fullName(p))}</b><span class="status ${st.cls}">${esc(st.text)}</span></div>
      <div class="muted inv-sub">${esc([years(p), p.city].filter(Boolean).join(" · "))}</div>
      <input type="email" inputmode="email" autocomplete="off" placeholder="E-posta adresi" data-inv-email value="${esc(i?.email || "")}">
      <div class="inv-actions">
        <select data-inv-perm aria-label="Yetki">
          <option value="0" ${i?.can_add ? "" : "selected"}>Kendi kaydı + alt/üst soyu (onaylı)</option>
          <option value="1" ${i?.can_add ? "selected" : ""}>Tam yetki (herkes için öner, onaylı)</option></select>
        <button type="button" class="btn small primary" data-action="saveInvite" data-id="${p.id}">Kaydet</button>
        ${i ? `<button type="button" class="btn small" data-action="inviteMsg" data-id="${p.id}">Davet gönder</button>` : ""}
      </div></div>`;
  }).join("");
}

function refreshInvites() {
  const s = document.getElementById("invsum"), l = document.getElementById("invlist");
  if (s) s.innerHTML = invitesSummary();
  if (l) l.innerHTML = invitesListHtml();
}

function renderInvites(v) {
  const sel = (val) => (S.iFilter === val ? "selected" : "");
  v.innerHTML = `<div class="panel wide"><h2>Davetler</h2>
    <p class="muted">Kişinin yanına e-posta adresini yazıp <b>Kaydet</b> deyin. O e-postayla kayıt olduğunda otomatik onaylanır ve kendi kartına bağlanır.
    Hangi yetkiyi seçerseniz seçin, yönetici dışındakilerin tüm değişiklikleri <b>Onaylar</b> sekmesine düşer; siz onaylayınca listeye girer.
    E-posta doğrulaması olmadığından daveti yalnızca ilgili kişiye özel iletin.</p></div>
    <div id="invsum"></div>
    <div class="filters">
      <input id="iq" type="search" placeholder="Ad veya e-posta ara…" value="${esc(S.iq)}">
      <select id="iFilter" aria-label="Durum"><option value="">Hepsi</option>
        <option value="none" ${sel("none")}>E-postası olmayanlar</option>
        <option value="wait" ${sel("wait")}>Davet bekleyenler</option>
        <option value="ok" ${sel("ok")}>Kayıt olanlar</option></select>
    </div>
    <div class="list invlist" id="invlist"></div>`;
  refreshInvites();
}

async function saveInvite(pid, el) {
  const row = el.closest(".inv");
  const email = row.querySelector("[data-inv-email]").value.trim().toLowerCase();
  const perm = row.querySelector("[data-inv-perm]").value === "1";
  el.disabled = true;
  try {
    if (!email) {
      if (!inviteOf(pid)) { toast("Önce e-posta adresini yazın."); return; }
      const { error } = await sb.from("invites").delete().eq("person_id", pid);
      if (error) throw error;
      toast("Davet kaldırıldı");
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Geçerli bir e-posta adresi yazın."); return; }
      const { error } = await sb.from("invites").upsert({ person_id: pid, email, can_add: perm }, { onConflict: "person_id" });
      if (error) throw error;
      toast("Kaydedildi. Bu e-postayla kayıt olunca otomatik onaylanır.");
    }
    await loadAll();
    refreshInvites();
  } catch (err) {
    toast(err.code === "23505" ? "Bu e-posta başka bir kişiye atanmış." : "Hata: " + (err.message || err));
  } finally {
    el.disabled = false;
  }
}

function inviteMsg(pid) {
  const p = byId(pid), i = inviteOf(pid);
  if (!p || !i) return;
  const text = `Merhaba ${p.first_name}, 🌳 aile ağacımıza seni davet ediyorum.

Adres: ${siteUrl()}

Açılan sayfada "Hesabım yok, kayıt ol" diyerek ${i.email} e-posta adresinle kayıt ol ve kendi şifreni belirle. Kayıt olunca otomatik olarak kendi kartına bağlanırsın; bilgilerini güncelleme önerebilir ve fotoğraf ekleyebilirsin (değişiklikler yönetici onayından sonra yayınlanır).

Telefonda uygulama gibi kullanmak için: Android Chrome'da ⋮ menü > "Uygulamayı yükle", iPhone Safari'de Paylaş > "Ana Ekrana Ekle".`;
  showModal(`<h2>Davet gönder</h2>
    <p class="muted">${esc(fullName(p))} · ${esc(i.email)}</p>
    <textarea id="inviteText" rows="10" readonly>${esc(text)}</textarea>
    <div class="actions wrap">
      <a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
      <a class="btn" href="mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent("Soyağacı daveti")}&body=${encodeURIComponent(text)}">E-posta</a>
      <button type="button" class="btn" data-action="copyInvite">Kopyala</button>
    </div>`);
}

async function copyInvite() {
  const t = document.getElementById("inviteText");
  if (!t) return;
  try { await navigator.clipboard.writeText(t.value); }
  catch (_) { t.select(); document.execCommand("copy"); }
  toast("Kopyalandı");
}

// ---------- kişi ayrıntısı ----------
const personLink = (p) => (p ? `<a href="#" data-action="open" data-id="${p.id}">${esc(fullName(p))}</a>` : "");

const fmtDT = (x) => new Date(x).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
const fmtDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "");
const relMeta = (x) => [years(x), x.city].filter(Boolean).join(" · ");

async function openPerson(id) {
  const p = byId(id);
  if (!p) return;
  hidePop();
  const father = byId(p.father_id), mother = byId(p.mother_id);
  const spRows = S.spouses.filter((s) => s.person_a === id || s.person_b === id);
  const kids = childrenOf([id]);
  const sibs = siblingsOf(p);
  const explicitSp = new Set(spRows.map((r) => (r.person_a === id ? r.person_b : r.person_a)));
  const impliedSp = spousesOf(id).filter((x) => !explicitSp.has(x)).map(byId);
  const row = (role, x, extra = "") => `<tr><th>${role}</th><td>${personLink(x)}${extra}</td><td class="muted">${esc(relMeta(x))}</td></tr>`;
  const missing = (role, key) => (canAddParent(p, key) ? `<tr><th>${role}</th><td colspan="2" class="muted">eklenmemiş <button type="button" class="mini wide" data-action="addParent" data-id="${id}" data-role="${key}">+ ${role} ekle</button></td></tr>` : "");
  const rels = [
    father ? row("Baba", father) : missing("Baba", "father"),
    mother ? row("Anne", mother) : missing("Anne", "mother"),
    ...spRows.map((r) => { const o = byId(r.person_a === id ? r.person_b : r.person_a); return o ? row("Eş", o, canDelSpouse() ? ` <button type="button" class="mini" data-action="delSpouse" data-id="${r.id}" data-person="${id}" title="Eşliği kaldır">×</button>` : "") : ""; }),
    ...impliedSp.map((o) => row("Eş", o)),
    ...sibs.map((x) => row(x.gender === "E" ? "Erkek kardeş" : x.gender === "K" ? "Kız kardeş" : "Kardeş", x)),
    ...kids.map((x) => row(x.gender === "E" ? "Oğlu" : x.gender === "K" ? "Kızı" : "Çocuğu", x)),
  ].join("");
  const age = ageText(p);
  const info = [
    ["Doğum", [fmtDate(p.birth_date), p.birth_place].filter(Boolean).join(" · ")],
    [isDead(p) ? "Yaşı" : "Şu anki yaşı", age],
    ["Yaşadığı şehir", p.city],
    ["Kan grubu", p.blood_type],
    ["Vefat", isDead(p) ? fmtDate(p.death_date) || "Vefat etti" : ""],
    ["Defin yeri", isDead(p) ? p.burial_place : ""],
  ].filter(([, v]) => v);
  const notes = S.notes.filter((n) => n.person_id === id);
  const pend = S.requests.filter((r) => r.status === "pending" && r.person_id === id).length;
  const line = inLine(id);
  showModal(`
    <div class="phead"><span class="av big">${esc((p.first_name || "?")[0])}</span>
      <div><h2>${esc(fullName(p))} ${isDead(p) ? `<span class="dm-inline" title="Vefat etti">&#9770;&#xFE0E;</span>` : ""}</h2>
        <div class="muted">${esc(years(p))}${isDead(p) ? " · vefat etti" : ""}</div></div></div>
    ${pend ? `<p class="pending">⏳ Bu kişi için ${pend} değişiklik talebi onay bekliyor.</p>` : ""}
    ${info.length ? `<table class="infotable">${info.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
    ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ""}
    <h3>Aile</h3>
    ${rels ? `<table class="reltable"><tr class="hd"><th>Yakınlık</th><th>Kişi</th><th>Bilgi</th></tr>${rels}</table>` : `<p class="muted">Henüz bağlı yakını yok.</p>`}
    <div class="actions wrap">
      ${line ? `<button type="button" class="btn" data-action="addChild" data-id="${id}">+ Çocuk</button><button type="button" class="btn" data-action="addSibling" data-id="${id}">+ Kardeş</button><button type="button" class="btn" data-action="addSpouse" data-id="${id}">+ Eş</button>` : ""}
      ${canEditPerson(p) ? `<button type="button" class="btn" data-action="editPerson" data-id="${id}">Düzenle</button>` : ""}
      ${canDeletePerson() ? `<button type="button" class="btn danger" data-action="deletePerson" data-id="${id}">Sil</button>` : ""}
    </div>
    ${isAdmin() ? "" : `<p class="muted small">Yaptığınız değişiklikler yönetici onayından sonra listeye eklenir.</p>`}
    <h3>Bilgi notları <button type="button" class="btn small" data-action="addNote" data-id="${id}">+ Not</button></h3>
    ${notes.length ? notes.map((n) => `<div class="note"><div class="muted">${esc(n.author_name || profName(n.author_id) || "")} · ${fmtDT(n.created_at)}${isAdmin() ? ` <button type="button" class="mini" data-action="delNote" data-id="${n.id}" data-person="${id}" title="Notu sil">×</button>` : ""}</div>${esc(n.body)}</div>`).join("") : `<p class="muted">Henüz not yok.</p>`}
    <h3>Fotoğraflar <button type="button" class="btn small" data-action="addPhoto" data-id="${id}">+ Fotoğraf</button></h3>
    <div id="photoBox" class="muted" data-pid="${id}">Yükleniyor…</div>`);

  const photos = await loadPhotos(id);
  const box = document.getElementById("photoBox");
  if (!box || box.dataset.pid !== id) return;
  box.classList.remove("muted");
  box.innerHTML = photos.length
    ? `<div class="grid">${photos.map((ph) => `<figure>
        <a href="${esc(ph.url)}" target="_blank" rel="noopener"><img src="${esc(ph.url)}" loading="lazy" alt=""></a>
        <figcaption>${esc(ph.caption || "")}
          <span class="badge">${VIS[ph.visibility]}</span>
          <span class="muted">${esc(profName(ph.uploaded_by))}</span>
          <span class="fig-actions">
            ${ph.uploaded_by === S.user.id ? `<button type="button" class="btn small" data-action="editPhoto" data-id="${ph.id}" data-person="${id}">Görünürlük</button>` : ""}
            ${ph.uploaded_by === S.user.id || S.me.is_admin ? `<button type="button" class="btn small danger" data-action="delPhoto" data-id="${ph.id}" data-person="${id}">Sil</button>` : ""}
          </span></figcaption></figure>`).join("")}</div>`
    : `<p class="muted">Görebileceğiniz fotoğraf yok.</p>`;
}

async function loadPhotos(personId) {
  const { data: photos, error } = await sb.from("photos").select("*").eq("person_id", personId).order("created_at", { ascending: false });
  if (error || !photos?.length) return [];
  const { data: signed } = await sb.storage.from("photos").createSignedUrls(photos.map((x) => x.storage_path), 3600);
  const map = new Map((signed || []).map((s) => [s.path, s.signedUrl]));
  return photos.map((x) => ({ ...x, url: map.get(x.storage_path) || "" }));
}

// ---------- değişiklik gönderme (yönetici: hemen uygulanır, diğerleri: onaya düşer) ----------
async function saveChange(req) {
  const ins = await sb.from("change_requests").insert({
    kind: req.kind, person_id: req.person_id || null, payload: req.payload, summary: req.summary,
    requester_name: S.me.full_name || S.me.email,
  }).select().single();
  if (ins.error) throw ins.error;
  if (!isAdmin()) return { pending: true };
  const r = await sb.rpc("review_change", { req_id: ins.data.id, approve: true, note: null });
  if (r.error) throw r.error;
  return { pending: false, id: r.data };
}
async function finishChange(res, personId) {
  await loadAll();
  render();
  if (res.pending) {
    toast("Talep yöneticiye gönderildi. Onaylanınca listeye eklenir.");
    if (personId && byId(personId)) openPerson(personId); else closeModal();
  } else {
    toast("Kaydedildi");
    const id = res.id || personId;
    if (id && byId(id)) openPerson(id); else closeModal();
  }
}

const FIELD_LABELS = { first_name: "Ad", last_name: "Soyad", gender: "Cinsiyet", birth_place: "Doğum yeri", birth_date: "Doğum tarihi", death_date: "Ölüm tarihi", city: "Şehir", is_deceased: "Vefat", burial_place: "Defin yeri", blood_type: "Kan grubu", notes: "Notlar", father_id: "Baba", mother_id: "Anne" };
function showVal(k, v) {
  if (v === null || v === undefined || v === "") return "boş";
  if (k === "father_id" || k === "mother_id") return fullName(byId(v)) || "?";
  if (k === "is_deceased") return v ? "evet" : "hayır";
  if (k === "gender") return v === "E" ? "Erkek" : "Kadın";
  return String(v);
}

function personForm(p, preset = {}) {
  const v = p || preset;
  const others = S.people.filter((x) => !p || x.id !== p.id);
  const lockParent = (k) => !isAdmin() && p && p[k]; // yönetici dışı mevcut ebeveyn bağını değiştiremez/silemez
  const opt = (list, sel) => `<option value="">—</option>` + list.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(fullName(x))} ${esc(years(x))}</option>`).join("");
  const dead = !!(v.is_deceased || v.death_date);
  showModal(`<h2>${p ? "Kişiyi düzenle" : "Yeni kişi"}</h2>
    ${isAdmin() ? "" : `<p class="muted small">Kaydettiğinizde değişiklik yönetici onayına gönderilir.</p>`}
    <form data-form="person" data-id="${p?.id || ""}" data-spouse-of="${preset.spouseOf || ""}" data-father-of="${preset.fatherOf || ""}" data-mother-of="${preset.motherOf || ""}">
      <div class="row2"><label>Ad<input name="first_name" required value="${esc(v.first_name)}"></label>
        <label>Soyad<input name="last_name" value="${esc(v.last_name)}"></label></div>
      <div class="row2"><label>Cinsiyet<select name="gender"><option value="">—</option>
          <option value="E" ${v.gender === "E" ? "selected" : ""}>Erkek</option><option value="K" ${v.gender === "K" ? "selected" : ""}>Kadın</option></select></label>
        <label>Doğum yeri<input name="birth_place" value="${esc(v.birth_place)}"></label></div>
      <div class="row2"><label>Yaşadığı şehir<input name="city" list="cityList" placeholder="Örn. İstanbul" value="${esc(v.city)}"></label>
        <label>Kan grubu<select name="blood_type"><option value="">—</option>${BLOOD.map((b) => `<option value="${b}" ${v.blood_type === b ? "selected" : ""}>${b}</option>`).join("")}</select></label></div>
      <datalist id="cityList">${[...new Set(S.people.map((x) => String(x.city || "").trim()).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      <div class="row2"><label>Doğum tarihi<input type="date" name="birth_date" value="${esc(v.birth_date)}"></label>
        <label>Ölüm tarihi<input type="date" name="death_date" value="${esc(v.death_date)}"></label></div>
      <label class="check"><input type="checkbox" name="is_deceased" ${dead ? "checked" : ""}>Vefat etti</label>
      <label class="burialRow" ${dead ? "" : "hidden"}>Defin yeri (mezar yeri) notu<input name="burial_place" placeholder="Örn. Karacaahmet Mezarlığı, 12. ada" value="${esc(v.burial_place)}"></label>
      <label>Baba<select name="father_id" ${lockParent("father_id") ? "disabled" : ""}>${opt(others.filter((x) => x.gender !== "K"), v.father_id)}</select></label>
      <label>Anne<select name="mother_id" ${lockParent("mother_id") ? "disabled" : ""}>${opt(others.filter((x) => x.gender !== "E"), v.mother_id)}</select></label>
      <label>Notlar<textarea name="notes" rows="3">${esc(v.notes)}</textarea></label>
      <div class="actions"><button type="button" class="btn" data-action="closeModal">Vazgeç</button><button class="btn primary">${isAdmin() ? "Kaydet" : "Onaya gönder"}</button></div>
    </form>`);
}

async function submitPerson(f) {
  const e = f.elements;
  const val = (n) => (e[n].value.trim() === "" ? null : e[n].value.trim());
  const dead = e.is_deceased.checked || !!val("death_date");
  const obj = {
    first_name: e.first_name.value.trim(), last_name: val("last_name"), gender: val("gender"),
    birth_place: val("birth_place"), birth_date: val("birth_date"), death_date: val("death_date"),
    father_id: val("father_id"), mother_id: val("mother_id"), notes: val("notes"),
    city: val("city"), is_deceased: dead, burial_place: dead ? val("burial_place") : null, blood_type: val("blood_type"),
  };
  const btn = f.querySelector("button.primary");
  btn.disabled = true;
  try {
    const id = f.dataset.id;
    let res;
    if (id) {
      const old = byId(id);
      const payload = {};
      Object.keys(FIELD_LABELS).forEach((k) => {
        const o = old[k] === undefined || old[k] === "" ? null : old[k];
        if (o !== obj[k] && !(k === "is_deceased" && !o && !obj[k])) payload[k] = obj[k];
      });
      if (!isAdmin()) { if (old.father_id) delete payload.father_id; if (old.mother_id) delete payload.mother_id; }
      if (!Object.keys(payload).length) { btn.disabled = false; return toast("Değişiklik yok."); }
      const summary = `${fullName(old)}: ` + Object.entries(payload).map(([k, v]) => `${FIELD_LABELS[k]}: ${showVal(k, old[k])} → ${showVal(k, v)}`).join("; ");
      res = await saveChange({ kind: "update_person", person_id: id, payload, summary });
      return await finishChange(res, id);
    }
    const payload = { ...obj };
    let rel = "";
    if (f.dataset.spouseOf) { payload.spouse_of = f.dataset.spouseOf; rel = ` (${fullName(byId(f.dataset.spouseOf))} için eş)`; }
    if (f.dataset.fatherOf) { payload.as_father_of = f.dataset.fatherOf; rel = ` (${fullName(byId(f.dataset.fatherOf))} için baba)`; }
    if (f.dataset.motherOf) { payload.as_mother_of = f.dataset.motherOf; rel = ` (${fullName(byId(f.dataset.motherOf))} için anne)`; }
    if (!rel && (obj.father_id || obj.mother_id)) rel = ` (${[byId(obj.father_id), byId(obj.mother_id)].filter(Boolean).map(fullName).join(" & ")} çocuğu)`;
    res = await saveChange({ kind: "add_person", person_id: null, payload, summary: `Yeni kişi: ${fullName(obj)}${rel}` });
    await finishChange(res, f.dataset.spouseOf || f.dataset.fatherOf || f.dataset.motherOf || obj.father_id || obj.mother_id || null);
  } catch (err) {
    btn.disabled = false;
    toast("Hata: " + (err.message || err));
  }
}

async function deletePerson(id) {
  const p = byId(id);
  if (!confirm(`${fullName(p)} silinsin mi? Fotoğrafları da silinir.`)) return;
  const { data: ph } = await sb.from("photos").select("storage_path").eq("person_id", id);
  const { error } = await sb.from("people").delete().eq("id", id);
  if (error) return toast("Hata: " + error.message);
  if (ph?.length) await sb.storage.from("photos").remove(ph.map((x) => x.storage_path));
  closeModal();
  await loadAll();
  if (S.rootId === id) S.rootId = null;
  render();
  toast("Silindi");
}

function addChild(id) {
  const p = byId(id);
  if (!inLine(id)) return toast("Yalnızca kendi alt ve üst soyunuza ekleme yapabilirsiniz.");
  const sp = spousesOf(id).map(byId).filter(Boolean);
  const preset = {};
  if (p.gender === "K") { preset.mother_id = id; preset.father_id = sp.find((x) => x.gender !== "K")?.id; }
  else { preset.father_id = id; preset.mother_id = sp.find((x) => x.gender !== "E")?.id; }
  preset.last_name = (p.gender === "K" ? sp[0] : p)?.last_name || "";
  personForm(null, preset);
}

function addSibling(id) {
  const p = byId(id);
  if (!inLine(id)) return toast("Yalnızca kendi alt ve üst soyunuza ekleme yapabilirsiniz.");
  if (!p.father_id && !p.mother_id) {
    toast("Kardeş eklemek için önce bu kişinin baba veya annesini ekleyin.");
    return;
  }
  personForm(null, { father_id: p.father_id, mother_id: p.mother_id, last_name: p.last_name || "", city: p.city || "" });
}

function addParent(id, role) {
  const p = byId(id);
  if (!canAddParent(p, role)) return toast("Bu kişiye ebeveyn ekleyemezsiniz.");
  personForm(null, role === "father"
    ? { gender: "E", last_name: p.last_name || "", fatherOf: id }
    : { gender: "K", motherOf: id });
}

// ---------- eş ----------
function spouseForm(id) {
  if (!inLine(id)) return toast("Yalnızca kendi alt ve üst soyunuza ekleme yapabilirsiniz.");
  const p = byId(id);
  const cur = new Set(spousesOf(id));
  const list = S.people.filter((x) => x.id !== id && !cur.has(x.id));
  showModal(`<h2>${esc(fullName(p))} için eş ekle</h2>
    <form data-form="spouse" data-id="${id}">
      <label>Mevcut kişilerden seç<select name="other" required><option value="">—</option>
        ${list.map((x) => `<option value="${x.id}">${esc(fullName(x))} ${esc(years(x))}</option>`).join("")}</select></label>
      <label>Evlilik tarihi<input type="date" name="marriage_date"></label>
      <div class="actions"><button type="button" class="btn" data-action="newSpouse" data-id="${id}">Yeni kişi olarak ekle</button><button class="btn primary">${isAdmin() ? "Ekle" : "Onaya gönder"}</button></div>
    </form>`);
}
async function submitSpouse(f) {
  const a = f.dataset.id, b = f.elements.other.value;
  try {
    const res = await saveChange({ kind: "add_spouse", person_id: a, payload: { person_a: a, person_b: b, marriage_date: f.elements.marriage_date.value || null }, summary: `Eş ekleme: ${fullName(byId(a))} & ${fullName(byId(b))}` });
    await finishChange(res, a);
  } catch (err) { toast("Hata: " + (err.message || err)); }
}

// ---------- bilgi notu ----------
function noteForm(id) {
  showModal(`<h2>${esc(fullName(byId(id)))} için bilgi notu</h2>
    <form data-form="note" data-id="${id}">
      <label>Not<textarea name="text" rows="5" required maxlength="2000" placeholder="Örn. Bu kişi hakkında hatıra, bilgi, düzeltme…"></textarea></label>
      ${isAdmin() ? "" : `<p class="muted small">Notunuz yönetici onayından sonra herkese görünür.</p>`}
      <div class="actions"><button type="button" class="btn" data-action="backToPerson" data-id="${id}">Vazgeç</button><button class="btn primary">${isAdmin() ? "Paylaş" : "Onaya gönder"}</button></div>
    </form>`);
}
async function submitNote(f) {
  const id = f.dataset.id, text = f.elements.text.value.trim();
  if (!text) return;
  try {
    const res = await saveChange({ kind: "add_note", person_id: id, payload: { text }, summary: `Not (${fullName(byId(id))}): “${text.slice(0, 300)}”` });
    await finishChange(res, id);
  } catch (err) { toast("Hata: " + (err.message || err)); }
}

// ---------- onaylar (yönetici) ve taleplerim ----------
const KIND = { update_person: "Düzenleme", add_person: "Yeni kişi", add_spouse: "Eş ekleme", add_note: "Bilgi notu" };
const STATUS = { pending: "⏳ Onay bekliyor", approved: "✅ Onaylandı", rejected: "❌ Reddedildi" };

function reqRow(r, admin) {
  return `<div class="req ${r.status}"><div class="req-top"><b>${esc(KIND[r.kind] || r.kind)}</b><span class="muted">${esc(r.requester_name || profName(r.requested_by))} · ${fmtDT(r.created_at)}</span></div>
    <div>${esc(r.summary || "")}</div>
    ${r.status !== "pending" ? `<div class="muted small">${STATUS[r.status]}${r.review_note ? ` · ${esc(r.review_note)}` : ""}</div>` : ""}
    ${r.status === "pending" && admin ? `<div class="actions"><button type="button" class="btn small" data-action="rejectReq" data-id="${r.id}">Reddet</button><button type="button" class="btn small primary" data-action="approveReq" data-id="${r.id}">Onayla</button></div>` : ""}
    ${r.status === "pending" && !admin ? `<div class="actions"><button type="button" class="btn small" data-action="withdrawReq" data-id="${r.id}">Talebi geri çek</button></div>` : ""}</div>`;
}
function myRequestsHtml() {
  const mine = S.requests.filter((r) => r.requested_by === S.user.id).slice(0, 30);
  return mine.length ? `<div class="reqlist">${mine.map((r) => reqRow(r, false)).join("")}</div>` : `<p class="muted">Henüz talebiniz yok.</p>`;
}
function renderApprovals(v) {
  const pend = S.requests.filter((r) => r.status === "pending").slice().reverse();
  const done = S.requests.filter((r) => r.status !== "pending").slice(0, 40);
  const unann = S.requests.filter((r) => r.status === "approved" && !r.announced).length;
  v.innerHTML = `<div class="panel wide"><h2>Onay bekleyen değişiklikler</h2>
      <p class="muted">Üyelerin önerdiği değişiklikler burada toplanır. Onayladığınızda listeye eklenir. Yeni onaylanan değişiklikleri üyelere duyurmak için duyuru hazırlayın.</p>
      <div class="actions wrap">${pend.length > 1 ? `<button type="button" class="btn" data-action="approveAll">Hepsini onayla (${pend.length})</button>` : ""}
        <button type="button" class="btn primary" data-action="announceForm">📣 Güncelleme duyurusu hazırla${unann ? ` (${unann})` : ""}</button></div></div>
    <div class="reqlist">${pend.length ? pend.map((r) => reqRow(r, true)).join("") : `<p class="muted center">Bekleyen talep yok.</p>`}</div>
    ${done.length ? `<h3>Son işlemler</h3><div class="reqlist">${done.map((r) => reqRow(r, true)).join("")}</div>` : ""}`;
}
async function reviewReq(id, approve, note) {
  const r = await sb.rpc("review_change", { req_id: id, approve, note: note || null });
  if (r.error) { toast("Hata: " + r.error.message); return false; }
  return true;
}
async function afterReview() { await loadAll(); render(); }

function announceForm() {
  const items = S.requests.filter((r) => r.status === "approved" && !r.announced).slice().sort((a, b) => String(a.reviewed_at).localeCompare(String(b.reviewed_at)));
  if (!items.length) return toast("Duyurulacak yeni onaylı değişiklik yok.");
  const mails = S.profiles.filter((x) => x.approved && x.email).map((x) => x.email);
  const text = `Merhaba,\n\n🌳 Soyağacı güncellendi. Son değişiklikler:\n\n${items.map((r) => "• " + String(r.summary || "").slice(0, 250)).join("\n")}\n\nGörmek için: ${siteUrl()}`;
  S.announce = { ids: items.map((r) => r.id), mails };
  showModal(`<h2>Güncelleme duyurusu</h2>
    <p class="muted">${items.length} yeni değişiklik · ${mails.length} kayıtlı e-posta. Mesajı düzenleyebilirsiniz. E-posta kendi hesabınızdan, alıcılar gizli (BCC) olarak gider.</p>
    <textarea id="announceText" rows="10">${esc(text)}</textarea>
    <div class="actions wrap">
      <button type="button" class="btn primary" data-action="announceGmail">Gmail'de aç</button>
      <button type="button" class="btn" data-action="announceMailto">Mail uygulamasında aç</button>
      <button type="button" class="btn" data-action="announceCopyMails">Adresleri kopyala</button>
      <button type="button" class="btn" data-action="announceCopyMsg">Mesajı kopyala</button>
    </div>
    <div class="actions"><button type="button" class="btn" data-action="announceDone">Gönderildi olarak işaretle</button></div>`);
}
const announceMsg = () => document.getElementById("announceText")?.value || "";
async function copyText(t, ok) {
  try { await navigator.clipboard.writeText(t); } catch (_) { const a = document.createElement("textarea"); a.value = t; document.body.append(a); a.select(); document.execCommand("copy"); a.remove(); }
  toast(ok);
}

// ---------- kan grubu girişi ----------
function renderBlood(v) {
  const list = sortPeople(S.people.filter((p) => !S.bloodMissing || !p.blood_type));
  const count = new Map();
  S.people.forEach((p) => { if (p.blood_type) count.set(p.blood_type, (count.get(p.blood_type) || 0) + 1); });
  const known = [...count.values()].reduce((a, b) => a + b, 0);
  v.innerHTML = `<div class="toolbar"><button type="button" class="btn" data-action="tab" data-id="people">← Kişiler</button>
      <label class="check" style="margin:0"><input type="checkbox" id="bloodMissing" ${S.bloodMissing ? "checked" : ""}>Yalnız girilmemişler</label></div>
    <div class="panel wide"><h2>🩸 Kan grubu girişi</h2>
      <p class="muted">${known} / ${S.people.length} kişinin kan grubu girilmiş. ${isAdmin() ? "Değişiklikler hemen uygulanır." : "Yalnızca kendi kaydınızı değiştirebilirsiniz; değişiklik onaya gönderilir."}</p>
      <div class="chips">${BLOOD.map((b) => `<span class="chip">${b} · ${count.get(b) || 0}</span>`).join("")}</div></div>
    <div class="list bloodlist">${list.map((p) => `<div class="brow"><span>${esc(fullName(p))} <small class="muted">${esc(years(p))}</small></span>
      <select data-blood data-id="${p.id}" ${canEditPerson(p) ? "" : "disabled"}><option value="">—</option>${BLOOD.map((b) => `<option value="${b}" ${p.blood_type === b ? "selected" : ""}>${b}</option>`).join("")}</select></div>`).join("") || `<p class="muted center">Hepsi girilmiş.</p>`}</div>`;
}
async function changeBlood(el) {
  const p = byId(el.dataset.id);
  const nv = el.value || null;
  try {
    await saveChange({ kind: "update_person", person_id: p.id, payload: { blood_type: nv }, summary: `${fullName(p)}: Kan grubu: ${showVal("blood_type", p.blood_type)} → ${showVal("blood_type", nv)}` });
    toast(isAdmin() ? "Kaydedildi" : "Talep yöneticiye gönderildi");
    await loadAll();
  } catch (err) { toast("Hata: " + (err.message || err)); el.value = p.blood_type || ""; }
}

// ---------- üzerine gelince önizleme (fare olan cihazlarda) ----------
const photoCache = new Map();
async function previewPhoto(id) {
  const c = photoCache.get(id);
  if (c && Date.now() - c.t < 50 * 60 * 1000) return c.url;
  const list = await loadPhotos(id);
  const url = list.find((x) => x.url)?.url || "";
  photoCache.set(id, { url, t: Date.now() });
  return url;
}
let popEl = null, popTimer = null, popFor = null;
const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
function hidePop() {
  clearTimeout(popTimer);
  popFor = null;
  if (popEl) { popEl.remove(); popEl = null; }
}
function placePop(el) {
  if (!popEl) return;
  const r = el.getBoundingClientRect(), w = popEl.offsetWidth, h = popEl.offsetHeight;
  let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let top = r.bottom + 8;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
  popEl.style.left = left + "px";
  popEl.style.top = top + "px";
}
async function showPop(el) {
  const p = byId(el.dataset.id);
  if (!p) return;
  const wantPhoto = S.prefs.photo && S.photoSet.has(p.id);
  const age = S.prefs.age ? ageText(p) : "";
  const bits = previewBits(p);
  popEl?.remove();
  popEl = document.createElement("div");
  popEl.id = "pop";
  popEl.innerHTML = `${wantPhoto ? `<div class="pp-photo">…</div>` : ""}<b>${esc(fullName(p))}</b> <span class="muted">${esc(years(p))}</span>
    ${age ? `<div>${isDead(p) ? "" : "Şu an: "}${esc(age)}</div>` : ""}${bits.map((b) => `<div>${esc(b)}</div>`).join("")}`;
  document.body.append(popEl);
  placePop(el);
  if (wantPhoto) {
    const url = await previewPhoto(p.id).catch(() => "");
    if (popFor !== el || !popEl) return;
    const box = popEl.querySelector(".pp-photo");
    if (url) {
      const img = new Image();
      img.alt = "";
      img.onload = () => { if (popFor === el && box) { box.replaceChildren(img); placePop(el); } };
      img.src = url;
    } else box?.remove();
  }
}

// ---------- fotoğraf ----------
function visibilityFields(vis = "private", viewerIds = []) {
  const others = S.profiles.filter((x) => x.id !== S.user.id && x.approved);
  return `<fieldset><legend>Kimler görebilsin?</legend>
    <label class="radio"><input type="radio" name="visibility" value="private" ${vis === "private" ? "checked" : ""}>Sadece ben</label>
    <label class="radio"><input type="radio" name="visibility" value="all" ${vis === "all" ? "checked" : ""}>Tüm üyeler</label>
    <label class="radio"><input type="radio" name="visibility" value="custom" ${vis === "custom" ? "checked" : ""}>Seçtiğim kişiler</label>
    <div class="viewers" ${vis === "custom" ? "" : "hidden"}>
      ${others.map((o) => `<label class="check"><input type="checkbox" name="viewer" value="${o.id}" ${viewerIds.includes(o.id) ? "checked" : ""}>${esc(o.full_name || o.email)}</label>`).join("") || `<p class="muted">Henüz başka onaylı üye yok.</p>`}
    </div></fieldset>`;
}
const pickedViewers = (f) => [...f.querySelectorAll("input[name=viewer]:checked")].map((x) => x.value);

function photoUploadForm(personId) {
  showModal(`<h2>Fotoğraf ekle</h2>
    <form data-form="upload" data-person="${personId}">
      <label>Fotoğraf<input type="file" name="file" accept="image/*" required></label>
      <label>Açıklama<input name="caption" maxlength="200"></label>
      ${visibilityFields("private")}
      <div class="actions"><button type="button" class="btn" data-action="backToPerson" data-id="${personId}">Vazgeç</button><button class="btn primary">Yükle</button></div>
    </form>`);
}

function compress(file, max = 1600) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error("Resim işlenemedi"))), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bu resim biçimi desteklenmiyor")); };
    img.src = url;
  });
}

async function submitUpload(f) {
  const file = f.elements.file.files[0];
  if (!file) return;
  const btn = f.querySelector("button.primary");
  btn.disabled = true;
  btn.textContent = "Yükleniyor…";
  const personId = f.dataset.person;
  const vis = f.elements.visibility.value;
  let path;
  try {
    const blob = await compress(file);
    path = `${S.user.id}/${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    const ins = await sb.from("photos").insert({ person_id: personId, storage_path: path, caption: f.elements.caption.value.trim() || null, visibility: vis }).select().single();
    if (ins.error) throw ins.error;
    if (vis === "custom") {
      const ids = pickedViewers(f);
      if (ids.length) {
        const r = await sb.from("photo_viewers").insert(ids.map((u) => ({ photo_id: ins.data.id, user_id: u })));
        if (r.error) throw r.error;
      }
    }
    toast("Fotoğraf eklendi");
    openPerson(personId);
  } catch (err) {
    if (path) await sb.storage.from("photos").remove([path]);
    toast("Hata: " + (err.message || err));
    btn.disabled = false;
    btn.textContent = "Yükle";
  }
}

async function photoEditForm(photoId, personId) {
  const { data: ph, error } = await sb.from("photos").select("*").eq("id", photoId).single();
  if (error) return toast("Hata: " + error.message);
  const { data: vw } = await sb.from("photo_viewers").select("user_id").eq("photo_id", photoId);
  showModal(`<h2>Fotoğraf ayarları</h2>
    <form data-form="photoedit" data-id="${photoId}" data-person="${personId}">
      <label>Açıklama<input name="caption" maxlength="200" value="${esc(ph.caption)}"></label>
      ${visibilityFields(ph.visibility, (vw || []).map((x) => x.user_id))}
      <div class="actions"><button type="button" class="btn" data-action="backToPerson" data-id="${personId}">Vazgeç</button><button class="btn primary">Kaydet</button></div>
    </form>`);
}
async function submitPhotoEdit(f) {
  const id = f.dataset.id;
  const vis = f.elements.visibility.value;
  const u = await sb.from("photos").update({ caption: f.elements.caption.value.trim() || null, visibility: vis }).eq("id", id);
  if (u.error) return toast("Hata: " + u.error.message);
  const d = await sb.from("photo_viewers").delete().eq("photo_id", id);
  if (d.error) return toast("Hata: " + d.error.message);
  if (vis === "custom") {
    const ids = pickedViewers(f);
    if (ids.length) {
      const r = await sb.from("photo_viewers").insert(ids.map((x) => ({ photo_id: id, user_id: x })));
      if (r.error) return toast("Hata: " + r.error.message);
    }
  }
  toast("Kaydedildi");
  openPerson(f.dataset.person);
}
async function deletePhoto(id, personId) {
  if (!confirm("Fotoğraf silinsin mi?")) return;
  const { data: ph } = await sb.from("photos").select("storage_path").eq("id", id).single();
  const { error } = await sb.from("photos").delete().eq("id", id);
  if (error) return toast("Hata: " + error.message);
  if (ph) await sb.storage.from("photos").remove([ph.storage_path]);
  openPerson(personId);
}

// ---------- olaylar ----------
let deferredInstall = null;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (S.me && S.tab === "profile") renderView();
});
window.addEventListener("appinstalled", () => { deferredInstall = null; toast("Uygulama yüklendi"); });

const actions = {
  logout: async () => { await sb.auth.signOut(); },
  refresh: async () => { await loadAll(); render(); },
  switchAuth: (mode) => renderAuth(mode),
  tab: (t) => { S.tab = t; closeModal(); render(); },
  open: (id) => openPerson(id),
  backToPerson: (id) => openPerson(id),
  closeModal,
  toggleFull: () => {
    S.treeFull = !S.treeFull;
    const area = document.getElementById("treeArea");
    if (area) area.classList.toggle("full", S.treeFull);
    const b = document.querySelector('[data-action="toggleFull"]');
    if (b) b.textContent = S.treeFull ? "✕ Küçült" : "⛶ Tam ekran";
  },
  zoomIn: () => setZoom(S.zoom * 1.2),
  zoomOut: () => setZoom(S.zoom / 1.2),
  zoomReset: () => setZoom(1),
  zoomFit: fitZoom,
  genForm,
  genReset: () => { S.gen.colors = []; saveGen(); applyBands(); genForm(); },
  pickCity: (k) => { S.fCity = S.fCity === k ? "" : k; renderView(); },
  clearFilters: () => { S.q = ""; S.fCity = ""; S.fGender = ""; S.fStatus = ""; S.fBlood = ""; renderView(); },
  addSibling,
  addParent: (id, el) => addParent(id, el.dataset.role),
  addNote: (id) => noteForm(id),
  delNote: async (id, el) => {
    if (!confirm("Not silinsin mi?")) return;
    const { error } = await sb.from("person_notes").delete().eq("id", id);
    if (error) return toast("Hata: " + error.message);
    await loadAll();
    openPerson(el.dataset.person);
  },
  bloodScreen: () => { S.tab = "blood"; render(); },
  approveReq: async (id) => { if (await reviewReq(id, true)) { toast("Onaylandı"); await afterReview(); } },
  rejectReq: async (id) => {
    const note = prompt("Red nedeni (isteğe bağlı):");
    if (note === null) return;
    if (await reviewReq(id, false, note)) { toast("Reddedildi"); await afterReview(); }
  },
  approveAll: async () => {
    const pend = S.requests.filter((r) => r.status === "pending").slice().reverse();
    if (!confirm(`${pend.length} talebin hepsi onaylansın mı?`)) return;
    for (const r of pend) if (!(await reviewReq(r.id, true))) break;
    toast("Onaylandı");
    await afterReview();
  },
  withdrawReq: async (id) => {
    if (!confirm("Talep geri çekilsin mi?")) return;
    const { error } = await sb.from("change_requests").delete().eq("id", id);
    if (error) return toast("Hata: " + error.message);
    await loadAll();
    renderView();
  },
  announceForm,
  announceGmail: () => window.open(`https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(S.announce.mails.join(","))}&su=${encodeURIComponent("Soyağacı güncellendi")}&body=${encodeURIComponent(announceMsg())}`, "_blank", "noopener"),
  announceMailto: () => { location.href = `mailto:?bcc=${encodeURIComponent(S.announce.mails.join(","))}&subject=${encodeURIComponent("Soyağacı güncellendi")}&body=${encodeURIComponent(announceMsg())}`; },
  announceCopyMails: () => copyText(S.announce.mails.join(", "), "Adresler kopyalandı"),
  announceCopyMsg: () => copyText(announceMsg(), "Mesaj kopyalandı"),
  announceDone: async () => {
    const { error } = await sb.from("change_requests").update({ announced: true }).in("id", S.announce.ids);
    if (error) return toast("Hata: " + error.message);
    closeModal();
    toast("Duyuru gönderildi olarak işaretlendi");
    await afterReview();
  },
  saveInvite: (id, el) => saveInvite(id, el),
  inviteMsg: (id) => inviteMsg(id),
  copyInvite,
  install: async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    renderView();
  },
  goUp: () => { const r = byId(S.rootId); S.rootId = r.father_id || r.mother_id || S.rootId; renderView(); },
  addPerson: () => personForm(null),
  editPerson: (id) => personForm(byId(id)),
  deletePerson,
  addChild,
  addSpouse: (id) => spouseForm(id),
  newSpouse: (id) => personForm(null, { spouseOf: id }),
  delSpouse: async (id, el) => {
    if (!confirm("Eşlik kaydı kaldırılsın mı?")) return;
    const { error } = await sb.from("spouses").delete().eq("id", id);
    if (error) return toast("Hata: " + error.message);
    await loadAll();
    render();
    openPerson(el.dataset.person);
  },
  addPhoto: (id) => photoUploadForm(id),
  editPhoto: (id, el) => photoEditForm(id, el.dataset.person),
  delPhoto: (id, el) => deletePhoto(id, el.dataset.person),
};

document.addEventListener("click", async (e) => {
  if (e.target === modal) return closeModal();
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  hidePop();
  const fn = actions[el.dataset.action];
  if (fn) await fn(el.dataset.id, el);
});

const forms = { auth: submitAuth, person: submitPerson, spouse: submitSpouse, upload: submitUpload, photoedit: submitPhotoEdit, profile: submitProfile, note: submitNote };
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (!f.dataset?.form) return;
  e.preventDefault();
  await forms[f.dataset.form](f);
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "rootSel") { S.rootId = t.value; renderView(); }
  else if (t.id === "fCity") { S.fCity = t.value; refreshPeople(); }
  else if (t.id === "fGender") { S.fGender = t.value; refreshPeople(); }
  else if (t.id === "fStatus") { S.fStatus = t.value; refreshPeople(); }
  else if (t.id === "fBlood") { S.fBlood = t.value; refreshPeople(); }
  else if (t.id === "sortSel") { S.sort = t.value; refreshPeople(); }
  else if (t.id === "bloodMissing") { S.bloodMissing = t.checked; renderView(); }
  else if (t.dataset?.blood !== undefined) changeBlood(t);
  else if (t.dataset?.pref) { S.prefs[t.dataset.pref] = t.checked; savePrefs(); }
  else if (t.name === "is_deceased") { const b = t.closest("form")?.querySelector(".burialRow"); if (b) b.hidden = !t.checked; }
  else if (t.id === "genOn") { S.gen.on = t.checked; saveGen(); applyBands(); }
  else if (t.id === "iFilter") { S.iFilter = t.value; refreshInvites(); }
  else if (t.dataset?.memberPerson !== undefined) changeMemberPerson(t);
  else if (t.dataset?.member) changeMember(t);
  else if (t.name === "visibility") {
    const box = t.closest("form")?.querySelector(".viewers");
    if (box) box.hidden = t.value !== "custom";
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "q") {
    S.q = t.value;
    refreshPeople();
  } else if (t.id === "iq") {
    S.iq = t.value;
    refreshInvites();
  } else if (t.dataset?.genColor !== undefined) {
    S.gen.colors[Number(t.dataset.genColor)] = t.value;
    saveGen();
    applyBands();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (modal.classList.contains("open")) closeModal();
  else if (S.treeFull) actions.toggleFull();
});

// Üzerine gelince önizleme
document.addEventListener("mouseover", (e) => {
  if (!canHover) return;
  const el = e.target.closest?.('[data-action="open"][data-id]');
  if (!el) { if (popFor) hidePop(); return; }
  if (popFor === el || modal.classList.contains("open")) return;
  hidePop();
  popFor = el;
  popTimer = setTimeout(() => showPop(el), 250);
});
document.addEventListener("scroll", hidePop, true);

// Ctrl + fare tekerleği ile yakınlaştırma
document.addEventListener("wheel", (e) => {
  if (!e.ctrlKey || !e.target.closest?.(".tree-wrap")) return;
  e.preventDefault();
  setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

// Dokunmatik ekranda iki parmakla yakınlaştırma
let pinch = null;
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
document.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2 && e.target.closest?.(".tree-wrap")) pinch = { d: touchDist(e.touches), z: S.zoom };
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  setZoom(pinch.z * (touchDist(e.touches) / pinch.d));
}, { passive: false });
document.addEventListener("touchend", () => { pinch = null; });

// Fareyle sürükleyerek kaydırma
let pan = null, panMoved = false;
document.addEventListener("pointerdown", (e) => {
  const wrap = e.target.closest?.(".tree-wrap");
  if (!wrap || e.pointerType !== "mouse" || e.button !== 0) return;
  pan = { wrap, x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
  panMoved = false;
});
document.addEventListener("pointermove", (e) => {
  if (!pan) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) panMoved = true;
  if (panMoved) { pan.wrap.scrollLeft = pan.sl - dx; pan.wrap.scrollTop = pan.st - dy; }
});
document.addEventListener("pointerup", () => { pan = null; });
// sürükleme sonrası yanlışlıkla kişi kartı açılmasın
document.addEventListener("click", (e) => {
  if (panMoved) { e.stopPropagation(); e.preventDefault(); panMoved = false; }
}, true);

// Çevrimdışı kabuk ve "uygulama olarak yükle" için servis çalışanı
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
