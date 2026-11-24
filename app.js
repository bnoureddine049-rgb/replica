// Replica, version 0.2 : interface + génération d'images par IA (Worker Cloudflare).
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
const state = { ratio: "9:16", name: "Sans titre", pid: null, clips: [], sel: null, vimg: null };

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
        <button class="btn mini" data-anim="${i.id}" type="button">Animer</button> <button class="btn mini danger" data-del="${i.id}" type="button">Retirer</button></figure>`).join("")
        : `<div class="empty" style="grid-column:1/-1">Aucune image pour l’instant. Écrivez une description, puis touchez Générer.</div>`;
      $$("[data-anim]").forEach((b) => (b.onclick = () => { state.vimg = imgs.find((i) => i.id === b.dataset.anim).src; location.hash = "#/video"; }));
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
          <a class="btn primary" style="margin-top:10px" href="${url}" download="replica-${Date.now()}.${ext}">Télécharger (${ext.toUpperCase()}, ${W}×${H})</a>`;
      } catch (e) { toast("Export impossible : " + e.message); }
      btn.disabled = false; btn.textContent = "Exporter la vidéo";
    };
  },
};

/* ---------- Éditeur ---------- */
views.editor = {
  html() {
    return `<h1>Éditeur</h1>
      <p class="lead">Importez vos clips, organisez-les, vérifiez l’aperçu.</p>
      <div class="split">
        <div class="frame" id="eframe" style="${frameStyle(state.ratio)}"></div>
        <div class="panel">
          <div><label for="pname">Nom du projet</label><input id="pname" type="text" maxlength="60" value="${esc(state.name)}"></div>
          <div><span class="lbl">Format</span>${seg("ratio", Object.keys(RATIOS), state.ratio)}</div>
          <div><label class="btn primary" for="efile">Importer des clips</label><input id="efile" type="file" accept="video/*,image/*" multiple hidden></div>
          <button id="esave" class="btn" type="button">Enregistrer dans la bibliothèque</button>
          <p class="note">Les médias restent dans la page ouverte : réimportez-les après fermeture. Découpe, effets et export arrivent ensuite.</p>
        </div>
      </div>
      <div class="timeline"><h2>Piste vidéo <span class="note" id="etotal"></span></h2>
        <div class="track" id="track"></div>
        <div class="row"><button id="edel" class="btn danger" type="button">Supprimer le clip</button></div></div>`;
  },
  bind() {
    const draw = () => {
      const total = state.clips.reduce((n, c) => n + c.dur, 0);
      $("#etotal").textContent = state.clips.length ? `· ${fmt(total)}` : "";
      $("#track").innerHTML = state.clips.length ? state.clips.map((c) => `<button type="button" class="clip ${c.type === "video" ? "v" : "i"}" style="--d:${c.dur}" data-c="${c.id}" aria-pressed="${c.id === state.sel}">${esc(c.name)}</button>`).join("")
        : `<span class="note" style="padding:8px">Aucun clip. Touchez Importer des clips.</span>`;
      $$("[data-c]").forEach((b) => (b.onclick = () => { state.sel = b.dataset.c; draw(); }));
      const c = state.clips.find((x) => x.id === state.sel);
      $("#eframe").innerHTML = !c ? `<p>Importez un clip pour voir l’aperçu.</p>` : c.type === "video" ? `<video src="${c.url}" controls playsinline></video>` : `<img src="${c.url}" alt="${esc(c.name)}">`;
      $("#edel").disabled = !c;
    };
    $("#pname").oninput = (e) => (state.name = e.target.value);
    bindSeg("ratio", (v) => { state.ratio = v; $("#eframe").style.cssText = frameStyle(v); });
    $("#efile").onchange = async (e) => {
      for (const f of e.target.files) {
        const url = URL.createObjectURL(f), type = f.type.startsWith("video") ? "video" : "image";
        const dur = type === "video" ? await new Promise((ok) => { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => ok(v.duration || 3); v.onerror = () => ok(3); v.src = url; }) : 3;
        state.clips.push({ id: uid(), name: f.name, type, url, dur }); state.sel = state.clips.at(-1).id;
      }
      e.target.value = ""; draw();
    };
    $("#edel").onclick = () => {
      const c = state.clips.find((x) => x.id === state.sel); if (!c) return;
      URL.revokeObjectURL(c.url); state.clips = state.clips.filter((x) => x !== c); state.sel = state.clips.at(-1)?.id ?? null; draw();
    };
    $("#esave").onclick = () => {
      const ps = store.get("projects", []); state.pid ||= uid();
      const p = { id: state.pid, name: state.name.trim() || "Sans titre", ratio: state.ratio, clips: state.clips.length, at: Date.now() };
      store.set("projects", [p, ...ps.filter((x) => x.id !== p.id)]); toast("Projet enregistré.");
    };
    draw();
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
      $$("[data-open]").forEach((b) => (b.onclick = () => {
        const p = ps.find((x) => x.id === b.dataset.open); Object.assign(state, { pid: p.id, name: p.name, ratio: p.ratio, clips: [], sel: null });
        toast("Projet ouvert. Réimportez vos médias."); location.hash = "#/editor";
      }));
      $$("[data-rm]").forEach((b) => (b.onclick = () => { store.set("projects", ps.filter((x) => x.id !== b.dataset.rm)); draw(); }));
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

function route() {
  const id = location.hash.slice(2), name = views[id] ? id : "dashboard";
  $("#view").innerHTML = views[name].html(); views[name].bind();
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.v === name ? "page" : "false"));
  document.title = `${NAV.find((n) => n[0] === name)[1]} · Replica`; scrollTo(0, 0);
}
addEventListener("hashchange", route);
route();
