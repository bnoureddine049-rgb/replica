const ALLOWED = ["https://replica-studio.pages.dev"];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "Utilisez POST." }, 405);
    if (!ALLOWED.includes(origin)) return json({ error: "Origine non autorisée." }, 403);

    let prompt = "";
    try { prompt = String((await request.json()).prompt || "").trim(); } catch {}
    if (!prompt) return json({ error: "Description vide." }, 400);
    if (prompt.length > 400) return json({ error: "Description trop longue (400 caractères max)." }, 400);

    try {
      // Les modèles comprennent mieux l'anglais : on traduit si le texte contient de l'arabe.
      if (/[\u0600-\u06FF]/.test(prompt)) {
        const t = await env.AI.run("@cf/meta/m2m100-1.2b", { text: prompt, source_lang: "arabic", target_lang: "english" });
        if (t && t.translated_text) prompt = t.translated_text;
      }
      const out = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt, steps: 4 });
      return json({ image: "data:image/jpeg;base64," + out.image, prompt });
    } catch (e) {
      return json({ error: "Génération impossible pour le moment (quota du jour peut-être épuisé)." }, 503);
    }
  },
};
