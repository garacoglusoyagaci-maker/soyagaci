import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const app = document.getElementById("app");
const modal = document.getElementById("modal");
const toastEl = document.getElementById("toast");

const S = { user: null, me: null, people: [], spouses: [], profiles: [], tab: "tree", rootId: null, q: "", zoom: 1 };
const VIS = { all: "Tüm üyeler", private: "Sadece ben", custom: "Seçili kişiler" };

// ---------- yardımcılar ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => S.people.find((p) => p.id === id);
const fullName = (p) => (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "");
const yr = (d) => (d ? String(d).slice(0, 4) : "");
const years = (p) => {
  const b = yr(p.birth_date), d = yr(p.death_date);
  return b && d ? `${b} – ${d}` : b ? b : d ? `† ${d}` : "";
};
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
const canAdd = () => !!(S.me && S.me.approved && (S.me.is_admin || S.me.can_add));
const canEditPerson = (p) => !!(S.me && (S.me.is_admin || p.created_by === S.user.id || S.me.person_id === p.id));
const canDelSpouse = (r) => !!(S.me && (S.me.is_admin || r.created_by === S.user.id));

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
  const [pr, pe, sp] = await Promise.all([
    sb.from("profiles").select("*").order("full_name"),
    sb.from("people").select("*").order("birth_date", { ascending: true, nullsFirst: false }),
    sb.from("spouses").select("*"),
  ]);
  if (pr.error) toast("Veri yüklenemedi: " + pr.error.message);
  S.profiles = pr.data || [];
  S.people = pe.data || [];
  S.spouses = sp.data || [];
  S.me = S.profiles.find((p) => p.id === S.user.id) || null;
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
  const tabs = [["tree", "Ağaç"], ["people", "Kişiler"], ["profile", "Profilim"]];
  if (S.me.is_admin) {
    const waiting = S.profiles.filter((p) => !p.approved).length;
    tabs.push(["members", "Üyeler" + (waiting ? ` (${waiting})` : "")]);
  }
  app.innerHTML = `<header class="top">
      <div class="brand">🌳 Soyağacı</div>
      <nav>${tabs.map(([k, t]) => `<button type="button" class="${S.tab === k ? "on" : ""}" data-action="tab" data-id="${k}">${t}</button>`).join("")}</nav>
      <div class="user">${esc(S.me.full_name || S.me.email)} <button type="button" class="link" data-action="logout">Çıkış</button></div>
    </header><main id="view"></main>`;
  renderView();
}

function renderView() {
  const v = document.getElementById("view");
  if (S.tab === "tree") renderTree(v);
  else if (S.tab === "people") renderPeople(v);
  else if (S.tab === "profile") renderProfile(v);
  else if (S.tab === "members") renderMembers(v);
}

// ---------- ağaç ----------
function defaultRoot() {
  const roots = S.people.filter((p) => !p.father_id && !p.mother_id);
  return (roots.find((r) => childrenOf([r.id]).length) || roots[0] || S.people[0]).id;
}

function card(id) {
  const p = byId(id);
  if (!p) return "";
  return `<button type="button" class="pcard ${genderCls(p)}" data-action="open" data-id="${id}">
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

function nodeHtml(id, seen, isRoot = false) {
  if (seen.has(id)) return "";
  seen.add(id);
  const sp = spousesOf(id).filter((x) => !seen.has(x) && byId(x));
  sp.forEach((x) => seen.add(x));
  const kidMap = new Map();
  childrenOf([id, ...sp]).forEach((k) => { if (!seen.has(k.id)) kidMap.set(k.id, k); });
  const kids = [...kidMap.values()].sort((a, b) => String(a.birth_date || "9999").localeCompare(String(b.birth_date || "9999")));
  let h = `<li><div class="couple">${partner(id, isRoot)}${sp.map((s) => `<span class="amp">&amp;</span>${partner(s, true)}`).join("")}</div>`;
  if (kids.length) h += `<ul>${kids.map((k) => nodeHtml(k.id, seen)).join("")}</ul>`;
  return h + "</li>";
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
    <div class="zoombar">
      <button type="button" class="btn small" data-action="zoomOut" aria-label="Uzaklaştır">🔍−</button>
      <span id="zoomPct" class="muted"></span>
      <button type="button" class="btn small" data-action="zoomIn" aria-label="Yakınlaştır">🔍+</button>
      <button type="button" class="btn small" data-action="zoomFit">Tümünü sığdır</button>
      <button type="button" class="btn small" data-action="zoomReset">%100</button>
    </div>
    <div class="tree-wrap"><div class="tree"><ul>${nodeHtml(S.rootId, new Set(), true)}</ul></div></div>
    <p class="muted">Bir kişiye dokunarak ayrıntı ve fotoğraflarını açın. Küçültmek için 🔍− ya da "Tümünü sığdır"ı kullanın; Ctrl + fare tekerleği de yakınlaştırır, sürükleyerek kaydırabilirsiniz.</p>`;
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
function peopleListHtml() {
  const q = S.q.trim().toLocaleLowerCase("tr");
  const list = S.people.filter((p) => !q || fullName(p).toLocaleLowerCase("tr").includes(q));
  if (!list.length) return `<p class="muted center">Sonuç yok.</p>`;
  return list
    .slice()
    .sort((a, b) => fullName(a).localeCompare(fullName(b), "tr"))
    .map((p) => `<button type="button" data-action="open" data-id="${p.id}"><span>${esc(fullName(p))}</span><span class="muted">${esc(years(p))}</span></button>`)
    .join("");
}
function renderPeople(v) {
  v.innerHTML = `<div class="toolbar"><input id="q" type="search" placeholder="Ara…" value="${esc(S.q)}">
    ${canAdd() ? `<button type="button" class="btn primary" data-action="addPerson">+ Kişi</button>` : ""}</div>
    <div class="list" id="plist">${peopleListHtml()}</div>`;
}

// ---------- profilim ----------
function renderProfile(v) {
  const me = S.me;
  v.innerHTML = `<div class="panel"><h2>Profilim</h2>
    <form data-form="profile">
      <label>E-posta<input value="${esc(me.email)}" disabled></label>
      <label>Ad Soyad<input name="full_name" required value="${esc(me.full_name)}"></label>
      <label>Ağaçtaki kişim<select name="person_id"><option value="">— seçilmedi —</option>
        ${S.people.map((p) => `<option value="${p.id}" ${p.id === me.person_id ? "selected" : ""}>${esc(fullName(p))} ${esc(years(p))}</option>`).join("")}</select></label>
      <p class="muted">Yetkiniz: ${me.is_admin ? "Yönetici" : me.can_add ? "Kişi ekleyebilir" : "Görüntüleyici"}</p>
      <div class="actions"><button class="btn primary">Kaydet</button></div>
    </form></div>`;
}
async function submitProfile(f) {
  const { error } = await sb.from("profiles").update({ full_name: f.elements.full_name.value.trim(), person_id: f.elements.person_id.value || null }).eq("id", S.user.id);
  if (error) return toast("Hata: " + error.message);
  await loadAll();
  toast("Kaydedildi");
  render();
}

// ---------- üyeler (yönetici) ----------
function renderMembers(v) {
  v.innerHTML = `<div class="panel" style="max-width:640px"><h2>Üyeler</h2>
    <p class="muted">Yeni kayıt olanlar onaylanana kadar hiçbir şey göremez.</p>
    ${S.profiles.map((p) => {
      const self = p.id === S.user.id;
      return `<div class="member"><div><b>${esc(p.full_name || "")}</b> <span class="muted">${esc(p.email)}</span></div>
        <div class="opts">
          <label><input type="checkbox" data-member="approved" data-id="${p.id}" ${p.approved ? "checked" : ""} ${self ? "disabled" : ""}> Onaylı</label>
          <label><input type="checkbox" data-member="can_add" data-id="${p.id}" ${p.can_add || p.is_admin ? "checked" : ""} ${p.is_admin ? "disabled" : ""}> Kişi ekleyebilir</label>
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

// ---------- kişi ayrıntısı ----------
const personLink = (p) => (p ? `<a href="#" data-action="open" data-id="${p.id}">${esc(fullName(p))}</a>` : "");

async function openPerson(id) {
  const p = byId(id);
  if (!p) return;
  const father = byId(p.father_id), mother = byId(p.mother_id);
  const spRows = S.spouses.filter((s) => s.person_a === id || s.person_b === id);
  const kids = childrenOf([id]);
  showModal(`
    <div class="phead"><span class="av big">${esc((p.first_name || "?")[0])}</span>
      <div><h2>${esc(fullName(p))}</h2><div class="muted">${esc(years(p))}${p.birth_place ? ` · ${esc(p.birth_place)}` : ""}</div></div></div>
    ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ""}
    <dl class="rel">
      ${father || mother ? `<dt>Ebeveyn</dt><dd>${[father, mother].filter(Boolean).map(personLink).join(", ")}</dd>` : ""}
      ${spRows.length ? `<dt>Eş</dt><dd>${spRows.map((r) => personLink(byId(r.person_a === id ? r.person_b : r.person_a)) + (canDelSpouse(r) ? ` <button type="button" class="mini" data-action="delSpouse" data-id="${r.id}" data-person="${id}" title="Eşliği kaldır">×</button>` : "")).join("<br>")}</dd>` : ""}
      ${kids.length ? `<dt>Çocuklar</dt><dd>${kids.map(personLink).join(", ")}</dd>` : ""}
    </dl>
    <div class="actions wrap">
      ${canAdd() ? `<button type="button" class="btn" data-action="addChild" data-id="${id}">+ Çocuk</button><button type="button" class="btn" data-action="addSpouse" data-id="${id}">+ Eş</button>` : ""}
      ${canEditPerson(p) ? `<button type="button" class="btn" data-action="editPerson" data-id="${id}">Düzenle</button><button type="button" class="btn danger" data-action="deletePerson" data-id="${id}">Sil</button>` : ""}
    </div>
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

// ---------- kişi formu ----------
function personForm(p, preset = {}) {
  const v = p || preset;
  const others = S.people.filter((x) => !p || x.id !== p.id);
  const opt = (list, sel) => `<option value="">—</option>` + list.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(fullName(x))} ${esc(years(x))}</option>`).join("");
  showModal(`<h2>${p ? "Kişiyi düzenle" : "Yeni kişi"}</h2>
    <form data-form="person" data-id="${p?.id || ""}" data-spouse-of="${preset.spouseOf || ""}">
      <div class="row2"><label>Ad<input name="first_name" required value="${esc(v.first_name)}"></label>
        <label>Soyad<input name="last_name" value="${esc(v.last_name)}"></label></div>
      <div class="row2"><label>Cinsiyet<select name="gender"><option value="">—</option>
          <option value="E" ${v.gender === "E" ? "selected" : ""}>Erkek</option><option value="K" ${v.gender === "K" ? "selected" : ""}>Kadın</option></select></label>
        <label>Doğum yeri<input name="birth_place" value="${esc(v.birth_place)}"></label></div>
      <div class="row2"><label>Doğum tarihi<input type="date" name="birth_date" value="${esc(v.birth_date)}"></label>
        <label>Ölüm tarihi<input type="date" name="death_date" value="${esc(v.death_date)}"></label></div>
      <label>Baba<select name="father_id">${opt(others.filter((x) => x.gender !== "K"), v.father_id)}</select></label>
      <label>Anne<select name="mother_id">${opt(others.filter((x) => x.gender !== "E"), v.mother_id)}</select></label>
      <label>Notlar<textarea name="notes" rows="3">${esc(v.notes)}</textarea></label>
      <div class="actions"><button type="button" class="btn" data-action="closeModal">Vazgeç</button><button class="btn primary">Kaydet</button></div>
    </form>`);
}

async function submitPerson(f) {
  const e = f.elements;
  const val = (n) => (e[n].value.trim() === "" ? null : e[n].value.trim());
  const obj = {
    first_name: e.first_name.value.trim(), last_name: val("last_name"), gender: val("gender"),
    birth_place: val("birth_place"), birth_date: val("birth_date"), death_date: val("death_date"),
    father_id: val("father_id"), mother_id: val("mother_id"), notes: val("notes"),
  };
  const btn = f.querySelector("button.primary");
  btn.disabled = true;
  let id = f.dataset.id;
  if (id) {
    const { error } = await sb.from("people").update(obj).eq("id", id);
    if (error) { btn.disabled = false; return toast("Hata: " + error.message); }
  } else {
    const { data, error } = await sb.from("people").insert(obj).select().single();
    if (error) { btn.disabled = false; return toast("Hata: " + error.message); }
    id = data.id;
    if (f.dataset.spouseOf) {
      const r = await sb.from("spouses").insert({ person_a: f.dataset.spouseOf, person_b: id });
      if (r.error) toast("Kişi eklendi ama eşlik kaydedilemedi: " + r.error.message);
    }
  }
  await loadAll();
  render();
  toast("Kaydedildi");
  openPerson(id);
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
  const sp = spousesOf(id).map(byId).filter(Boolean);
  const preset = {};
  if (p.gender === "K") { preset.mother_id = id; preset.father_id = sp.find((x) => x.gender !== "K")?.id; }
  else { preset.father_id = id; preset.mother_id = sp.find((x) => x.gender !== "E")?.id; }
  preset.last_name = (p.gender === "K" ? sp[0] : p)?.last_name || "";
  personForm(null, preset);
}

// ---------- eş ----------
function spouseForm(id) {
  const p = byId(id);
  const cur = new Set(spousesOf(id));
  const list = S.people.filter((x) => x.id !== id && !cur.has(x.id));
  showModal(`<h2>${esc(fullName(p))} için eş ekle</h2>
    <form data-form="spouse" data-id="${id}">
      <label>Mevcut kişilerden seç<select name="other" required><option value="">—</option>
        ${list.map((x) => `<option value="${x.id}">${esc(fullName(x))} ${esc(years(x))}</option>`).join("")}</select></label>
      <label>Evlilik tarihi<input type="date" name="marriage_date"></label>
      <div class="actions"><button type="button" class="btn" data-action="newSpouse" data-id="${id}">Yeni kişi olarak ekle</button><button class="btn primary">Ekle</button></div>
    </form>`);
}
async function submitSpouse(f) {
  const { error } = await sb.from("spouses").insert({ person_a: f.dataset.id, person_b: f.elements.other.value, marriage_date: f.elements.marriage_date.value || null });
  if (error) return toast("Hata: " + error.message);
  await loadAll();
  render();
  openPerson(f.dataset.id);
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
const actions = {
  logout: async () => { await sb.auth.signOut(); },
  refresh: async () => { await loadAll(); render(); },
  switchAuth: (mode) => renderAuth(mode),
  tab: (t) => { S.tab = t; closeModal(); render(); },
  open: (id) => openPerson(id),
  backToPerson: (id) => openPerson(id),
  closeModal,
  zoomIn: () => setZoom(S.zoom * 1.2),
  zoomOut: () => setZoom(S.zoom / 1.2),
  zoomReset: () => setZoom(1),
  zoomFit: fitZoom,
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
  const fn = actions[el.dataset.action];
  if (fn) await fn(el.dataset.id, el);
});

const forms = { auth: submitAuth, person: submitPerson, spouse: submitSpouse, upload: submitUpload, photoedit: submitPhotoEdit, profile: submitProfile };
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (!f.dataset?.form) return;
  e.preventDefault();
  await forms[f.dataset.form](f);
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "rootSel") { S.rootId = t.value; renderView(); }
  else if (t.dataset?.member) changeMember(t);
  else if (t.name === "visibility") {
    const box = t.closest("form")?.querySelector(".viewers");
    if (box) box.hidden = t.value !== "custom";
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "q") {
    S.q = e.target.value;
    document.getElementById("plist").innerHTML = peopleListHtml();
  }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// Ctrl + fare tekerleği ile yakınlaştırma
document.addEventListener("wheel", (e) => {
  if (!e.ctrlKey || !e.target.closest?.(".tree-wrap")) return;
  e.preventDefault();
  setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

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
