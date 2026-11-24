// Replica, version 0.3 : interface, images IA (Worker Cloudflare), animation locale et éditeur de montage.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const store = {
  get(k, d) { try { const v = localStorage.getItem("replica." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("replica." + k, JSON.stringify(v)); } catch { toast("Stockage local indisponible ou plein."); } },
};

const RATIOS = { "9:16": { ar: "9/16", r: 0.5625, px: [720, 1280] }, "16:9": { ar: "16/9", r: 1.7778, px: [1280, 720] }, "1:1": { ar: "1/1", r: 1, px: [720, 720] } }; // px = taille d’export
const DAILY = 5; // images par jour en mode démo
const today = () => new Date().toISOString().slice(0, 10); // jour UTC
const quota = () => { const q = store.get("quota"); return q && q.day === today() ? q : { day: today(), used: 0 }; };
const remaining = () => Math.max(0, DAILY - quota().used);
const fmt = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
const frameStyle = (ratio) => `--ar:${RATIOS[ratio].ar};--r:${RATIOS[ratio].r}`;
const seg = (attr, opts, cur) => `<div class="seg" role="radiogroup">${opts.map((o) => `<button type="button" role="radio" aria-checked="${o === cur}" data-${attr}="${o}">${o}</button>`).join("")}</div>`;
function bindSeg(attr, cb) {
  $$(`[data-${attr}]`).forEach((b) => (b.onclick = () => {
    $$(`[data-${attr}]`).forEach((x) => x.setAttribute("aria-checked", x === b));
    cb(b.dataset[attr]);
  }));
}

// État partagé entre les écrans (les médias importés restent en mémoire de la page)
const state = { ratio: "9:16", name: "Sans titre", pid: null, assets: {}, clips: [], texts: [], sel: null, selText: null, t: 0, zoom: 40, res: "720p", vimg: null };

// Service d'images : Worker Cloudflare (FLUX.1 schnell via Workers AI)
const AI_URL = "https://replica-ai.bnoureddine049.workers.dev";
const STYLE_HINT = { "Photo réaliste": "photorealistic, high detail", "Illustration": "digital illustration", "Cinéma": "cinematic lighting, film still", "Dessin animé": "cartoon style, bold colors" };

// Réduit l'image reçue (JPEG 768 px) pour économiser le stockage local
const shrink = (src) => new Promise((ok) => {
  const i = new Image();
  i.onload = () => {
    const s = Math.min(1, 768 / Math.max(i.width, i.height)), c = document.createElement("canvas");
    c.width = Math.round(i.width * s); c.height = Math.round(i.height * s);
    c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", 0.85));
  };
  i.onerror = () => ok(src); i.src = src;
});

const views = {};

/* ---------- Montage : stockage des médias (IndexedDB) ---------- */
// Les fichiers importés sont gardés dans IndexedDB pour pouvoir rouvrir un projet après fermeture de la page.
const idb = (() => {
  let p;
  const open = () => (p ||= new Promise((ok, no) => {
    const r = indexedDB.open("replica", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("blobs");
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((ok, no) => {
      const t = db.transaction("blobs", mode), q = fn(t.objectStore("blobs"));
      t.oncomplete = () => ok(q && q.result); t.onerror = t.onabort = () => no(t.error);
    });
  };
  return { put: (k, b) => run("readwrite", (s) => s.put(b, k)), get: (k) => run("readonly", (s) => s.get(k)), del: (k) => run("readwrite", (s) => s.delete(k)) };
})();

/* ---------- Montage : modèle, historique, sauvegarde ---------- */
// Un projet = des médias (assets), une suite de clips qui y puisent (in/out en secondes de la source), des textes.
const TEXT_POS = { Haut: 15, Milieu: 50, Bas: 82 };
const TEXT_COL = { Blanc: "#ffffff", Jaune: "#ffd84d", Menthe: "#4de3c1" };
const fmt1 = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const clipDur = (c) => (c.out - c.in) / c.speed;
function layout() {
  let t = 0;
  const segs = state.clips.map((c) => { const s = { c, start: t, dur: clipDur(c) }; t += s.dur; return s; });
  return { segs, total: t };
}
const segAt = (L, t) => L.segs.find((s) => t < s.start + s.dur) || L.segs.at(-1);

const undo = [], redo = [];
const snap = () => ({ clips: structuredClone(state.clips), texts: structuredClone(state.texts) });
const ed = { refresh() {}, redraw() {}, tick() {}, playState() {} }; // branché par l'écran Éditeur quand il est ouvert

function pushUndo() { undo.push(snap()); if (undo.length > 60) undo.shift(); redo.length = 0; }
function clampT() { state.t = Math.max(0, Math.min(state.t, layout().total)); }
function afterChange() { clampT(); save(); ed.refresh(); }
function mutate(fn) { if (eng.exporting) return; stop(); pushUndo(); fn(); afterChange(); }
function restore(s) {
  stop(); state.clips = structuredClone(s.clips); state.texts = structuredClone(s.texts);
  if (!state.clips.some((c) => c.id === state.sel)) state.sel = null;
  if (!state.texts.some((x) => x.id === state.selText)) state.selText = null;
  afterChange();
}
function doUndo() { if (eng.exporting || !undo.length) return; redo.push(snap()); restore(undo.pop()); }
function doRedo() { if (eng.exporting || !redo.length) return; undo.push(snap()); restore(redo.pop()); }

let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); }
function saveNow() {
  if (!state.clips.length && !state.texts.length && !state.pid) return;
  state.pid ||= uid();
  const p = { id: state.pid, name: state.name.trim() || "Sans titre", ratio: state.ratio, clips: state.clips.length, at: Date.now(),
    data: { assets: Object.values(state.assets).map(({ id, name, type, dur }) => ({ id, name, type, dur })), clips: state.clips, texts: state.texts } };
  store.set("projects", [p, ...store.get("projects", []).filter((x) => x.id !== p.id)]);
}

function closeAssets() {
  Object.values(state.assets).forEach((a) => { try { a.el.pause?.(); } catch {} URL.revokeObjectURL(a.url); });
}
function resetProject(extra = {}) {
  stop(); closeAssets(); undo.length = redo.length = 0;
  Object.assign(state, { pid: null, name: "Sans titre", ratio: "9:16", assets: {}, clips: [], texts: [], sel: null, selText: null, t: 0, ...extra });
}

// Charge un média : renvoie { id, name, type, url, el, dur }
const fixDuration = (v) => new Promise((ok) => {
  if (isFinite(v.duration)) return ok(v.duration);
  const f = () => { if (isFinite(v.duration)) { v.removeEventListener("timeupdate", f); v.currentTime = 0; ok(v.duration); } };
  v.addEventListener("timeupdate", f); v.currentTime = 1e7; setTimeout(() => ok(3), 4000);
});
function loadAsset(id, name, blob) {
  const type = blob.type.startsWith("video") ? "video" : "image", url = URL.createObjectURL(blob);
  return new Promise((ok, no) => {
    const fail = () => { URL.revokeObjectURL(url); no(new Error(`Format non pris en charge : ${name}`)); };
    if (type === "image") {
      const el = new Image(); el.onload = () => ok({ id, name, type, url, el, dur: 0 }); el.onerror = fail; el.src = url; return;
    }
    const el = document.createElement("video");
    el.preload = "auto"; el.playsInline = true; el.onerror = fail;
    el.addEventListener("loadeddata", () => ed.redraw());
    el.onloadedmetadata = async () => ok({ id, name, type, url, el, dur: await fixDuration(el) });
    el.src = url;
  });
}
async function addMedia(blob, name) {
  if (eng.exporting) return;
  const id = uid(), a = await loadAsset(id, name, blob);
  try { await idb.put(id, blob); } catch { toast("Stockage plein : ce média ne sera pas conservé après fermeture de la page."); }
  mutate(() => {
    state.assets[id] = a;
    const c = { id: uid(), a: id, in: 0, out: a.type === "video" ? a.dur : 3, speed: 1, mute: false, fi: false, fo: false, fit: "cover" };
    state.clips.push(c); state.sel = c.id; state.selText = null;
  });
}
async function openProject(p) {
  resetProject({ pid: p.id, name: p.name, ratio: p.ratio });
  const d = p.data; let missing = 0;
  if (d) {
    for (const m of d.assets) {
      try { const b = await idb.get(m.id); if (!b) throw 0; state.assets[m.id] = await loadAsset(m.id, m.name, b); } catch { missing++; }
    }
    state.clips = d.clips.filter((c) => state.assets[c.a]); state.texts = d.texts || [];
    state.sel = state.clips[0]?.id ?? null;
  }
  toast(!d ? "Projet ouvert (sans médias enregistrés)." : missing ? `Projet ouvert. ${missing} média${missing > 1 ? "s" : ""} introuvable${missing > 1 ? "s" : ""}.` : "Projet ouvert.");
  location.hash = "#/editor";
}

/* ---------- Montage : lecture, aperçu et export ---------- */
const eng = { cv: null, ctx: null, playing: false, raf: 0, w0: 0, t0: 0, active: null, finish: null, done: null, ac: null, spk: null, dest: null, exporting: false };

function sizeCanvas(scale = 1) {
  if (!eng.cv) return;
  const [w, h] = RATIOS[state.ratio].px; eng.cv.width = Math.round(w * scale); eng.cv.height = Math.round(h * scale);
}
function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const tr = line ? `${line} ${w}` : w;
      if (ctx.measureText(tr).width > maxW && line) { out.push(line); line = w; } else line = tr;
    }
    out.push(line);
  }
  return out;
}
function drawText(ctx, W, H, x) {
  const size = Math.round((H * x.size) / 100), lh = size * 1.2;
  ctx.font = `700 ${size}px "Avenir Next","Segoe UI",system-ui,sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const lines = wrapText(ctx, x.text, W * 0.86), y0 = (H * TEXT_POS[x.pos]) / 100 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    const y = y0 + i * lh;
    ctx.lineWidth = size * 0.16; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.strokeText(l, W / 2, y);
    ctx.fillStyle = x.color; ctx.fillText(l, W / 2, y);
  });
}
function drawFrame(t) {
  const { cv, ctx } = eng; if (!cv) return;
  const W = cv.width, H = cv.height, L = layout(), seg = L.segs.length ? segAt(L, Math.min(t, L.total)) : null;
  if (seg) {
    const a = state.assets[seg.c.a], el = a.el;
    if (a.type === "video" && el.readyState < 2) return; // média pas prêt : on garde l'image précédente
    const iw = a.type === "video" ? el.videoWidth : el.naturalWidth, ih = a.type === "video" ? el.videoHeight : el.naturalHeight;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (iw && ih) {
      const k = (seg.c.fit === "contain" ? Math.min : Math.max)(W / iw, H / ih), local = t - seg.start;
      let al = 1;
      if (seg.c.fi) al = Math.min(al, local / 0.3);
      if (seg.c.fo) al = Math.min(al, (seg.dur - local) / 0.3);
      ctx.globalAlpha = Math.max(0, Math.min(1, al));
      ctx.drawImage(el, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k); ctx.globalAlpha = 1;
    }
  } else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
  state.texts.forEach((x) => { if (t >= x.start && t < x.end && x.text.trim()) drawText(ctx, W, H, x); });
}

function silence(except) {
  Object.values(state.assets).forEach((a) => { if (a.type === "video" && a !== except && !a.el.paused) a.el.pause(); });
}
// Met la vidéo source au bon endroit pour l'instant t ; playing = lecture continue
function sync(t, playing) {
  const L = layout(); if (!L.segs.length) return;
  const tt = Math.min(t, L.total), seg = segAt(L, tt), c = seg.c, a = state.assets[c.a];
  const changed = eng.active !== c.id; eng.active = c.id;
  if (a.type !== "video") { silence(null); return; }
  if (changed) silence(a);
  const el = a.el, want = c.in + (tt - seg.start) * c.speed;
  if (a.gain) a.gain.gain.value = c.mute ? 0 : 1;
  if (!playing) {
    el.pause();
    if (Math.abs(el.currentTime - want) > 0.02) { el.addEventListener("seeked", () => ed.redraw(), { once: true }); el.currentTime = want; }
    return;
  }
  if (Math.abs(el.currentTime - want) > 0.4) el.currentTime = want;
  el.playbackRate = c.speed; if (el.paused) el.play().catch(() => {});
  const nx = L.segs[L.segs.indexOf(seg) + 1]; // prépare le clip suivant s'il vient d'un autre média
  if (nx && seg.start + seg.dur - t < 0.7) {
    const na = state.assets[nx.c.a];
    if (na.type === "video" && na !== a && na.el.paused && Math.abs(na.el.currentTime - nx.c.in) > 0.05) na.el.currentTime = nx.c.in;
  }
}
function seek(t) { stop(); state.t = Math.max(0, Math.min(t, layout().total)); sync(state.t, false); drawFrame(state.t); }

function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  if (!eng.ac) { eng.ac = new AC(); eng.spk = eng.ac.createGain(); eng.spk.connect(eng.ac.destination); eng.dest = eng.ac.createMediaStreamDestination(); }
  eng.ac.resume?.();
  Object.values(state.assets).forEach((a) => {
    if (a.type !== "video" || a.gain) return;
    try { const s = eng.ac.createMediaElementSource(a.el); a.gain = eng.ac.createGain(); s.connect(a.gain); a.gain.connect(eng.spk); a.gain.connect(eng.dest); } catch {}
  });
}
function stop(ok = false) {
  if (!eng.playing) return;
  eng.playing = false; cancelAnimationFrame(eng.raf); silence(null);
  const f = eng.finish; eng.finish = null; f?.(ok); ed.playState();
}
function play() {
  const L = layout(); if (!L.total) return Promise.resolve(false);
  if (eng.playing) return eng.done;
  ensureAudio();
  if (state.t >= L.total - 0.05) state.t = 0;
  eng.playing = true; eng.w0 = performance.now(); eng.t0 = state.t; eng.active = null;
  eng.done = new Promise((ok) => (eng.finish = ok));
  const tick = (now) => {
    if (!eng.playing) return;
    const total = layout().total, t = eng.t0 + (now - eng.w0) / 1000;
    if (t >= total) { state.t = total; drawFrame(total - 0.001); ed.tick(total); stop(true); return; }
    state.t = t; sync(t, true); drawFrame(t); ed.tick(t);
    eng.raf = requestAnimationFrame(tick);
  };
  eng.raf = requestAnimationFrame(tick); ed.playState();
  return eng.done;
}

// Export : on rejoue le montage en temps réel sur le canvas et on l'enregistre (image + son)
async function exportVideo(res) {
  if (!layout().total) throw new Error("Rien à exporter.");
  if (!window.MediaRecorder) throw new Error("Export non pris en charge par ce navigateur.");
  stop(); ensureAudio();
  const scale = res === "1080p" ? 1.5 : 1;
  eng.exporting = true; sizeCanvas(scale);
  const tracks = [...eng.cv.captureStream(30).getVideoTracks(), ...(eng.dest ? eng.dest.stream.getAudioTracks() : [])];
  const mime = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: scale > 1 ? 10e6 : 6e6 } : {});
  const chunks = [], stopped = new Promise((ok) => (rec.onstop = ok));
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const [w, h] = [eng.cv.width, eng.cv.height];
  try {
    if (eng.spk) eng.spk.gain.value = 0; // pas de son dans les haut-parleurs pendant l'export
    state.t = 0; sync(0, false); await new Promise((r) => setTimeout(r, 350)); drawFrame(0);
    rec.start(1000);
    const ok = await play();
    await new Promise((r) => setTimeout(r, 250));
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    if (!ok || !chunks.length) return null;
    const type = rec.mimeType || mime || "video/webm";
    return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm", w, h };
  } finally {
    if (rec.state !== "inactive") rec.stop();
    eng.exporting = false; if (eng.spk) eng.spk.gain.value = 1;
    sizeCanvas(1); state.t = 0; sync(0, false); drawFrame(0);
  }
}

/* ---------- Tableau de bord ---------- */
views.dashboard = {
  html() {
    const ps = store.get("projects", []).slice(0, 3);
    return `<h1>Bonjour</h1>
      <p class="lead">Créez une image, animez-la, puis montez votre vidéo, depuis votre téléphone.</p>
      <div class="card"><strong>${remaining()} image${remaining() > 1 ? "s" : ""} restante${remaining() > 1 ? "s" : ""} aujourd’hui</strong>
        <div class="meter" role="img" aria-label="Quota du jour"><span style="width:${(remaining() / DAILY) * 100}%"></span></div>
        <p class="note">Le quota est remis à zéro chaque jour à 00:00 UTC. Images générées par IA (FLUX.1 schnell).</p></div>
      <h2>Commencer</h2>
      <div class="actions">
        <a class="card" href="#/image"><strong>Générer une image</strong><span class="note">Décrivez-la en une phrase.</span></a>
        <a class="card" href="#/video"><strong>Animer une image</strong><span class="note">Zoom et panoramique, aperçu immédiat.</span></a>
        <a class="card" href="#/editor"><strong>Monter une vidéo</strong><span class="note">Importez vos clips et assemblez-les.</span></a>
      </div>
      <h2>Projets récents</h2>
      ${ps.length ? `<ul class="list">${ps.map((p) => `<li class="card item"><span>${esc(p.name)}<small>${esc(p.ratio)} · ${p.clips} clip${p.clips > 1 ? "s" : ""}</small></span><a class="btn mini" href="#/library">Voir</a></li>`).join("")}</ul>`
        : `<div class="empty">Aucun projet pour l’instant. Ouvrez l’éditeur pour en créer un.</div>`}`;
  },
  bind() {},
};

/* ---------- Génération d'images ---------- */
views.image = {
  html() {
    return `<h1>Générer une image</h1>
      <p class="lead">Décrivez ce que vous voulez voir.</p>
      <label for="prompt">Description</label>
      <textarea id="prompt" rows="3" maxlength="300" placeholder="Un phare sur une falaise au lever du soleil"></textarea>
      <div class="row">
        <div><span class="lbl">Format</span>${seg("ratio", Object.keys(RATIOS), state.ratio)}</div>
        <div style="flex:1;min-width:180px"><label for="style">Style</label>
          <select id="style"><option>Photo réaliste</option><option>Illustration</option><option>Cinéma</option><option>Dessin animé</option></select></div>
      </div>
      <button id="gen" class="btn primary" type="button"></button>
      <p class="note" style="margin-top:10px">Images générées par IA. Le service est gratuit et limité : le quota du jour est partagé. Format carré, recadré selon le format choisi.</p>
      <div id="gal" class="gallery"></div>`;
  },
  bind() {
    const refresh = () => {
      $("#gen").textContent = `Générer (${remaining()} restante${remaining() > 1 ? "s" : ""})`;
      const imgs = store.get("images", []);
      $("#gal").innerHTML = imgs.length ? imgs.map((i) => `<figure><img src="${i.src}" alt="${esc(i.prompt)}"><figcaption>${esc(i.prompt)}</figcaption>
        <button class="btn mini" data-anim="${i.id}" type="button">Animer</button> <button class="btn mini" data-edit="${i.id}" type="button">Au montage</button> <button class="btn mini danger" data-del="${i.id}" type="button">Retirer</button></figure>`).join("")
        : `<div class="empty" style="grid-column:1/-1">Aucune image pour l’instant. Écrivez une description, puis touchez Générer.</div>`;
      $$("[data-anim]").forEach((b) => (b.onclick = () => { state.vimg = imgs.find((i) => i.id === b.dataset.anim).src; location.hash = "#/video"; }));
      $$("[data-edit]").forEach((b) => (b.onclick = async () => {
        const i = imgs.find((q) => q.id === b.dataset.edit);
        try { await addMedia(await (await fetch(i.src)).blob(), i.prompt.slice(0, 28) || "Image IA"); location.hash = "#/editor"; } catch (e) { toast(e.message); }
      }));
      $$("[data-del]").forEach((b) => (b.onclick = () => { store.set("images", imgs.filter((i) => i.id !== b.dataset.del)); refresh(); }));
    };
    bindSeg("ratio", (v) => (state.ratio = v));
    $("#gen").onclick = async () => {
      const prompt = $("#prompt").value.trim();
      if (!prompt) return toast("Écrivez une description d’abord.");
      if (!remaining()) return toast("Quota du jour épuisé. Il repart à 00:00 UTC.");
      const btn = $("#gen"); btn.disabled = true; btn.textContent = "Génération en cours…";
      try {
        const r = await fetch(AI_URL, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: `${prompt}, ${STYLE_HINT[$("#style").value]}` }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.image) throw new Error(d.error || "Erreur du service d’images.");
        const imgs = store.get("images", []);
        imgs.unshift({ id: uid(), prompt, src: await shrink(d.image) });
        store.set("images", imgs.slice(0, 8));
        store.set("quota", { day: today(), used: quota().used + 1 }); // débité après succès
      } catch (e) {
        toast(e instanceof TypeError ? "Connexion impossible. Vérifiez Internet." : e.message);
      }
      btn.disabled = false; refresh();
    };
    refresh();
  },
};

/* ---------- Image vers vidéo (aperçu local) ---------- */
views.video = {
  html() {
    const imgs = store.get("images", []).slice(0, 4);
    return `<h1>Animer une image</h1>
      <p class="lead">Ajoutez un mouvement de caméra à une image fixe.</p>
      <div class="studio">
        <div class="stick"><div class="frame" id="vframe" style="${frameStyle(state.ratio)}"><img id="vimg" alt="Image à animer" hidden><p id="vempty">Choisissez une image pour commencer.</p></div></div>
        <div class="panel">
          <div><label class="btn" for="vfile">Choisir une image</label><input id="vfile" type="file" accept="image/*" hidden></div>
          ${imgs.length ? `<div class="row" style="margin:0">${imgs.map((i) => `<button type="button" class="btn mini" data-pick="${i.id}">${esc(i.prompt.slice(0, 14))}</button>`).join("")}</div>` : ""}
          <div><span class="lbl">Format</span>${seg("ratio", Object.keys(RATIOS), state.ratio)}</div>
          <div><label for="motion">Mouvement</label><select id="motion"><option value="zin">Zoom avant</option><option value="zout">Zoom arrière</option><option value="pl">Panoramique vers la droite</option><option value="pr">Panoramique vers la gauche</option></select></div>
          <div><label for="dur">Durée : <span id="durv">4</span> s</label><input id="dur" type="range" min="2" max="10" value="4"></div>
          <div><label for="amt">Intensité : <span id="amtv">30</span> %</label><input id="amt" type="range" min="10" max="40" value="30"></div>
          <button id="play" class="btn primary" type="button">Lire l’aperçu</button>
          <button id="exp" class="btn" type="button">Exporter la vidéo</button>
          <div id="result"></div>
          <p class="note">Le mouvement est calculé sur votre téléphone, sans IA. L’export crée un fichier vidéo (sans son) enregistré en temps réel : gardez l’écran allumé pendant l’export.</p>
        </div>
      </div>`;
  },
  bind() {
    const img = $("#vimg"), setImg = (src) => { state.vimg = src; img.src = src; img.hidden = false; $("#vempty").hidden = true; };
    if (state.vimg) setImg(state.vimg);
    $("#vfile").onchange = (e) => { const f = e.target.files[0]; if (f) setImg(URL.createObjectURL(f)); };
    $$("[data-pick]").forEach((b) => (b.onclick = () => setImg(store.get("images", []).find((i) => i.id === b.dataset.pick).src)));
    bindSeg("ratio", (v) => { state.ratio = v; $("#vframe").style.cssText = frameStyle(v); });
    $("#dur").oninput = (e) => ($("#durv").textContent = e.target.value);
    $("#amt").oninput = (e) => ($("#amtv").textContent = e.target.value);
    $("#play").onclick = () => {
      if (img.hidden) return toast("Choisissez d’abord une image.");
      const k = $("#amt").value / 100, p = k * 45, s = 1 + k;
      const m = { zin: ["scale(1)", `scale(${s})`], zout: [`scale(${s})`, "scale(1)"],
        pl: [`translateX(${-p}%) scale(${s})`, `translateX(${p}%) scale(${s})`], pr: [`translateX(${p}%) scale(${s})`, `translateX(${-p}%) scale(${s})`] }[$("#motion").value];
      img.getAnimations().forEach((a) => a.cancel());
      img.animate([{ transform: m[0] }, { transform: m[1] }], { duration: $("#dur").value * 1000, easing: "ease-in-out", fill: "forwards" });
    };
    $("#exp").onclick = async () => {
      if (img.hidden) return toast("Choisissez d’abord une image.");
      if (!window.MediaRecorder) return toast("Export non pris en charge par ce navigateur.");
      const btn = $("#exp"), dur = +$("#dur").value, k = $("#amt").value / 100, s = 1 + k, p = k * 0.45;
      const [W, H] = RATIOS[state.ratio].px, c = document.createElement("canvas"); c.width = W; c.height = H;
      const ctx = c.getContext("2d"), base = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * base, dh = img.naturalHeight * base;
      const [[s0, x0], [s1, x1]] = { zin: [[1, 0], [s, 0]], zout: [[s, 0], [1, 0]], pl: [[s, -p], [s, p]], pr: [[s, p], [s, -p]] }[$("#motion").value];
      const draw = (q) => {
        const e = q < 0.5 ? 2 * q * q : 1 - 2 * (1 - q) ** 2; // départ et arrivée en douceur
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.save();
        ctx.translate(W / 2 + (x0 + (x1 - x0) * e) * W, H / 2); const z = s0 + (s1 - s0) * e; ctx.scale(z, z);
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore();
      };
      const mime = ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      btn.disabled = true; $("#result").innerHTML = "";
      try {
        draw(0);
        const rec = new MediaRecorder(c.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : {}), chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        const stopped = new Promise((ok) => (rec.onstop = ok));
        rec.start(); const t0 = performance.now();
        await new Promise((ok) => {
          const tick = (now) => {
            const q = Math.min(1, (now - t0) / (dur * 1000)); draw(q);
            btn.textContent = `Export… ${Math.round(q * 100)} %`;
            q < 1 ? requestAnimationFrame(tick) : ok();
          };
          requestAnimationFrame(tick);
        });
        await new Promise((ok) => setTimeout(ok, 150)); rec.stop(); await stopped;
        const type = rec.mimeType || mime || "video/webm", ext = type.includes("mp4") ? "mp4" : "webm";
        if (!chunks.length) throw new Error("Aucune image enregistrée.");
        if (state.lastUrl) URL.revokeObjectURL(state.lastUrl);
        const url = (state.lastUrl = URL.createObjectURL(new Blob(chunks, { type })));
        $("#result").innerHTML = `<video src="${url}" controls playsinline style="width:100%;border-radius:12px;background:#000"></video>
          <a class="btn primary" style="margin-top:10px" href="${url}" download="replica-${Date.now()}.${ext}">Télécharger (${ext.toUpperCase()}, ${W}×${H})</a>
          <button id="toed" class="btn" style="margin:10px 0 0 8px" type="button">Ajouter au montage</button>`;
        $("#toed").onclick = async () => { try { await addMedia(await (await fetch(url)).blob(), "Animation"); location.hash = "#/editor"; } catch (e) { toast(e.message); } };
      } catch (e) { toast("Export impossible : " + e.message); }
      btn.disabled = false; btn.textContent = "Exporter la vidéo";
    };
  },
};

/* ---------- Éditeur ---------- */
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const segL = (attr, opts, cur) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(v) === String(cur)}" data-${attr}="${v}">${l}</button>`).join("")}</div>`;
const slider = (id, label, val, min, max, step, unit = "s") => `<div><label for="${id}">${label} : <span id="${id}v">${(+val).toFixed(step < 1 ? 1 : 0)}</span> ${unit}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
const toggle = (id, label, on) => `<button id="${id}" class="btn mini" type="button" aria-pressed="${on}">${label}</button>`;

views.editor = {
  html() {
    const imgs = store.get("images", []).slice(0, 8);
    return `<h1>Éditeur</h1>
      <p class="lead">Assemblez vos clips, ajoutez du texte, exportez.</p>
      <div class="ed">
        <div class="ed-main">
          <div class="stick">
            <div class="frame" id="eframe" style="${frameStyle(state.ratio)}"><canvas id="cv" role="img" aria-label="Aperçu du montage"></canvas><p id="eempty">Importez un clip ou une image pour commencer.</p></div>
            <div class="transport">
              <button id="eplay" class="btn" type="button" aria-label="Lecture"></button>
              <span class="time" id="etime">0:00.0 / 0:00.0</span>
              <input id="escrub" type="range" min="0" max="0" step="0.01" value="0" aria-label="Position dans la vidéo">
            </div>
          </div>
          <div class="tl-bar">
            <button id="eundo" class="btn mini" type="button">Annuler</button>
            <button id="eredo" class="btn mini" type="button">Rétablir</button>
            <span class="grow"></span>
            <button id="zout" class="btn mini" type="button" aria-label="Réduire la timeline">−</button>
            <button id="zin" class="btn mini" type="button" aria-label="Agrandir la timeline">+</button>
          </div>
          <div class="tl" id="tl"><div class="tl-in" id="tlin"><div class="tl-row" id="vrow"></div><div class="tl-row t" id="trow"></div><div class="head" id="head"></div></div></div>
          <div class="tools" id="tools"></div>
        </div>
        <div class="ed-side">
          <div class="panel" id="pbody">
            <div><label for="pname">Nom du projet</label><input id="pname" type="text" maxlength="60" value="${esc(state.name)}"></div>
            <div><span class="lbl">Format</span>${seg("ratio", Object.keys(RATIOS), state.ratio)}</div>
            <div><label class="btn primary" for="efile">Importer des clips</label><input id="efile" type="file" accept="video/*,image/*" multiple hidden></div>
            ${imgs.length ? `<div><span class="lbl">Mes images IA</span><div class="thumbs">${imgs.map((i) => `<button type="button" data-ai="${i.id}" aria-label="Ajouter l’image : ${esc(i.prompt)}"><img src="${i.src}" alt=""></button>`).join("")}</div></div>` : ""}
            <button id="enew" class="btn" type="button">Nouveau projet</button>
            <p class="note">Le projet est enregistré automatiquement sur cet appareil, médias compris.</p>
          </div>
          <div class="panel">
            <div><span class="lbl">Qualité d’export</span>${seg("res", ["720p", "1080p"], state.res)}</div>
            <button id="eexp" class="btn primary" type="button">Exporter la vidéo</button>
            <button id="ecancel" class="btn danger" type="button" hidden>Annuler l’export</button>
            <div id="eresult"></div>
            <p class="note">L’export rejoue le montage en temps réel : gardez l’écran allumé et cette page ouverte. Une vidéo de 30 s prend environ 30 s.</p>
          </div>
        </div>
      </div>`;
  },
  bind() {
    eng.cv = $("#cv"); eng.ctx = eng.cv.getContext("2d"); sizeCanvas(1);
    let drag = false;
    // Modification en direct (curseurs, saisie) : un seul cran d'historique par geste
    const edit = (fn) => { if (eng.exporting) return; stop(); if (!drag) { pushUndo(); drag = true; } fn(); save(); };
    const endEdit = () => { drag = false; };
    const goto = (t) => { state.t = Math.max(0, Math.min(t, layout().total)); sync(state.t, false); drawFrame(state.t); renderTl(); renderTransport(); updateSplit(); };

    function renderTransport() {
      const L = layout();
      $("#escrub").max = L.total; $("#escrub").value = state.t;
      $("#etime").textContent = `${fmt1(state.t)} / ${fmt1(L.total)}`;
      $("#eplay").disabled = !L.total; $("#eplay").innerHTML = eng.playing ? ICON_PAUSE : ICON_PLAY;
      $("#eplay").setAttribute("aria-label", eng.playing ? "Pause" : "Lecture");
      $("#eempty").hidden = !!(L.segs.length || state.texts.length);
      $("#eundo").disabled = !undo.length; $("#eredo").disabled = !redo.length;
    }
    function renderHead() { $("#head").style.left = `${state.t * state.zoom}px`; }
    function renderTl() {
      const L = layout(), pps = state.zoom;
      $("#tlin").style.width = `${L.total * pps + 60}px`;
      $("#vrow").innerHTML = L.segs.length ? L.segs.map((s) => {
        const a = state.assets[s.c.a];
        return `<button type="button" class="blk ${a.type === "video" ? "v" : "i"}" data-c="${s.c.id}" aria-pressed="${s.c.id === state.sel}" style="left:${s.start * pps}px;width:${s.dur * pps}px">${esc(a.name)} · ${s.dur.toFixed(1)} s</button>`;
      }).join("") : `<span class="note tl-hint">Aucun clip. Touchez « Importer des clips ».</span>`;
      $("#trow").innerHTML = state.texts.map((x) => `<button type="button" class="blk x" data-x="${x.id}" aria-pressed="${x.id === state.selText}" style="left:${x.start * pps}px;width:${Math.max(8, (x.end - x.start) * pps)}px">${esc(x.text || "Texte")}</button>`).join("");
      renderHead();
    }
    function updateSplit() {
      const b = $("#esplit"); if (!b) return;
      const s = layout().segs.find((x) => x.c.id === state.sel), loc = s ? state.t - s.start : -1;
      b.disabled = !s || loc < 0.1 || loc > s.dur - 0.1;
    }

    function renderTools() {
      const L = layout(), seg = L.segs.find((s) => s.c.id === state.sel), x = state.texts.find((t) => t.id === state.selText);
      let h = `<div class="row" style="margin:0"><button id="xadd" class="btn" type="button">Ajouter un texte</button></div>`;
      if (seg) {
        const c = seg.c, a = state.assets[c.a], v = a.type === "video";
        h += `<h2>${esc(a.name)}</h2>
          <div class="row" style="margin:0"><button id="esplit" class="btn mini" type="button">Scinder ici</button><button id="edup" class="btn mini" type="button">Dupliquer</button>
            <button id="eleft" class="btn mini" type="button" aria-label="Déplacer le clip vers le début">← Avant</button><button id="eright" class="btn mini" type="button" aria-label="Déplacer le clip vers la fin">Après →</button>
            <button id="edel" class="btn mini danger" type="button">Supprimer</button></div>`;
        h += v ? slider("sIn", "Début", c.in, 0, Math.max(0.1, c.out - 0.1), 0.05) + slider("sOut", "Fin", c.out, c.in + 0.1, a.dur, 0.05)
          : slider("sDur", "Durée", c.out - c.in, 1, 15, 0.5);
        if (v) h += `<div><span class="lbl">Vitesse</span>${segL("spd", [[0.5, "0,5×"], [1, "1×"], [1.5, "1,5×"], [2, "2×"]], c.speed)}</div>`;
        h += `<div><span class="lbl">Cadrage</span>${segL("fit", [["cover", "Remplir"], ["contain", "Ajuster"]], c.fit)}</div>
          <div class="row" style="margin:0">${toggle("efi", "Fondu entrant", c.fi)}${toggle("efo", "Fondu sortant", c.fo)}${v ? toggle("emute", "Muet", c.mute) : ""}</div>`;
      } else if (x) {
        const max = Math.max(L.total, x.end);
        h += `<h2>Texte</h2>
          <div><label for="xt">Contenu</label><textarea id="xt" rows="2" maxlength="120">${esc(x.text)}</textarea></div>
          ${slider("xs", "Apparaît à", x.start, 0, max, 0.1)}${slider("xe", "Disparaît à", x.end, 0, max, 0.1)}
          <div><span class="lbl">Position</span>${segL("pos", Object.keys(TEXT_POS).map((k) => [k, k]), x.pos)}</div>
          ${slider("xz", "Taille", x.size, 3, 12, 0.5, "%")}
          <div><span class="lbl">Couleur</span>${segL("col", Object.keys(TEXT_COL).map((k) => [k, k]), Object.keys(TEXT_COL).find((k) => TEXT_COL[k] === x.color))}</div>
          <div class="row" style="margin:0"><button id="xdel" class="btn mini danger" type="button">Supprimer le texte</button></div>`;
      } else h += `<p class="note">Touchez un clip ou un texte dans la timeline pour le modifier.</p>`;
      $("#tools").innerHTML = h; bindTools(seg, x); updateSplit();
    }

    function bindTools(seg, x) {
      $("#xadd").onclick = () => mutate(() => {
        const total = layout().total, start = Math.min(state.t, Math.max(0, total - 0.5));
        const t = { id: uid(), text: "Votre texte", start, end: Math.max(start + 0.5, Math.min(total || 3, start + 3)), pos: "Bas", size: 6, color: TEXT_COL.Blanc };
        state.texts.push(t); state.selText = t.id; state.sel = null;
      });
      if (seg) {
        const c = seg.c, a = state.assets[c.a], v = a.type === "video";
        if (v) {
          $("#sIn").oninput = (e) => { edit(() => (c.in = Math.min(+e.target.value, c.out - 0.1))); $("#sInv").textContent = c.in.toFixed(1); $("#sOut").min = c.in + 0.1; goto(layout().segs.find((q) => q.c.id === c.id).start); };
          $("#sOut").oninput = (e) => { edit(() => (c.out = Math.max(+e.target.value, c.in + 0.1))); $("#sOutv").textContent = c.out.toFixed(1); $("#sIn").max = Math.max(0.1, c.out - 0.1); const s = layout().segs.find((q) => q.c.id === c.id); goto(s.start + s.dur - 0.05); };
          $("#sIn").onchange = $("#sOut").onchange = endEdit;
          bindSeg("spd", (val) => mutate(() => { c.speed = +val; }));
          $("#emute").onclick = () => mutate(() => { c.mute = !c.mute; });
        } else {
          $("#sDur").oninput = (e) => { edit(() => (c.out = c.in + +e.target.value)); $("#sDurv").textContent = (+e.target.value).toFixed(1); const s = layout().segs.find((q) => q.c.id === c.id); goto(s.start + s.dur - 0.05); };
          $("#sDur").onchange = endEdit;
        }
        bindSeg("fit", (val) => mutate(() => { c.fit = val; }));
        $("#efi").onclick = () => mutate(() => { c.fi = !c.fi; });
        $("#efo").onclick = () => mutate(() => { c.fo = !c.fo; });
        $("#esplit").onclick = () => {
          const loc = state.t - seg.start;
          if (loc < 0.1 || loc > seg.dur - 0.1) return toast("Placez la tête de lecture à l’intérieur du clip.");
          mutate(() => {
            const cut = c.in + loc * c.speed, b = { ...structuredClone(c), id: uid(), in: cut, fi: false };
            c.out = cut; c.fo = false; state.clips.splice(state.clips.indexOf(c) + 1, 0, b); state.sel = b.id;
          });
        };
        $("#edup").onclick = () => mutate(() => { const b = { ...structuredClone(c), id: uid() }; state.clips.splice(state.clips.indexOf(c) + 1, 0, b); state.sel = b.id; });
        const move = (d) => mutate(() => {
          const i = state.clips.indexOf(c), j = i + d; if (j < 0 || j >= state.clips.length) return;
          [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
          state.t = layout().segs.find((q) => q.c.id === c.id).start;
        });
        $("#eleft").onclick = () => move(-1); $("#eright").onclick = () => move(1);
        $("#eleft").disabled = state.clips.indexOf(c) === 0; $("#eright").disabled = state.clips.indexOf(c) === state.clips.length - 1;
        $("#edel").onclick = () => mutate(() => {
          const i = state.clips.indexOf(c); state.clips.splice(i, 1); state.sel = (state.clips[i] || state.clips[i - 1])?.id ?? null;
        });
      } else if (x) {
        $("#xt").oninput = (e) => { edit(() => (x.text = e.target.value)); drawFrame(state.t); renderTl(); };
        $("#xt").onchange = endEdit;
        $("#xs").oninput = (e) => { edit(() => { x.start = Math.min(+e.target.value, x.end - 0.1); }); $("#xsv").textContent = x.start.toFixed(1); $("#xe").min = x.start + 0.1; goto(x.start); };
        $("#xe").oninput = (e) => { edit(() => { x.end = Math.max(+e.target.value, x.start + 0.1); }); $("#xev").textContent = x.end.toFixed(1); $("#xs").max = x.end - 0.1; goto(Math.max(x.start, x.end - 0.05)); };
        $("#xz").oninput = (e) => { edit(() => (x.size = +e.target.value)); $("#xzv").textContent = x.size.toFixed(1); drawFrame(state.t); };
        $("#xs").onchange = $("#xe").onchange = $("#xz").onchange = endEdit;
        $("#xe").min = x.start + 0.1; $("#xs").max = x.end - 0.1;
        bindSeg("pos", (val) => mutate(() => { x.pos = val; }));
        bindSeg("col", (val) => mutate(() => { x.color = TEXT_COL[val]; }));
        $("#xdel").onclick = () => mutate(() => { state.texts = state.texts.filter((q) => q !== x); state.selText = null; });
      }
    }

    function renderAll() { renderTl(); renderTools(); renderTransport(); drawFrame(state.t); }
    Object.assign(ed, {
      refresh: () => { const L = layout(); if (L.segs.length) sync(state.t, false); renderAll(); },
      redraw: () => { if (!eng.playing) drawFrame(state.t); },
      playState: () => { renderTransport(); if (!eng.playing) { renderTools(); } },
      tick: (t) => {
        $("#escrub").value = t; $("#etime").textContent = `${fmt1(t)} / ${fmt1(layout().total)}`; renderHead();
        const tl = $("#tl"), x = t * state.zoom;
        if (x > tl.scrollLeft + tl.clientWidth - 40 || x < tl.scrollLeft) tl.scrollLeft = Math.max(0, x - tl.clientWidth / 3);
      },
    });

    // Transport
    $("#eplay").onclick = () => { if (eng.exporting) return; eng.playing ? stop() : play(); };
    $("#escrub").oninput = (e) => { if (eng.exporting) return; seek(+e.target.value); renderTl(); $("#etime").textContent = `${fmt1(state.t)} / ${fmt1(layout().total)}`; updateSplit(); };
    $("#escrub").onchange = renderTools;
    $("#tlin").onclick = (e) => {
      if (eng.exporting) return;
      const t = (e.clientX - $("#tlin").getBoundingClientRect().left) / state.zoom, cb = e.target.closest("[data-c]"), tb = e.target.closest("[data-x]");
      if (cb) { state.sel = cb.dataset.c; state.selText = null; } else if (tb) { state.selText = tb.dataset.x; state.sel = null; }
      seek(t); renderTl(); renderTools(); renderTransport();
    };
    $("#eundo").onclick = doUndo; $("#eredo").onclick = doRedo;
    $("#zin").onclick = () => { state.zoom = Math.min(160, state.zoom * 1.4); renderTl(); };
    $("#zout").onclick = () => { state.zoom = Math.max(10, state.zoom / 1.4); renderTl(); };

    // Projet
    $("#pname").oninput = (e) => { state.name = e.target.value; save(); };
    bindSeg("ratio", (v) => { state.ratio = v; $("#eframe").style.cssText = frameStyle(v); sizeCanvas(1); drawFrame(state.t); save(); });
    $("#efile").onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = "";
      for (const f of files) { try { toast(`Import de ${f.name}…`); await addMedia(f, f.name); $("#toast").hidden = true; } catch (err) { toast(err.message); } }
    };
    $$("[data-ai]").forEach((b) => (b.onclick = async () => {
      const im = store.get("images", []).find((i) => i.id === b.dataset.ai); if (!im) return;
      try { await addMedia(await (await fetch(im.src)).blob(), im.prompt.slice(0, 28) || "Image IA"); } catch (err) { toast(err.message); }
    }));
    $("#enew").onclick = () => { resetProject(); renderAll(); $("#pname").value = state.name; $$("[data-ratio]").forEach((b) => b.setAttribute("aria-checked", b.dataset.ratio === state.ratio)); $("#eframe").style.cssText = frameStyle(state.ratio); sizeCanvas(1); drawFrame(0); };

    // Export
    bindSeg("res", (v) => (state.res = v));
    $("#ecancel").onclick = () => stop(false);
    $("#eexp").onclick = async () => {
      const btn = $("#eexp"), side = $("#pbody"), main = $(".ed-main"), out = $("#eresult");
      if (!layout().total) return toast("Ajoutez d’abord un clip.");
      side.inert = main.inert = true; btn.disabled = true; $("#ecancel").hidden = false; out.innerHTML = "";
      const baseTick = ed.tick;
      ed.tick = (t) => { baseTick(t); btn.textContent = `Export… ${Math.round((t / layout().total) * 100)} %`; };
      try {
        const r = await exportVideo(state.res);
        if (!btn.isConnected) return;
        if (!r) toast("Export annulé.");
        else {
          if (state.lastUrl) URL.revokeObjectURL(state.lastUrl);
          const url = (state.lastUrl = URL.createObjectURL(r.blob)), name = `replica-${Date.now()}.${r.ext}`, file = new File([r.blob], name, { type: r.blob.type });
          out.innerHTML = `<video src="${url}" controls playsinline style="width:100%;border-radius:12px;background:#000"></video>
            <div class="row" style="margin:10px 0 0"><a class="btn primary" href="${url}" download="${name}">Télécharger (${r.ext.toUpperCase()}, ${r.w}×${r.h})</a>${navigator.canShare?.({ files: [file] }) ? `<button id="eshare" class="btn" type="button">Partager</button>` : ""}</div>`;
          $("#eshare")?.addEventListener("click", () => navigator.share({ files: [file] }).catch(() => {}));
        }
      } catch (e) { if (btn.isConnected) toast("Export impossible : " + e.message); }
      if (!btn.isConnected) return;
      ed.tick = baseTick; side.inert = main.inert = false; btn.disabled = false; btn.textContent = "Exporter la vidéo"; $("#ecancel").hidden = true; renderAll();
    };

    if (state.clips.length) sync(state.t, false);
    renderAll();
  },
  leave() {
    stop(false);
    Object.assign(ed, { refresh() {}, redraw() {}, tick() {}, playState() {} });
    eng.cv = eng.ctx = null; saveNow();
  },
};

/* ---------- Bibliothèque ---------- */
views.library = {
  html() {
    return `<h1>Projets</h1>
      <p class="lead">Retrouvez vos projets enregistrés.</p>
      <div class="row"><div style="flex:1;min-width:200px"><label for="newname">Nouveau projet</label><input id="newname" type="text" maxlength="60" placeholder="Ma première vidéo"></div>
        <button id="newbtn" class="btn primary" type="button">Créer</button></div>
      <ul class="list" id="plist"></ul>`;
  },
  bind() {
    const draw = () => {
      const ps = store.get("projects", []);
      $("#plist").innerHTML = ps.length ? ps.map((p) => `<li class="card item"><span>${esc(p.name)}<small>${esc(p.ratio)} · ${p.clips} clip${p.clips > 1 ? "s" : ""} · ${new Date(p.at).toLocaleDateString("fr-FR")}</small></span>
        <span><button class="btn mini" data-open="${p.id}" type="button">Ouvrir</button> <button class="btn mini danger" data-rm="${p.id}" type="button">Supprimer</button></span></li>`).join("")
        : `<li class="empty">Aucun projet. Donnez un nom ci-dessus, puis touchez Créer.</li>`;
      $$("[data-open]").forEach((b) => (b.onclick = () => openProject(ps.find((x) => x.id === b.dataset.open))));
      $$("[data-rm]").forEach((b) => (b.onclick = () => {
        const p = ps.find((x) => x.id === b.dataset.rm);
        (p.data?.assets || []).forEach((a) => idb.del(a.id).catch(() => {}));
        if (state.pid === p.id) resetProject();
        store.set("projects", ps.filter((x) => x.id !== p.id)); draw();
      }));
    };
    $("#newbtn").onclick = () => {
      const name = $("#newname").value.trim(); if (!name) return toast("Donnez un nom au projet.");
      store.set("projects", [{ id: uid(), name, ratio: "9:16", clips: 0, at: Date.now() }, ...store.get("projects", [])]); draw();
    };
    draw();
  },
};

/* ---------- Navigation ---------- */
const NAV = [["dashboard", "Accueil", '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
  ["image", "Images", '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/>'],
  ["video", "Animer", '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'],
  ["editor", "Éditeur", '<path d="M3 7h10M3 12h18M3 17h7M15 17h6"/>'],
  ["library", "Projets", '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>']];
$("#nav").innerHTML = NAV.map(([id, label, path]) => `<a href="#/${id}" data-v="${id}"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg><span>${label}</span></a>`).join("");

let current;
function route() {
  current?.leave?.();
  const id = location.hash.slice(2), name = views[id] ? id : "dashboard";
  current = views[name];
  $("#view").innerHTML = current.html(); current.bind();
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.v === name ? "page" : "false"));
  document.title = `${NAV.find((n) => n[0] === name)[1]} · Replica`; scrollTo(0, 0);
}
addEventListener("hashchange", route);
route();
