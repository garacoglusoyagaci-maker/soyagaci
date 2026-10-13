import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as CFG from "./config.js";
const SUPABASE_URL = CFG.SUPABASE_URL, SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY;
const VAPID_PUBLIC_KEY = CFG.VAPID_PUBLIC_KEY || ""; // bildirimler için (isteğe bağlı, README'ye bakın)

const app = document.getElementById("app");
const modal = document.getElementById("modal");
const toastEl = document.getElementById("toast");

const S = { user: null, me: null, people: [], spouses: [], profiles: [], tab: "tree", rootId: null, q: "", zoom: 1, fCity: "", fGender: "", fStatus: "", gen: { on: true, colors: [] }, maxGen: 0, invites: [], iq: "", iFilter: "", treeFull: false, requests: [], notes: [], photoSet: new Set(), fBlood: "", sort: "alpha", bloodMissing: false, fitPending: true, attached: new Map(), view: "all", focus: null, viewInit: false, depthMax: Infinity, recipients: [], blog: [], dlog: [], backupBusy: false, prefs: loadPrefs() };
const startTab = () => (S.prefs.start === "list" ? "people" : "tree");
S.tab = startTab();
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
// Kardeş sırası: en büyükten en küçüğe (doğum tarihi yoksa kayıt sırasına göre, tarihliler önde)
const kidCmp = (a, b) => (!a.birth_date - !b.birth_date) || String(a.birth_date || "").localeCompare(String(b.birth_date || "")) || String(a.created_at).localeCompare(String(b.created_at)) || fullName(a).localeCompare(fullName(b), "tr");
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
  const d = { photo: true, age: true, city: true, burial: true, blood: true, start: "tree", dropSort: "age_old", treeStart: "auto", up: 3, down: 3, sibs: false };
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
// Silme kuralı: yalnızca kaydı ekleyen siler (sahibi olmayan kayıtlar için yönetici). İlk 5 dakika hemen, sonra yönetici onayıyla.
const FIVE_MIN = 5 * 60 * 1000;
const isMine = (uid) => !!uid && !!S.user && uid === S.user.id;
const ownerOk = (uid) => isMine(uid) || (!uid && isAdmin());
const isPending = (x) => !!x && x.approval === "pending";
const graceLeft = (row) => FIVE_MIN - (Date.now() - new Date(row.created_at).getTime());
const instantNow = (row) => isPending(row) || graceLeft(row) > 0;
const canDeletePerson = (p) => ownerOk(p.created_by);
const canDelSpouse = (s) => ownerOk(s.created_by);
const instantAdd = () => !isAdmin() && isFull(); // tam yetkili üye: eklediği kayıt hemen kendi ekranında görünür
const dbOld = (e) => (/add_person_pending|add_spouse_pending|request_delete|withdraw_request|edit_pending_person|admin_export|schema cache/.test(e?.message || "") ? new Error("Veritabanı güncel değil. Supabase > SQL Editor'de guncelleme2.sql dosyasını çalıştırın.") : e);
// Yönetici onayına düşen işlemi yöneticinin telefonuna bildir (Edge Function; kurulmamışsa sessizce geçilir)
function notifyAdmin(body) { if (isAdmin()) return; try { Promise.resolve(sb.functions.invoke("notify-admin", { body })).catch(() => {}); } catch (_) { /* yok sayılır */ } }
const canAddParent = (p, role) => !(role === "father" ? p.father_id || p._hfather_id : p.mother_id || p._hmother_id) && inLine(p.id);

// Aile tarafı görünürlüğü (kişinin ebeveyn tarafı diğer üyelere ne kadar görünsün)
const SIDE = { all: "Herkes görsün (varsayılan)", parents: "Yalnızca anne ve babası görünsün, diğerleri gizli", none: "Hiçbiri görünmesin (tüm ebeveyn tarafı gizli)" };
const hiddenLabel = (p) => (p.hidden_for ? "🔒 Gizli: yalnızca siz ve " + (fullName(byId(p.hidden_for)) || "eşiniz") + " görür" : "");
function sideSection(p, hasSpouse) {
  if (!isAdmin() || !("side_mode" in p) || !hasSpouse) return "";
  const linked = linkedOf(p.id);
  const who = linked ? `siz ve ${esc(linked.full_name || linked.email)}` : `yalnızca siz (${esc(fullName(p))} kişisinin hesabını <b>Davetler</b> sekmesinden bağlarsanız o da görür)`;
  return `<h3>Aile tarafı görünürlüğü</h3>
    <p class="muted small">${esc(fullName(p))} kişisinin ebeveyn tarafı (anne-baba, kardeşler, dede-nine, amca-hala, kuzenler ve eşleri) diğer üyelere nasıl görünsün? Gizlenenleri ${who} görür. Çocukları ve eşi her zaman görünür. Sonradan eklenen yakınlar da otomatik uyar.</p>
    <select data-side="${p.id}">${Object.entries(SIDE).map(([k, v]) => `<option value="${k}" ${(p.side_mode || "all") === k ? "selected" : ""}>${v}</option>`).join("")}</select>`;
}
async function changeSide(el) {
  const id = el.dataset.side;
  el.disabled = true;
  const { error } = await sb.rpc("set_side_privacy", { sid: id, mode: el.value });
  if (error) {
    el.disabled = false;
    return toast(/set_side_privacy|schema cache/.test(error.message || "") ? "Veritabanı güncel değil. Supabase > SQL Editor'de gizlilik.sql dosyasını çalıştırın." : "Hata: " + error.message);
  }
  await loadAll();
  render();
  toast("Kaydedildi");
  openPerson(id);
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}
function showModal(html, cls = "") {
  modal.innerHTML = `<div class="sheet ${cls}"><button type="button" class="x" data-action="closeModal" aria-label="Kapat">×</button>${html}</div>`;
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
    Object.assign(S, { user: null, me: null, people: [], spouses: [], profiles: [], tab: startTab(), rootId: null, view: "all", focus: null, viewInit: false });
    stopWatch();
    closeModal();
    renderAuth("login");
    return;
  }
  S.user = session.user;
  await loadAll();
  initView();
  if (S.me?.is_admin && /approvals/.test(location.hash)) S.tab = "approvals"; // bildirime dokunulunca gelinen yer
  render();
  startWatch();
}

// Giriş görünümü: üyeler kendi soyuyla, yönetici tüm ağaçla açılır (ayarlardan değiştirilebilir)
function initView() {
  if (S.viewInit || !S.me) return;
  S.viewInit = true;
  const myP = S.me.person_id && byId(S.me.person_id) ? S.me.person_id : null;
  const m = S.prefs.treeStart;
  const mine = m === "mine" || (m !== "all" && !S.me.is_admin);
  if (mine && myP) { S.view = "lineage"; S.focus = myP; } else S.view = "all";
  S.fitPending = true;
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
  // Onay bekleyen "baba/anne ekle" kayıtları: bağ, kaydı gören (ekleyen ve yönetici) kişiye hemen yansır
  S.people.forEach((x) => {
    if (!isPending(x)) return;
    [["pend_father_of", "father_id"], ["pend_mother_of", "mother_id"]].forEach(([pk, fk]) => { const t = x[pk] && byId(x[pk]); if (t && !t[fk]) t[fk] = x.id; });
  });
  // Gizli tarafa giden ebeveyn bağları bu kullanıcıya kapalıdır: kişi ağaçta kayıp görünmesin diye bağı boş sayarız
  const seenIds = new Set(S.people.map((x) => x.id));
  S.people.forEach((x) => ["father_id", "mother_id"].forEach((k) => { if (x[k] && !seenIds.has(x[k])) { x["_h" + k] = true; x[k] = null; } }));
  S.spouses = sp.data || [];
  S.me = S.profiles.find((p) => p.id === S.user.id) || null;
  S.invites = [];
  if (S.me?.is_admin) {
    const iv = await sb.from("invites").select("*");
    if (iv.error) toast("Davetler yüklenemedi (guncelleme.sql çalıştırıldı mı?): " + iv.error.message);
    else S.invites = iv.data || [];
    const [rc, bl, dl] = await Promise.all([
      sb.from("backup_recipients").select("*").order("created_at"),
      sb.from("backup_log").select("*").order("created_at", { ascending: false }).limit(15),
      sb.from("deletion_log").select("id,kind,label,deleted_by,mode,created_at").order("created_at", { ascending: false }).limit(20),
    ]);
    S.recipients = rc.data || [];
    S.blog = bl.data || [];
    S.dlog = dl.data || [];
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
    else try { Promise.resolve(sb.functions.invoke("notify-admin", { body: { type: "signup" } })).catch(() => {}); } catch (_) { /* yok sayılır */ }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = "E-posta veya şifre hatalı."; btn.disabled = false; }
  }
}

// ---------- ana ekran ----------
function navHtml() {
  const tabs = [["tree", "🌳", "Ağaç"], ["people", "👥", "Kişiler"], ["profile", "👤", "Profilim"]];
  if (S.me.is_admin) {
    const waiting = S.profiles.filter((p) => !p.approved).length;
    const pend = S.requests.filter((r) => r.status === "pending").length;
    tabs.push(["approvals", "✅", "Onaylar" + (pend ? ` (${pend})` : "")]);
    tabs.push(["invites", "✉️", "Davetler"]);
    tabs.push(["members", "⚙️", "Üyeler" + (waiting ? ` (${waiting})` : "")]);
    tabs.push(["backup", "💾", "Yedek"]);
  }
  return tabs.map(([k, ic, t]) => `<button type="button" class="${S.tab === k ? "on" : ""}" data-action="tab" data-id="${k}"><span class="ic">${ic}</span><span class="tl">${t}</span></button>`).join("");
}
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
  app.innerHTML = `<header class="top">
      <div class="brand">🌳 Soyağacı</div>
      <nav>${navHtml()}</nav>
      <div class="user">${esc(S.me.full_name || S.me.email)} <button type="button" class="link" data-action="logout">Çıkış</button></div>
    </header><main id="view"></main>`;
  renderView();
}

function renderView() {
  const v = document.getElementById("view");
  v.classList.toggle("wide", S.tab === "tree"); // ağaç sekmesi tüm genişliği kullanır
  if (S.tab === "tree") renderTree(v);
  else if (S.tab === "people") renderPeople(v);
  else if (S.tab === "profile") { renderProfile(v); if (S.me.is_admin) updatePushBox(); }
  else if (S.tab === "members") renderMembers(v);
  else if (S.tab === "invites") renderInvites(v);
  else if (S.tab === "approvals") renderApprovals(v);
  else if (S.tab === "blood") renderBlood(v);
  else if (S.tab === "backup") renderBackup(v);
}

// ---------- ağaç ----------
function defaultRoot() {
  const roots = S.people.filter((p) => !p.father_id && !p.mother_id);
  return (roots.find((r) => childrenOf([r.id]).length) || roots[0] || S.people[0]).id;
}

function card(id) {
  const p = byId(id);
  if (!p) return "";
  return `<button type="button" class="pcard ${genderCls(p)}${isDead(p) ? " dead" : ""}${isPending(p) ? " pend" : ""}" data-action="open" data-id="${id}">${isPending(p) ? `<span class="pk" title="Yönetici onayı bekliyor: şu an yalnızca siz ve yönetici görüyorsunuz">⏳</span>` : ""}
    ${isDead(p) ? `<span class="dm" title="Vefat etti. Allah rahmet eylesin">&#9770;&#xFE0E;</span>` : ""}${S.photoSet.has(id) ? `<span class="cm" title="Fotoğraf var">📷</span>` : ""}${p.hidden_for ? `<span class="lk" title="${esc(hiddenLabel(p))}">🔒</span>` : ""}
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

// Eş grupları: bir kişinin tüm eşleri (eşinin diğer eşleri de dahil) aynı satırda gösterilir.
// Her grubun bir "ev sahibi" kişisi vardır; satır onun dalında bulunur. Üst kaydı olanlar tercih edilir (erkek öncelikli).
// Gruptaki diğerleri kendi ailelerinin altında "↗" bağlantı kartı olarak görünür, böylece hiçbir çocuk kaybolmaz.
function buildAttached() {
  const att = new Map(); // kişi -> ev sahibi
  const done = new Set();
  const hasPar = (x) => !!(x.father_id || x.mother_id);
  S.people.forEach((p) => {
    if (done.has(p.id) || !spousesOf(p.id).length) return;
    const comp = [p.id];
    for (let i = 0; i < comp.length; i++) spousesOf(comp[i]).forEach((x) => { if (!comp.includes(x)) comp.push(x); });
    comp.forEach((x) => done.add(x));
    const members = comp.map(byId).filter(Boolean);
    const withPar = members.filter(hasPar);
    const pool = withPar.length ? withPar : members;
    pool.sort((a, b) => ((b.gender === "E") - (a.gender === "E")) || kidCmp(a, b));
    members.forEach((m) => { if (m.id !== pool[0].id) att.set(m.id, pool[0].id); });
  });
  return att;
}
function spouseGroup(id) {
  const group = [id];
  for (let i = 0; i < group.length; i++) spousesOf(group[i]).forEach((x) => { if (!group.includes(x) && byId(x)) group.push(x); });
  return group.slice(1);
}
function refNode(k, depth) {
  return `<li><div class="couple" data-gen="${depth}"><div class="partner"><button type="button" class="pcard ref ${genderCls(k)}" data-action="open" data-id="${k.id}" title="Eşiyle birlikte başka yerde gösteriliyor">
    <span class="av">${esc((k.first_name || "?")[0])}</span><span class="nm">${esc(fullName(k))}</span><small>↗ eşiyle birlikte başka yerde</small></button></div></div></li>`;
}

function nodeHtml(id, seen, isRoot = false, depth = 0, side = null) {
  if (seen.has(id)) return "";
  seen.add(id);
  if (depth > S.maxGen) S.maxGen = depth;
  const sp = spouseGroup(id).filter((x) => !seen.has(x));
  sp.forEach((x) => seen.add(x));
  const kidMap = new Map();
  childrenOf([id, ...sp]).forEach((k) => kidMap.set(k.id, k));
  const kids = [...kidMap.values()].sort(kidCmp);
  let h = `<li>${side ? `<div class="focusline">${side.left}` : ""}<div class="couple" data-gen="${depth}">${partner(id, isRoot)}${sp.map((x) => `<span class="amp" title="Eşler" aria-label="Eş">♥</span>${partner(x, true)}`).join("")}</div>${side ? `${side.right}</div>` : ""}`;
  if (kids.length && depth >= S.depthMax) {
    h += `<div class="more"><button type="button" class="btn small" data-action="focusOn" data-id="${id}">⤵ ${kids.length} alt kişi…</button></div>`;
  } else if (kids.length) {
    h += `<ul>${kids.map((k) => (seen.has(k.id) || S.attached.has(k.id) ? refNode(k, depth + 1) : nodeHtml(k.id, seen, false, depth + 1))).join("")}</ul>`;
  }
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
  tree.querySelectorAll(".couple[data-gen], .ancrow[data-gen]").forEach((c) => {
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

// Tüm kişiler: üst kaydı olmayan her kişiden başlayan ağaçlar yan yana
function forestHtml() {
  const seen = new Set();
  const roots = S.people.filter((p) => !p.father_id && !p.mother_id && !S.attached.has(p.id))
    .sort((x, y) => (!childrenOf([x.id]).length - !childrenOf([y.id]).length) || ((y.gender === "E") - (x.gender === "E")) || kidCmp(x, y));
  S.maxGen = 0;
  const parts = roots.map((r) => nodeHtml(r.id, seen, true)).filter(Boolean);
  S.people.forEach((p) => { if (!seen.has(p.id)) parts.push(nodeHtml(p.id, seen, true)); });
  return `<div class="forest">${parts.filter(Boolean).map((h) => `<ul>${h}</ul>`).join("")}</div>`;
}

const ancLabel = (lvl) => (lvl === 0 ? "Anne ve baba" : lvl === 1 ? "Dede ve nine" : lvl === 2 ? "Büyük dede ve nine" : `${lvl + 1}. kuşak üst atalar`);
function ancestorRows(fid, up, sibs) {
  const rows = [];
  const placed = new Set([fid]);
  const walk = (pid, lvl) => {
    if (lvl >= up) return;
    const q = byId(pid);
    if (!q) return;
    [byId(q.father_id), byId(q.mother_id)].forEach((par) => {
      if (!par || placed.has(par.id)) return;
      placed.add(par.id);
      (rows[lvl] = rows[lvl] || []).push(par);
      walk(par.id, lvl + 1);
    });
  };
  walk(fid, 0);
  const last = rows[up - 1];
  const truncated = !!(last && rows.length === up && last.some((a) => a.father_id || a.mother_id));
  const extra = new Set(); // kardeş / amca / hala olarak eklenenler
  if (sibs) {
    rows.forEach((row, i) => {
      rows[i] = row.flatMap((a) => [a, ...siblingsOf(a).filter((x) => !placed.has(x.id) && placed.add(x.id) && extra.add(x.id))]);
    });
  }
  return { rows, truncated, extra };
}
// Bir satırdaki kişileri evli çiftler halinde grupla (eşler yan yana, aralarında ♥). Çiftler kan bağı sırasını korur.
function coupleUnits(list, extra, used) {
  const inList = new Set(list.map((x) => x.id));
  const placed = new Set();
  const units = [];
  list.forEach((x) => {
    if (placed.has(x.id)) return;
    placed.add(x.id);
    const u = [x];
    spousesOf(x.id).forEach((sid) => {
      const o = byId(sid);
      if (!o || placed.has(sid)) return;
      if (inList.has(sid) || (extra.has(x.id) && !used.has(sid))) { placed.add(sid); used.add(sid); u.push(o); }
    });
    if (u.length === 2 && u[0].gender !== "E" && u[1].gender === "E") u.reverse();
    units.push(u);
  });
  return units;
}
const unitHtml = (u) => (u.length === 1 ? partner(u[0].id, false) : `<div class="couple">${u.map((x, i) => (i ? `<span class="amp" title="Eşler" aria-label="Eş">♥</span>` : "") + partner(x.id, false)).join("")}</div>`);
const ghostCards = (n) => Array.from({ length: Math.max(0, n) }, () => `<span class="pcard ghost" aria-hidden="true"></span>`).join("");

function lineageHtml() {
  const fid = S.focus;
  const { rows, truncated, extra } = ancestorRows(fid, S.prefs.up, S.prefs.sibs);
  const n = rows.length;
  S.depthMax = n + S.prefs.down;
  const used = new Set([fid, ...spousesOf(fid)]);
  rows.forEach((r) => r.forEach((x) => used.add(x.id)));
  let h = truncated ? `<div class="ancmore"><button type="button" class="btn small" data-action="moreUp">↑ Daha üst nesiller var</button></div>` : "";
  rows.slice().reverse().forEach((row, i) => {
    const units = coupleUnits(row, extra, used);
    h += `<div class="ancwrap"><div class="anclabel">${ancLabel(n - 1 - i)}</div><div class="ancrow" data-gen="${i}">${units.map(unitHtml).join("")}</div></div>`;
  });
  if (n) h += `<div class="ancarrow">↓</div>`;
  // Kardeşler, seçilen kişiyle aynı satırda: büyükler solda, küçükler sağda (kişi hep ortada kalsın diye karşı tarafa görünmez boşluk eklenir)
  let side = null;
  if (S.prefs.sibs) {
    const sibs = siblingsOf(byId(fid));
    if (sibs.length) {
      const order = [...sibs, byId(fid)].sort(kidCmp);
      const at = order.findIndex((x) => x.id === fid);
      const sibIds = new Set(sibs.map((x) => x.id));
      sibs.forEach((x) => used.add(x.id));
      const mk = (list) => coupleUnits(list, sibIds, used);
      const L = mk(order.slice(0, at)), R = mk(order.slice(at + 1));
      const cnt = (us) => us.reduce((a, u) => a + u.length, 0);
      side = {
        left: `<div class="sibgrp">${ghostCards(cnt(R) - cnt(L))}${L.map(unitHtml).join("")}</div>`,
        right: `<div class="sibgrp">${R.map(unitHtml).join("")}${ghostCards(cnt(L) - cnt(R))}</div>`,
      };
    }
  }
  S.maxGen = n;
  return h + `<ul>${nodeHtml(fid, new Set(), true, n, side)}</ul>`;
}

function renderTree(v) {
  if (!S.people.length) {
    v.innerHTML = `<div class="empty"><p>Henüz kimse eklenmemiş.</p>${canAdd() ? `<button type="button" class="btn primary" data-action="addPerson">İlk kişiyi ekle</button>` : `<p class="muted">Kişi ekleme yetkisi için yöneticiye başvurun.</p>`}</div>`;
    return;
  }
  S.depthMax = Infinity;
  const myP = S.me?.person_id && byId(S.me.person_id) ? S.me.person_id : null;
  const lin = S.view === "lineage";
  if (lin && (!S.focus || !byId(S.focus))) S.focus = myP || defaultRoot();
  if (!S.rootId || (S.rootId !== "all" && !byId(S.rootId))) S.rootId = "all";
  S.attached = !lin && S.rootId === "all" ? buildAttached() : new Map();
  const all = S.rootId === "all";
  const root = all ? null : byId(S.rootId);
  const up = !lin && root && (root.father_id || root.mother_id);
  const personOpts = (sel) => sortPeople(S.people, S.prefs.dropSort).map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(fullName(p))} ${esc(years(p))}</option>`).join("");
  const optN = (cur) => [1, 2, 3, 4, 5, 6, 99].map((n) => `<option value="${n}" ${Number(cur) === n ? "selected" : ""}>${n === 99 ? "Hepsi" : n}</option>`).join("");
  const mid = lin
    ? `<select id="rootSel" aria-label="Soyu gösterilecek kişi">${personOpts(S.focus)}</select>
      <label class="inl">Yukarı <select data-lin="up">${optN(S.prefs.up)}</select> nesil</label>
      <label class="inl">Aşağı <select data-lin="down">${optN(S.prefs.down)}</select> nesil</label>
      <label class="inl"><input type="checkbox" data-lin="sibs" ${S.prefs.sibs ? "checked" : ""}> Kardeş, amca/hala/dayı/teyze</label>
      ${myP && S.focus !== myP ? `<button type="button" class="btn" data-action="focusOn" data-id="${myP}">🙋 Bana dön</button>` : ""}`
    : `<select id="rootSel" aria-label="Başlangıç kişisi"><option value="all" ${all ? "selected" : ""}>Tüm kişiler (tam ağaç)</option>${personOpts(S.rootId)}</select>
      ${up ? `<button type="button" class="btn" data-action="goUp">↑ Üst nesil</button>` : ""}`;
  v.innerHTML = `<div class="toolbar">
      <div class="seg"><button type="button" class="${lin ? "" : "on"}" data-action="setView" data-id="all">🌳 Tüm ağaç</button><button type="button" class="${lin ? "on" : ""}" data-action="setView" data-id="lineage">🧬 ${myP ? "Benim soyum" : "Soy görünümü"}</button></div>
      ${mid}
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
    <div class="tree-wrap"><div class="tree">${lin ? lineageHtml() : all ? forestHtml() : `<ul>${(S.maxGen = 0, nodeHtml(S.rootId, new Set(), true))}</ul>`}</div></div>
    </div>
    <p class="muted hint">Bir kişiye dokunarak ayrıntı ve fotoğraflarını açın (pencerede "🧬 Soyunu göster" ile o kişinin atalarını ve altsoyunu görürsünüz). Küçültmek için 🔍− ya da "Tümünü sığdır"ı kullanın; Ctrl + fare tekerleği de yakınlaştırır, sürükleyerek kaydırabilirsiniz.</p>`;
  applyBands();
  if (S.fitPending) { S.fitPending = false; fitZoom(); }
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
  const naturalH = tree.offsetHeight;
  setZoom(Math.min(1, (wrap.clientWidth - 4) / natural, (wrap.clientHeight - 4) / naturalH));
  wrap.scrollLeft = 0;
  wrap.scrollTop = 0;
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
    childrenOf([id, ...sp]).sort(kidCmp).forEach((k) => visit(k.id));
  };
  if (S.people.length) visit(defaultRoot());
  S.people.filter((p) => !p.father_id && !p.mother_id).forEach((p) => visit(p.id));
  S.people.forEach((p) => visit(p.id));
  return rank;
}
function sortPeople(list, key = S.sort) {
  const bd = (p) => String(p.birth_date || "");
  const cmpBirth = (dir) => (a, b) => (!bd(a) - !bd(b)) || dir * bd(a).localeCompare(bd(b)) || fullName(a).localeCompare(fullName(b), "tr");
  const fns = {
    alpha: (a, b) => fullName(a).localeCompare(fullName(b), "tr"),
    age_old: cmpBirth(1),
    age_young: cmpBirth(-1),
    created_old: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
    created_new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
  };
  if (key === "family") { const r = familyRank(); return list.slice().sort((a, b) => r.get(a.id) - r.get(b.id)); }
  return list.slice().sort(fns[key] || fns.alpha);
}
function peopleListHtml(list) {
  if (!list.length) return `<p class="muted center">Sonuç yok.</p>`;
  return sortPeople(list)
    .map((p) => { const bits = previewBits(p); return `<button type="button" data-action="open" data-id="${p.id}"><span>${isPending(p) ? "⏳ " : ""}${S.photoSet.has(p.id) ? "📷 " : ""}${p.hidden_for ? "🔒 " : ""}${esc(fullName(p))}${bits.length ? `<small class="city">${esc(bits.join(" · "))}</small>` : ""}</span><span class="muted">${esc(years(p))}</span></button>`; })
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
      <p class="muted">Yetkiniz: ${me.is_admin ? "Yönetici (değişiklikler doğrudan uygulanır)" : me.can_add ? "Tam yetki: eklediğiniz kişiler hemen sizde görünür, diğer üyeler yönetici onayından sonra görür; diğer değişiklikler yönetici onayına düşer" : me.person_id ? "Kendi kaydını düzenleyebilir, kendi alt/üst soyuna ekleme önerebilir, bilgi notu paylaşabilir (yönetici onayına düşer)" : "Görüntüleme, bilgi notu ve fotoğraf ekleme"}</p>
      <div class="actions"><button class="btn primary">Kaydet</button></div>
    </form></div>
    <div class="panel" style="margin-top:1rem"><h2>Önizleme ayarları</h2>
      <p class="muted">Kişinin üzerine gelince açılan önizlemede ve listede hangi bilgiler görünsün? (Bu cihazda saklanır.)</p>
      ${Object.entries(PREF_LABELS).map(([k, t]) => `<label class="check"><input type="checkbox" data-pref="${k}" ${S.prefs[k] ? "checked" : ""}>${t}</label>`).join("")}
      <label>Açılış ekranı<select data-pref-sel="start"><option value="tree" ${S.prefs.start !== "list" ? "selected" : ""}>Ağaç (tüm kişiler, sığdırılmış)</option><option value="list" ${S.prefs.start === "list" ? "selected" : ""}>Kişi listesi</option></select></label>
      <label>Ağaç sekmesi açılışı<select data-pref-sel="treeStart"><option value="auto" ${S.prefs.treeStart === "auto" ? "selected" : ""}>Otomatik (üyeler kendi soyuyla, yönetici tüm ağaçla)</option><option value="mine" ${S.prefs.treeStart === "mine" ? "selected" : ""}>Her zaman benim soyum</option><option value="all" ${S.prefs.treeStart === "all" ? "selected" : ""}>Her zaman tüm ağaç</option></select></label>
      <label>Ağaçtaki kişi seçme listesinin sırası<select data-pref-sel="dropSort">${Object.entries(SORTS).map(([k, t]) => `<option value="${k}" ${S.prefs.dropSort === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    </div>
    ${me.is_admin ? `<div class="panel" style="margin-top:1rem"><h2>🔔 Yönetici bildirimleri</h2><div id="pushBox" class="muted">Kontrol ediliyor…</div></div>` : `<div class="panel" style="margin-top:1rem"><h2>Taleplerim</h2>${myRequestsHtml()}</div>`}
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
          <option value="1" ${i?.can_add ? "selected" : ""}>Tam yetki (ekledikleri hemen kendinde görünür, onayla herkese)</option></select>
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
    ...spRows.map((r) => { const o = byId(r.person_a === id ? r.person_b : r.person_a); return o ? row("Eş", o, (isPending(r) ? " ⏳" : "") + (canDelSpouse(r) ? ` <button type="button" class="mini" data-action="delSpouse" data-id="${r.id}" data-person="${id}" title="Eşliği kaldır (ilk 5 dakika hemen, sonra yönetici onayıyla)">×</button>` : "")) : ""; }),
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
    ${isPending(p) ? `<p class="pending">⏳ ${isMine(p.created_by) ? "Bu kişiyi siz eklediniz: yönetici onaylayana kadar yalnızca siz ve yönetici görüyorsunuz." : `Ekleyen: ${esc(profName(p.created_by) || "bir üye")}. Henüz yayınlanmadı; <b>Onaylar</b> sekmesinden onaylayabilirsiniz.`}</p>` : ""}
    ${p.hidden_for ? `<p class="hiddenbar">${esc(hiddenLabel(p))}</p>` : ""}
    ${info.length ? `<table class="infotable">${info.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
    ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ""}
    <h3>Aile</h3>
    ${rels ? `<table class="reltable"><tr class="hd"><th>Yakınlık</th><th>Kişi</th><th>Bilgi</th></tr>${rels}</table>` : `<p class="muted">Henüz bağlı yakını yok.</p>`}
    <div class="actions wrap">
      ${line ? `<button type="button" class="btn" data-action="addChild" data-id="${id}">+ Çocuk</button><button type="button" class="btn" data-action="addSibling" data-id="${id}">+ Kardeş</button><button type="button" class="btn" data-action="addSpouse" data-id="${id}">+ Eş</button>` : ""}
      <button type="button" class="btn" data-action="focusOn" data-id="${id}">🧬 Soyunu göster</button>
      ${canEditPerson(p) ? `<button type="button" class="btn" data-action="editPerson" data-id="${id}">Düzenle</button>` : ""}
      ${canDeletePerson(p) ? `<button type="button" class="btn danger" data-action="deletePerson" data-id="${id}" title="Ekledikten sonraki ilk 5 dakika içinde hemen silinir; sonrasında yönetici onayı gerekir">${instantNow(p) ? "Sil" : "Silme talebi"}</button>` : ""}
    </div>
    ${isAdmin() ? "" : `<p class="muted small">${instantAdd() ? "Eklediğiniz kişiler hemen sizin ekranınızda görünür; diğer üyeler yönetici onayından sonra görür. Diğer değişiklikler yönetici onayından sonra uygulanır." : "Yaptığınız değişiklikler yönetici onayından sonra listeye eklenir."} Başkasının eklediği kaydı silemezsiniz, ama bilgi notu ekleyebilirsiniz.</p>`}
    ${sideSection(p, spRows.length || impliedSp.length)}
    <h3>Bilgi notları <button type="button" class="btn small" data-action="addNote" data-id="${id}">+ Not</button></h3>
    ${notes.length ? notes.map((n) => `<div class="note"><div class="muted">${esc(n.author_name || profName(n.author_id) || "")} · ${fmtDT(n.created_at)}${ownerOk(n.author_id) ? ` <button type="button" class="mini" data-action="delNote" data-id="${n.id}" data-person="${id}" title="Notu sil (ilk 5 dakika hemen, sonra yönetici onayıyla)">×</button>` : ""}</div>${esc(n.body)}</div>`).join("") : `<p class="muted">Henüz not yok.</p>`}
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
            ${ph.uploaded_by === S.user.id ? `<button type="button" class="btn small danger" data-action="delPhoto" data-id="${ph.id}" data-person="${id}">Sil</button>` : ""}
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
async function saveInstant(req) {
  const r = req.kind === "add_person"
    ? await sb.rpc("add_person_pending", { p: req.payload, summary: req.summary })
    : await sb.rpc("add_spouse_pending", { a: req.payload.person_a, b: req.payload.person_b, mdate: req.payload.marriage_date || null, summary: req.summary });
  if (r.error) throw dbOld(r.error);
  notifyAdmin({ type: "request", id: r.data.request_id });
  return { pending: true, instant: true, id: r.data.person_id || null };
}
async function saveChange(req) {
  if (instantAdd() && (req.kind === "add_person" || req.kind === "add_spouse")) return saveInstant(req);
  const ins = await sb.from("change_requests").insert({
    kind: req.kind, person_id: req.person_id || null, payload: req.payload, summary: req.summary,
    requester_name: S.me.full_name || S.me.email,
  }).select().single();
  if (ins.error) {
    if (/change_requests|schema cache/.test(ins.error.message || "")) throw new Error("Veritabanı güncel değil. Supabase > SQL Editor'de guncelleme.sql dosyasını çalıştırın.");
    throw ins.error;
  }
  if (!isAdmin()) { notifyAdmin({ type: "request", id: ins.data.id }); return { pending: true }; }
  const r = await sb.rpc("review_change", { req_id: ins.data.id, approve: true, note: null });
  if (r.error) throw r.error;
  return { pending: false, id: r.data };
}
async function finishChange(res, personId) {
  await loadAll();
  render();
  if (res.instant) {
    toast("Eklendi. Şu an yalnızca siz görüyorsunuz; yönetici onaylayınca herkes görür.");
    const id = res.id || personId;
    if (id && byId(id)) openPerson(id); else closeModal();
  } else if (res.pending) {
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
  const ownPending = !!p && isPending(p) && isMine(p.created_by);
  const lockParent = (k) => !isAdmin() && !ownPending && p && (p[k] || p["_h" + k]); // yönetici dışı mevcut ebeveyn bağını değiştiremez/silemez
  const opt = (list, sel) => `<option value="">—</option>` + list.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(fullName(x))} ${esc(years(x))}</option>`).join("");
  const dead = !!(v.is_deceased || v.death_date);
  showModal(`<h2>${p ? "Kişiyi düzenle" : "Yeni kişi"}</h2>
    ${isAdmin() ? "" : !p && instantAdd() ? `<p class="muted small">Eklediğiniz kişi hemen sizin ekranınızda görünür; diğer üyeler yönetici onayından sonra görür.</p>` : ownPending ? `<p class="muted small">Bu kişi henüz yayınlanmadığı için değişiklikleriniz hemen uygulanır.</p>` : `<p class="muted small">Kaydettiğinizde değişiklik yönetici onayına gönderilir.</p>`}
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
      <label class="full">Notlar<textarea name="notes" rows="2">${esc(v.notes)}</textarea></label>
      <div class="actions"><button type="button" class="btn" data-action="closeModal">Vazgeç</button><button class="btn primary">${isAdmin() || ownPending || (!p && instantAdd()) ? (p ? "Kaydet" : "Ekle") : "Onaya gönder"}</button></div>
    </form>`, "wide");
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
      const ownPending = isPending(old) && isMine(old.created_by);
      if (!isAdmin() && !ownPending) { if (old.father_id) delete payload.father_id; if (old.mother_id) delete payload.mother_id; }
      if (!Object.keys(payload).length) { btn.disabled = false; return toast("Değişiklik yok."); }
      const summary = `${fullName(old)}: ` + Object.entries(payload).map(([k, v]) => `${FIELD_LABELS[k]}: ${showVal(k, old[k])} → ${showVal(k, v)}`).join("; ");
      if (ownPending) {
        const r = await sb.rpc("edit_pending_person", { pid: id, patch: payload, new_summary: null });
        if (r.error) throw dbOld(r.error);
        return await finishChange({ pending: false, id }, id);
      }
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

// Silme: RPC kuralları uygular (yalnızca ekleyen; 5 dk içinde hemen, sonra yönetici onayı; toplu silme yok)
async function removeStorage(paths) {
  if (paths && paths.length) { try { await sb.storage.from("photos").remove(paths); } catch (_) { /* yok sayılır */ } }
}
async function requestDelete(kind, id) {
  const r = await sb.rpc("request_delete", { kind, tid: id });
  if (r.error) { toast("Hata: " + dbOld(r.error).message); return null; }
  const d = r.data || {};
  if (d.status === "deleted") { await removeStorage(d.storage_paths); toast("Silindi"); }
  else { toast("Silme talebi yöneticiye gönderildi." + (d.reason ? ` (${d.reason})` : "")); notifyAdmin({ type: "request", id: d.request_id }); }
  await loadAll();
  render();
  return d;
}
const delAsk = (what, row) => `${what} silinsin mi?\n\n` + (instantNow(row) ? "Hemen silinir." : "Eklenmesinden 5 dakikadan fazla geçtiği için bu bir silme TALEBİ olarak yönetici onayına gönderilir.");
async function deletePerson(id) {
  const p = byId(id);
  if (!p || !confirm(delAsk(fullName(p), p))) return;
  const d = await requestDelete("person", id);
  if (!d) return;
  if (d.status === "deleted") { closeModal(); if (S.rootId === id) S.rootId = null; render(); }
  else openPerson(id);
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
      <div class="actions"><button type="button" class="btn" data-action="newSpouse" data-id="${id}">Yeni kişi olarak ekle</button><button class="btn primary">${isAdmin() || instantAdd() ? "Ekle" : "Onaya gönder"}</button></div>
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
const KIND = { update_person: "Düzenleme", add_person: "Yeni kişi", add_spouse: "Eş ekleme", add_note: "Bilgi notu", delete_person: "🗑 Kişi silme talebi", delete_spouse: "🗑 Eşlik silme talebi", delete_note: "🗑 Not silme talebi", delete_photo: "🗑 Fotoğraf silme talebi" };
const STATUS = { pending: "⏳ Onay bekliyor", approved: "✅ Onaylandı", rejected: "❌ Reddedildi" };

function reqRow(r, admin) {
  return `<div class="req ${r.status}${String(r.kind).startsWith("delete_") ? " del" : ""}"><div class="req-top"><b>${esc(KIND[r.kind] || r.kind)}</b><span class="muted">${esc(r.requester_name || profName(r.requested_by))} · ${fmtDT(r.created_at)}</span></div>
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
      <p class="muted">Üyelerin önerdiği değişiklikler burada toplanır. Tam yetkili üyelerin eklediği kişiler kendi ekranlarında zaten görünür; onayladığınızda herkese açılır. Silme talepleri yalnızca tek tek onaylanır; toplu silme yoktur. Yeni onaylanan değişiklikleri üyelere duyurmak için duyuru hazırlayın.</p>
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
// Onaylanan silme taleplerinde fotoğraf dosyalarını depodan kaldır
async function cleanupStorage(ids) {
  const paths = [];
  ids.forEach((id) => { const r = S.requests.find((x) => x.id === id); if (r?.payload?.storage_paths?.length) paths.push(...r.payload.storage_paths); });
  await removeStorage(paths);
}

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
  const { data: ph } = await sb.from("photos").select("created_at").eq("id", id).single();
  if (!ph || !confirm(delAsk("Fotoğraf", ph))) return;
  if (await requestDelete("photo", id)) openPerson(personId);
}

// ---------- yedekleme (yönetici) ----------
const today = () => todayStr();
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const utf8 = (t) => new TextEncoder().encode(t);
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportData(withMembers) {
  const r = await sb.rpc("admin_export", { include_members: withMembers });
  if (r.error) throw dbOld(r.error);
  return r.data;
}
const csvCell = (v) => { const t = String(v ?? ""); return /[",;\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
function peopleCsv(d) {
  const by = new Map(d.people.map((x) => [x.id, x]));
  const nm = (id) => { const x = by.get(id); return x ? [x.first_name, x.last_name].filter(Boolean).join(" ") : ""; };
  const sp = new Map();
  d.spouses.forEach((s) => { (sp.get(s.person_a) || sp.set(s.person_a, []).get(s.person_a)).push(nm(s.person_b)); (sp.get(s.person_b) || sp.set(s.person_b, []).get(s.person_b)).push(nm(s.person_a)); });
  const head = ["Ad", "Soyad", "Cinsiyet", "Doğum tarihi", "Ölüm tarihi", "Doğum yeri", "Şehir", "Kan grubu", "Vefat", "Defin yeri", "Baba", "Anne", "Eş(ler)", "Notlar", "Durum"];
  const rows = d.people.map((x) => [x.first_name, x.last_name, x.gender === "E" ? "Erkek" : x.gender === "K" ? "Kadın" : "", x.birth_date, x.death_date, x.birth_place, x.city, x.blood_type,
    x.is_deceased || x.death_date ? "evet" : "", x.burial_place, nm(x.father_id), nm(x.mother_id), (sp.get(x.id) || []).join(" & "), x.notes, x.approval === "pending" ? "onay bekliyor" : "yayında"]);
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}
async function logBackup(kind, status, detail, recipients) {
  await sb.from("backup_log").insert({ kind, status, detail: String(detail || "").slice(0, 300), recipients: recipients ?? null }).then(() => {}, () => {});
}
async function backupDownload(kind) {
  try {
    toast("Hazırlanıyor…");
    const d = await exportData(true);
    if (kind === "json") download(`soyagaci-kisiler-${today()}.json`, JSON.stringify(d, null, 2), "application/json");
    else download(`soyagaci-kisiler-${today()}.csv`, peopleCsv(d), "text/csv;charset=utf-8");
    await logBackup("indirme", "ok", `${kind.toUpperCase()} · ${d.people.length} kişi`);
    toast(`${d.people.length} kişi yedeklendi`);
    await loadAll(); renderView();
  } catch (err) { toast("Hata: " + (err.message || err)); }
}

// Basit ZIP (sıkıştırmasız) oluşturucu: dış kütüphane gerekmez
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files) {
  const now = new Date();
  const dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks = [], central = [];
  let off = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  files.forEach((f) => {
    const name = utf8(f.name), crc = crc32(f.data), size = f.data.length;
    const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    chunks.push(head, name, f.data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
    off += head.length + name.length + size;
  });
  const csize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)]);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}
const SOFT_FILES = ["index.html", "app.js", "style.css", "config.js", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png",
  "schema.sql", "guncelleme.sql", "gizlilik.sql", "guncelleme2.sql", "README.md", "supabase/functions/send-backup/index.ts", "supabase/functions/notify-admin/index.ts"];
// Sitenin çalışan dosyalarını (şu an yayında olan sürüm) toplar
async function softwareZip() {
  const files = [], missing = [];
  for (const f of SOFT_FILES) {
    try {
      const r = await fetch(new URL(f, siteUrl()).href, { cache: "no-store" });
      if (r.ok) files.push({ name: f, data: new Uint8Array(await r.arrayBuffer()) });
      else missing.push(f);
    } catch (_) { missing.push(f); }
  }
  if (!files.length) throw new Error("Yazılım dosyaları okunamadı");
  files.push({ name: "YEDEK-BILGISI.txt", data: utf8(`Soyağacı yazılım yedeği\nTarih: ${new Date().toLocaleString("tr-TR")}\nAdres: ${siteUrl()}\n\nİçerdiği dosyalar:\n${files.map((x) => " - " + x.name).join("\n")}\n\nSitede yayınlanmadığı için eklenemeyenler (depodaki özgün dosyalardan alın):\n${missing.map((x) => " - " + x).join("\n") || " (yok)"}\n`) });
  return { blob: makeZip(files), count: files.length - 1, missing };
}
async function backupSoftwareDownload() {
  try {
    toast("Hazırlanıyor…");
    const z = await softwareZip();
    download(`soyagaci-yazilim-${today()}.zip`, z.blob, "application/zip");
    await logBackup("indirme", "ok", `Yazılım ZIP · ${z.count} dosya${z.missing.length ? `, ${z.missing.length} dosya sitede yok` : ""}`);
    toast(`${z.count} dosya yedeklendi` + (z.missing.length ? ` (${z.missing.length} dosya sitede yayınlı değil)` : ""));
    await loadAll(); renderView();
  } catch (err) { toast("Hata: " + (err.message || err)); }
}
async function fnMessage(error) {
  try { const j = await error.context.json(); return j.error || j.message || error.message; } catch (_) { return error.message || String(error); }
}
async function backupSend(test) {
  if (S.backupBusy) return;
  const incData = document.getElementById("bkData")?.checked, incSoft = document.getElementById("bkSoft")?.checked;
  if (!S.recipients.length) return toast("Önce en az bir alıcı e-postası ekleyin.");
  if (!test && !incData && !incSoft) return toast("Gönderilecek içeriği seçin (kişi verisi / yazılım).");
  if (!test && !confirm(`${S.recipients.length} alıcıya e-posta gönderilsin mi?\n\nKişi yedeği; gizli aile taraflarını ve onay bekleyen kayıtları da içerir.`)) return;
  S.backupBusy = true;
  const btns = [...document.querySelectorAll("[data-action=backupSend],[data-action=backupTest]")];
  btns.forEach((b) => { b.disabled = true; });
  try {
    toast(test ? "Test e-postası gönderiliyor…" : "Yedek hazırlanıp gönderiliyor…");
    const attachments = [];
    if (!test && incData) {
      const d = await exportData(false);
      attachments.push({ filename: `soyagaci-kisiler-${today()}.json`, content_type: "application/json", content_b64: b64(utf8(JSON.stringify(d, null, 2))) });
      attachments.push({ filename: `soyagaci-kisiler-${today()}.csv`, content_type: "text/csv", content_b64: b64(utf8(peopleCsv(d))) });
    }
    if (!test && incSoft) {
      const z = await softwareZip();
      attachments.push({ filename: `soyagaci-yazilim-${today()}.zip`, content_type: "application/zip", content_b64: b64(new Uint8Array(await z.blob.arrayBuffer())) });
    }
    const { data, error } = await sb.functions.invoke("send-backup", { body: { test, attachments, site: siteUrl() } });
    if (error) throw new Error(await fnMessage(error));
    toast(test ? `Test e-postası gönderildi (${data?.sent ?? "?"} alıcı)` : `Yedek ${data?.sent ?? ""} alıcıya gönderildi`);
  } catch (err) {
    const msg = String(err.message || err);
    toast(/Failed to fetch|not found|404|FunctionsFetchError|Relay/i.test(msg) ? "E-posta fonksiyonu kurulu değil (README > Yedekleme). Yedeği indirip elle gönderebilirsiniz." : "Hata: " + msg);
  } finally {
    S.backupBusy = false;
    btns.forEach((b) => { b.disabled = false; });
    await loadAll(); if (S.tab === "backup") renderView();
  }
}
async function addRecipient() {
  const em = document.getElementById("rcEmail"), lb = document.getElementById("rcLabel");
  const email = em.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Geçerli bir e-posta adresi yazın.");
  const { error } = await sb.from("backup_recipients").insert({ email, label: lb.value.trim() || null });
  if (error) return toast(error.code === "23505" ? "Bu adres zaten listede." : /backup_recipients|schema cache/.test(error.message) ? "Veritabanı güncel değil. guncelleme2.sql dosyasını çalıştırın." : "Hata: " + error.message);
  await loadAll();
  renderView();
}
function renderBackup(v) {
  const last = S.blog.find((x) => x.status === "ok");
  v.innerHTML = `<div class="panel wide"><h2>💾 Yedekleme</h2>
      <p class="muted">Kişi verisi (kişiler, eşlikler, notlar, bekleyen kayıtlar, silme günlüğü) ve yazılım dosyaları ayrı ayrı yedeklenir. Fotoğraf dosyaları yedeğe girmez (Supabase > Storage'dan alınır). ${last ? `Son yedek: <b>${fmtDT(last.created_at)}</b> (${esc(last.kind)}).` : "Henüz yedek alınmadı."}</p></div>
    <div class="panel wide"><h3>1. Kişi verisi</h3>
      <p class="muted small">JSON tam yedektir (geri yüklemeye uygun). CSV, Excel'de açılır. Üye e-postaları ve davetler yalnızca indirilen dosyada bulunur.</p>
      <div class="actions wrap"><button type="button" class="btn primary" data-action="backupJson">JSON indir</button><button type="button" class="btn" data-action="backupCsv">Excel için CSV indir</button></div></div>
    <div class="panel wide"><h3>2. Yazılım</h3>
      <p class="muted small">Sitede yayında olan uygulama dosyalarını (html, js, css, ayarlar, SQL ve e-posta/bildirim fonksiyonları) ZIP yapar.</p>
      <div class="actions wrap"><button type="button" class="btn primary" data-action="backupZip">Yazılım ZIP indir</button></div></div>
    <div class="panel wide"><h3>3. E-posta ile gönder</h3>
      <p class="muted small">Yedek, aşağıda tanımladığınız kişilere e-posta eki olarak gider (alıcılar birbirini görmez). Gönderen: kurulumda tanımlanan hesap. Yedekte gizli aile tarafları da bulunur; alıcıları buna göre seçin.</p>
      <div class="reqlist">${S.recipients.map((r) => `<div class="req"><div class="req-top"><span><b>${esc(r.label || r.email)}</b> ${r.label ? `<span class="muted">${esc(r.email)}</span>` : ""}</span><button type="button" class="mini" data-action="delRecipient" data-id="${r.id}" title="Listeden çıkar">×</button></div></div>`).join("") || `<p class="muted">Henüz alıcı yok.</p>`}</div>
      <div class="row2"><label>E-posta<input id="rcEmail" type="email" inputmode="email" placeholder="ornek@gmail.com"></label><label>Ad (isteğe bağlı)<input id="rcLabel" placeholder="Örn. Abim"></label></div>
      <div class="actions wrap"><button type="button" class="btn" data-action="addRecipient">+ Alıcı ekle</button></div>
      <label class="check"><input type="checkbox" id="bkData" checked>Kişi verisi (JSON + CSV)</label>
      <label class="check"><input type="checkbox" id="bkSoft" checked>Yazılım (ZIP)</label>
      <div class="actions wrap"><button type="button" class="btn primary" data-action="backupSend">Seçili alıcılara gönder</button><button type="button" class="btn" data-action="backupTest">Test e-postası gönder</button></div></div>
    ${S.blog.length ? `<div class="panel wide"><h3>Son yedekler</h3><div class="reqlist">${S.blog.map((b) => `<div class="req ${b.status === "ok" ? "approved" : "rejected"}"><div class="req-top"><b>${b.status === "ok" ? "✅" : "❌"} ${esc(b.kind)}</b><span class="muted">${fmtDT(b.created_at)}</span></div><div class="muted small">${esc(b.detail || "")}${b.recipients ? ` · ${b.recipients} alıcı` : ""}</div></div>`).join("")}</div></div>` : ""}
    ${S.dlog.length ? `<div class="panel wide"><h3>Silme günlüğü</h3><p class="muted small">Silinen her kaydın tam yedeği veritabanında (deletion_log) saklanır. Son silmeler:</p><div class="reqlist">${S.dlog.map((d) => `<div class="req"><div class="req-top"><b>🗑 ${esc(d.label || d.kind)}</b><span class="muted">${fmtDT(d.created_at)}</span></div><div class="muted small">${esc(d.kind)} · ${d.mode === "approved" ? "yönetici onayıyla" : "ekleyen sildi (ilk 5 dk)"} · ${esc(profName(d.deleted_by) || "")}</div></div>`).join("")}</div></div>` : ""}`;
}

// ---------- yönetici bildirimleri (mobil/masaüstü push + uygulama açıkken anlık) ----------
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const urlB64ToU8 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
async function currentSub() { try { return await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch (_) { return null; } }
async function updatePushBox() {
  const box = document.getElementById("pushBox");
  if (!box) return;
  let h;
  if (!VAPID_PUBLIC_KEY) h = `Bildirim anahtarı (VAPID) <b>config.js</b> dosyasına eklenmemiş. Kurulum için README'deki "Yönetici bildirimleri" bölümüne bakın.`;
  else if (!pushSupported()) h = `Bu tarayıcı bildirimi desteklemiyor. <b>iPhone'da</b> önce siteyi Safari'de açıp Paylaş &gt; "Ana Ekrana Ekle" ile uygulamayı yükleyin (iOS 16.4 ve üstü), sonra uygulamayı buradan açın.`;
  else if (Notification.permission === "denied") h = `Bildirim izni engellenmiş. Tarayıcı/telefon ayarlarından bu site için bildirimlere izin verin, sonra sayfayı yenileyin.`;
  else if (await currentSub()) h = `<p>✅ Bu cihazda bildirimler açık. Onayınıza düşen her işlem telefonunuza bildirim olarak gelir.</p><div class="actions wrap"><button type="button" class="btn" data-action="pushTest">Test bildirimi gönder</button><button type="button" class="btn" data-action="pushOff">Bu cihazda kapat</button></div>`;
  else h = `<p>Yeni bir kişi/değişiklik/silme talebi ya da yeni üye onayınıza düştüğünde telefonunuza bildirim gelsin.</p><div class="actions wrap"><button type="button" class="btn primary" data-action="pushOn">Bildirimleri aç</button></div>`;
  box.classList.remove("muted");
  box.innerHTML = h;
}
async function pushOn() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Bildirim izni verilmedi."); return updatePushBox(); }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(VAPID_PUBLIC_KEY) }));
    const j = sub.toJSON();
    const { error } = await sb.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
    if (error) throw dbOld(error);
    toast("Bildirimler açıldı");
  } catch (err) { toast("Hata: " + (err.message || err)); }
  updatePushBox();
}
async function pushOff() {
  try {
    const sub = await currentSub();
    if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); await sb.from("push_subscriptions").delete().eq("endpoint", ep); }
    toast("Bu cihazda bildirimler kapatıldı");
  } catch (err) { toast("Hata: " + (err.message || err)); }
  updatePushBox();
}
async function pushTest() {
  const { error } = await sb.functions.invoke("notify-admin", { body: { type: "test" } });
  toast(error ? "Bildirim fonksiyonu kurulu değil ya da hata verdi (README > Yönetici bildirimleri)." : "Test bildirimi gönderildi, birkaç saniye içinde gelmeli.");
}
function setBadge() {
  if (!S.me?.is_admin || !navigator.setAppBadge) return;
  const n = S.requests.filter((r) => r.status === "pending").length + S.profiles.filter((p) => !p.approved).length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
function updateNav() { const n = document.querySelector(".top nav"); if (n && S.me) n.innerHTML = navHtml(); }
async function softRefresh() {
  if (!S.me?.is_admin) return;
  await loadAll();
  updateNav();
  setBadge();
  if (!modal.classList.contains("open") && (S.tab === "approvals" || S.tab === "members")) renderView();
}
let watchCh = null;
function stopWatch() { if (watchCh) { try { sb.removeChannel(watchCh); } catch (_) { /* yok sayılır */ } watchCh = null; } }
function startWatch() {
  setBadge();
  if (!S.me?.is_admin || watchCh) return;
  watchCh = sb.channel("admin-watch")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "change_requests" }, (e) => {
      if (e.new?.requested_by === S.user?.id) return;
      toast("🔔 Onayınıza yeni işlem düştü: " + String(e.new?.summary || "").slice(0, 80));
      softRefresh();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, () => { toast("🔔 Yeni üye onay bekliyor"); softRefresh(); })
    .subscribe();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") softRefresh(); });
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.go === "approvals" && S.me?.is_admin) { S.tab = "approvals"; closeModal(); softRefresh().then(render); }
  });
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
    const row = S.notes.find((x) => x.id === id);
    if (!row || !confirm(delAsk("Not", row))) return;
    if (await requestDelete("note", id)) openPerson(el.dataset.person);
  },
  setView: (mode) => {
    S.view = mode === "lineage" ? "lineage" : "all";
    if (S.view === "lineage" && (!S.focus || !byId(S.focus))) S.focus = S.me?.person_id && byId(S.me.person_id) ? S.me.person_id : defaultRoot();
    S.fitPending = true;
    renderView();
  },
  focusOn: (id) => { S.view = "lineage"; S.focus = id; S.fitPending = true; S.tab = "tree"; closeModal(); render(); },
  moreUp: () => { S.prefs.up = Math.min(99, Number(S.prefs.up) + 1); savePrefs(); S.fitPending = true; renderView(); },
  bloodScreen: () => { S.tab = "blood"; render(); },
  approveReq: async (id) => {
    if (String(S.requests.find((r) => r.id === id)?.kind).startsWith("delete_") && !confirm("Bu silme talebi onaylanırsa kayıt silinir (yedeği silme günlüğünde saklanır). Onaylıyor musunuz?")) return;
    if (await reviewReq(id, true)) { toast("Onaylandı"); await afterReview(); await cleanupStorage([id]); }
  },
  rejectReq: async (id) => {
    const note = prompt("Red nedeni (isteğe bağlı):");
    if (note === null) return;
    if (await reviewReq(id, false, note)) { toast("Reddedildi"); await afterReview(); }
  },
  approveAll: async () => {
    const pend = S.requests.filter((r) => r.status === "pending").slice().reverse();
    if (!confirm(`${pend.length} talebin hepsi onaylansın mı?`)) return;
    const done = [];
    for (const r of pend) { if (String(r.kind).startsWith("delete_")) continue; if (!(await reviewReq(r.id, true))) break; done.push(r.id); }
    toast(pend.some((r) => String(r.kind).startsWith("delete_")) ? "Silme talepleri hariç onaylandı (silmeler tek tek onaylanır)" : "Onaylandı");
    await afterReview();
    await cleanupStorage(done);
  },
  withdrawReq: async (id) => {
    if (!confirm("Talep geri çekilsin mi?")) return;
    const { error } = await sb.rpc("withdraw_request", { req_id: id });
    if (error) return toast("Hata: " + dbOld(error).message);
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
  goUp: () => { const r = byId(S.rootId); if (!r) return; S.rootId = r.father_id || r.mother_id || S.rootId; renderView(); },
  addPerson: () => personForm(null),
  editPerson: (id) => personForm(byId(id)),
  deletePerson,
  addChild,
  addSpouse: (id) => spouseForm(id),
  newSpouse: (id) => personForm(null, { spouseOf: id }),
  delSpouse: async (id, el) => {
    const row = S.spouses.find((x) => x.id === id);
    if (!row || !confirm(delAsk("Eşlik kaydı", row))) return;
    if (await requestDelete("spouse", id)) openPerson(el.dataset.person);
  },
  backupJson: () => backupDownload("json"),
  backupCsv: () => backupDownload("csv"),
  backupZip: backupSoftwareDownload,
  backupSend: () => backupSend(false),
  backupTest: () => backupSend(true),
  addRecipient: addRecipient,
  delRecipient: async (id) => {
    if (!confirm("Bu alıcı listeden çıkarılsın mı?")) return;
    const { error } = await sb.from("backup_recipients").delete().eq("id", id);
    if (error) return toast("Hata: " + error.message);
    await loadAll();
    renderView();
  },
  pushOn, pushOff, pushTest,
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
  if (t.id === "rootSel") {
    if (S.view === "lineage") { S.focus = t.value; S.fitPending = true; }
    else { S.rootId = t.value; if (t.value === "all") S.fitPending = true; }
    renderView();
  }
  else if (t.dataset?.lin) { S.prefs[t.dataset.lin] = t.type === "checkbox" ? t.checked : Number(t.value); savePrefs(); S.fitPending = true; renderView(); }
  else if (t.id === "fCity") { S.fCity = t.value; refreshPeople(); }
  else if (t.id === "fGender") { S.fGender = t.value; refreshPeople(); }
  else if (t.id === "fStatus") { S.fStatus = t.value; refreshPeople(); }
  else if (t.id === "fBlood") { S.fBlood = t.value; refreshPeople(); }
  else if (t.id === "sortSel") { S.sort = t.value; refreshPeople(); }
  else if (t.id === "bloodMissing") { S.bloodMissing = t.checked; renderView(); }
  else if (t.dataset?.blood !== undefined) changeBlood(t);
  else if (t.dataset?.side) changeSide(t);
  else if (t.dataset?.prefSel) { S.prefs[t.dataset.prefSel] = t.value; savePrefs(); toast("Kaydedildi"); }
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
