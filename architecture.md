# Architecture détaillée — version 0 €/mois

Date : 21 novembre 2026. Statut : **proposition à valider, aucun code écrit.**
Les encadrés « **En clair** » expliquent chaque partie simplement.

---

## 0. La vérité sur le 0 €

Ce qui est possible gratuitement, et ce qui ne l'est pas :

| Fonction | Possible à 0 € ? | Comment | Limite honnête |
|---|---|---|---|
| Montage (couper, assembler, texte, audio) | **Oui** | Dans le navigateur du téléphone | Performances limitées sur téléphone modeste |
| Export 1080p | **Oui** | Encodage local (WebCodecs) | Durée de projet limitée par la mémoire |
| Sous-titres auto | **Oui** | Whisper (Apache 2.0) sur l'appareil | Premier téléchargement du modèle, un peu lent |
| Voix IA | **Oui, à tester** | Kokoro (Apache 2.0) sur l'appareil | À valider sur Android |
| Images IA | **Oui, en petit volume** | FLUX.1-schnell sur Cloudflare Workers AI | Quota gratuit **partagé** par toute l'app (voir §4) |
| Animation d'une image | **Oui, version simple** | Zoom / parallaxe 2.5D locale | Ce n'est **pas** de l'animation réaliste |
| Image → vidéo IA réaliste | **Pas pour le public** | Atelier Kaggle (vous) ou clé API perso | Pas de service gratuit illimité |
| Texte → vidéo IA | **Pas pour le public** | Idem | Idem |
| Cohérence des personnages | **Partiellement** | Planche de référence + seed | Pas de garantie |

Les raisons clés, sources à l'appui :
- Cloudflare offre **10 000 « neurons » par jour gratuits**, avec un tarif publié par modèle (source : developers.cloudflare.com/workers-ai/platform/pricing). Le 28/07/2026 quelques gros modèles texte sont passés en payant ; FLUX.1-schnell n'est pas dans cette liste (source : changelog Cloudflare).
- Les GPU gratuits (Colab, Kaggle) sont des **carnets de notes interactifs** : environ 30 h de GPU par semaine sur Kaggle, quota non garanti. La FAQ Colab interdit en offre gratuite les services web non liés au calcul interactif. **On ne les utilisera donc jamais comme serveur pour d'autres personnes.**

**En clair :** tout ce qui tourne *sur votre téléphone* est gratuit. Tout ce qui demande un gros GPU à distance ne l'est pas. On construit donc un studio de montage solide, et on branche la vidéo IA par des portes que vous ouvrez vous-même.

---

## 1. Vue d'ensemble

```
┌─────────────────────────── TÉLÉPHONE (PWA, Chrome Android) ──────────────────────────┐
│  Interface React  ─  Éditeur timeline  ─  Export (WebCodecs + Mediabunny)             │
│  Whisper local (sous-titres)  ─  Kokoro local (voix)  ─  Animation 2.5D (WebGL)      │
│  Stockage local : projets, assets, historique (IndexedDB / OPFS)                       │
│  Clés API perso (optionnelles), jamais envoyées à nos serveurs                         │
└───────────────┬───────────────────────────────────────────────────────────────────────┘
                │  requêtes IA uniquement
┌───────────────▼───────────── EDGE GRATUIT (Cloudflare Workers) ──────────────────────┐
│  Garde-fous : Turnstile (anti-robot) + quota par utilisateur + quota global           │
│  Registre de quotas (base gratuite)  ─  Modération du prompt                          │
│  Routeur de fournisseurs  ─►  [Adaptateur Workers AI]  (gratuit, actif)               │
│                           ─►  [Adaptateur clé perso]    (gratuit pour nous)           │
│                           ─►  [Adaptateur Kling API…]   (désactivé, plus tard)        │
└───────────────────────────────────────────────────────────────────────────────────────┘
       Option hors serveur : « Atelier Kaggle » (notebook que VOUS lancez sur VOTRE compte)
```

**En clair :** le téléphone fait presque tout. Un petit programme gratuit sur Internet (un « Worker ») sert seulement de portier pour l'IA : il vérifie le quota, filtre les demandes, puis appelle le bon service.

---

## 2. Choix techniques (et pourquoi)

| Couche | Choix | Licence | Pourquoi |
|---|---|---|---|
| Application | **PWA** (site installable sur Android) en React + TypeScript | MIT | Un seul code pour web et Android, gratuit, pas de Play Store obligatoire |
| Médias | **WebCodecs + Mediabunny** | MPL-2.0 (usage commercial permis, publication de vos modifications du code de la bibliothèque seulement) | Encodage matériel sur téléphone, pas besoin de ffmpeg lourd |
| Rendu | WebGL / Canvas | — | Filtres, transitions, animation 2.5D |
| Sous-titres | Whisper (via bibliothèque navigateur) | Apache 2.0 | Local, sans quota |
| Voix | Kokoro-82M | Apache 2.0 | Petit, local |
| Images | FLUX.1-schnell via Workers AI | Apache 2.0 | Rapide, quota gratuit quotidien |
| Hébergement | **Cloudflare Pages** + Workers (compte gratuit) | — | Gratuit, déploiement auto depuis GitHub |
| Code | **GitHub** (dépôt public) | — | Gratuit, travail depuis le navigateur du téléphone |
| Vidéo IA ouverte | Wan 2.2 (Apache 2.0, pas d'audio natif) | Apache 2.0 | Seul grand modèle vidéo ouvert à licence sans restriction ; tourne dès ~8 Go de VRAM en 720p (variante 5B quantifiée) |

Modèles écartés pour cette phase :
- **FLUX.1-dev** : licence non commerciale pour le modèle.
- **LTX-2.3** : bon (image + son), mais licence gratuite seulement sous 10 M$ de revenus ; à reconsidérer plus tard.
- **HunyuanVideo** : licence communautaire Tencent, plus lourd.

**En clair :** on choisit des briques « sans mauvaise surprise de licence », même si certaines sont un peu moins impressionnantes.

---

## 3. Le montage (cœur du produit)

### 3.1 Format de projet (partagé web / Android)

Un projet = un fichier JSON. C'est ce qui permettra d'ouvrir le même projet partout.

```json
{
  "version": 1,
  "format": "9:16",
  "fps": 30,
  "tracks": [
    { "id": "v1", "type": "video", "clips": [
      { "id": "c1", "assetId": "a1", "start": 0.0, "in": 0.0, "out": 4.0,
        "speed": 1.0, "effects": [], "transitionOut": { "type": "fade", "dur": 0.3 } }
    ]},
    { "id": "a1", "type": "audio", "clips": [] },
    { "id": "t1", "type": "text",  "clips": [] }
  ],
  "subtitles": [ { "start": 0.0, "end": 1.8, "text": "Bonjour" } ]
}
```

### 3.2 Export 1080p

1. Pour chaque image de la timeline, on compose les couches (vidéo + texte + effets) dans un canvas.
2. WebCodecs encode en H.264 matériel quand c'est possible.
3. Mediabunny assemble l'image et le son dans un fichier MP4.
4. Tailles : 9:16 → 1080×1920, 16:9 → 1920×1080, 1:1 → 1080×1080.

Limites à connaître : mémoire du téléphone, durée de projet (je vise 2–3 minutes au départ), et téléphones anciens qui ne supportent pas tous les encodeurs. On prévoit un export 720p de secours.

**En clair :** l'export fabrique la vidéo image par image directement dans votre téléphone, sans envoyer vos vidéos sur Internet.

---

## 4. Images IA et quotas

### Calcul d'ordre de grandeur (à vérifier par un test réel)

Le tarif publié de FLUX.1-schnell est de 4,8 neurons par tuile de 512×512 et 9,6 neurons par étape. Une image 1024×1024 en 4 étapes ≈ 4×4,8 + 4×9,6 ≈ **58 neurons**, donc environ **170 images par jour pour toute l'application** (10 000 neurons).

Conséquence : si 100 personnes utilisaient l'app, chacune aurait ~1 image par jour. Il faut donc :
- un **quota par utilisateur** petit (par ex. 5 images/jour au début) ;
- un **quota global** qui coupe proprement quand le plafond est atteint (message clair, pas d'erreur) ;
- une **porte de sortie** : la clé personnelle (§6). Chaque personne a alors **sa propre** allocation gratuite chez le fournisseur.

### Registre de quotas

| Table | Champs |
|---|---|
| quota_ledger | id, user_id, date_utc, delta, raison, generation_id |
| generations | id, user_id, type, modèle, statut, coût, créé_le |

- Débit **seulement après succès** ; échec = rien n'est débité.
- Réinitialisation quotidienne à 00:00 UTC (comme Cloudflare).
- Le registre existe dès le jour 1 pour que les **crédits payants** s'y branchent plus tard sans tout refaire.

### Garde-fous du Worker (dans cet ordre)

1. Vérifier le jeton **Turnstile** (anti-robot gratuit).
2. Vérifier le quota de l'utilisateur.
3. Vérifier le quota global du jour.
4. Modérer le prompt.
5. Seulement ensuite, appeler le modèle.

Ainsi le pire coût possible est un nombre **que vous avez choisi**, pas un attaquant.

**En clair :** un quota est comme un ticket de cantine : un petit nombre par jour, gratuit. Si l'app devient populaire, on ajoutera des tickets payants, mais rien n'oblige à payer aujourd'hui.

---

## 5. Vidéo IA à 0 € : trois portes

| Porte | Qui paie | Comment | Qualité | Limite |
|---|---|---|---|---|
| **A. Animation 2.5D locale** | Personne | L'image est animée (zoom, déplacement, parallaxe) sur le téléphone | Simple, stylisée | Pas de mouvement réaliste. Étiquetée « animation simple » |
| **B. Atelier Kaggle** | Vous (gratuit, quota perso) | Un notebook prêt à l'emploi lance Wan 2.2 sur **votre** compte Kaggle ; vous importez le MP4 dans l'app | Bonne, 720p | Quelques minutes par clip de 5 s (ordre de grandeur), ~30 h GPU/semaine, usage interactif seulement, pas d'automatisation pour d'autres |
| **C. Clé API perso** | Chaque utilisateur, selon son fournisseur | Vous collez votre clé (S16) ; l'app appelle le fournisseur directement | Variable (peut être élevée) | Dépend des conditions du fournisseur ; peut être payant |

Règles :
- On **n'utilise pas** Colab ou Kaggle comme backend pour le public (interdit ou non fiable).
- On **ne contourne** aucun quota : un compte par personne.
- Le jour où vous aurez un budget : l'adaptateur Kling API (ou autre) s'allume, **sans changer l'interface**.

**En clair :** pour la vraie vidéo IA, soit vous la fabriquez vous-même gratuitement sur Kaggle, soit on branche plus tard un service payant. À 0 €, personne ne peut offrir du GPU gratuit à tout le monde.

---

## 6. Évolutivité : les adaptateurs

Chaque fournisseur d'IA est un « adaptateur » qui parle la même langue :

```ts
type Cost = { unit: "quota" | "credits" | "usd"; amount: number };

interface GenerationProvider {
  id: string;                       // "workers-ai", "byok-hf", "kling-api"
  kind: "image" | "video" | "audio";
  enabled(): boolean;               // interrupteur
  estimate(req: GenRequest): Cost;  // affiché AVANT de lancer
  submit(req: GenRequest): Promise<JobHandle>;
  poll(job: JobHandle): Promise<JobStatus>; // en file | en cours | prêt | échec
  cancel(job: JobHandle): Promise<void>;
}
```

| Adaptateur | État au lancement |
|---|---|
| workers-ai (FLUX.1-schnell) | **actif** |
| byok (clé perso) | **actif** (optionnel) |
| kling-api, autres API officielles | **désactivé** (prêt à brancher) |

Pour la cohérence des personnages, on testera aussi le modèle FLUX.2 klein 4B (Apache 2.0) qui accepte une image en entrée, déjà proposé sur Cloudflare. Je ne sais pas encore si son coût en neurons tient dans le quota gratuit : **à tester avant de promettre quoi que ce soit.**

**En clair :** c'est comme une multiprise. Aujourd'hui on branche deux prises gratuites. Demain on pourra en brancher d'autres sans refaire la maison.

---

## 7. Cohérence des personnages

1. S07 : vous décrivez le personnage ; l'app génère une **planche** (face, profil, plusieurs expressions).
2. Vous verrouillez une image + une description fixe + un seed.
3. Pour chaque scène, la description fixe est ajoutée au prompt ; selon le modèle, l'image de référence est aussi envoyée.
4. Pour enchaîner deux plans, la dernière image du plan N devient l'image de départ du plan N+1.

Limite honnête : sans modèle à référence d'image ni liaison de sujet, la cohérence reste **approximative**. La version solide viendra avec une API officielle (plus tard).

---

## 8. Développer depuis un téléphone Android

Faisable, mais il faut le savoir : écrire une grosse application depuis un téléphone est lent et fatigant.

| Besoin | Outil gratuit | Remarque |
|---|---|---|
| Garder le code | GitHub (site mobile) | Dépôt public |
| Modifier des fichiers | Éditeur web GitHub | Petit écran, mais ça marche pour les retouches |
| Publier le site | Cloudflare Pages relié à GitHub | Publication automatique à chaque modification |
| Tester | Chrome Android | Installer la PWA sur l'écran d'accueil |
| Application Android « store » | Plus tard | Publier sur Google Play a un **frais unique** (montant à vérifier). Une PWA ou un APK direct reste gratuit |

Je génère les fichiers ; vous les envoyez dans GitHub. À l'étape 1, on choisira la méthode la plus simple pour vous (envoi de fichiers, ou autre).

---

## 9. Plan de route

| Phase | Contenu | Coût | Durée indicative |
|---|---|---|---|
| **0 — Validation** (maintenant) | Vous relisez ces 3 fichiers, choisissez le nom, la charte, le mode de travail | 0 € | quelques jours |
| **1 — MVP** | PWA : projets locaux, timeline, découpe/fusion, texte, audio, sous-titres Whisper, images IA (quota), animation 2.5D, export 720p/1080p | 0 € | quelques semaines |
| **2 — Voix et IA ouverte** | Kokoro, planche personnage, clé perso, Atelier Kaggle (Wan 2.2) | 0 € | quelques semaines |
| **3 — Android et premium** | Emballage Android, adaptateurs API officielles, crédits payants (Google Play Billing sur Android) | selon budget | à définir |

Critère de succès du MVP : un parcours complet **F01** de bout en bout en moins de 12 taps.

---

## 10. Conformité et sécurité (dès le MVP)

- **Aucun contournement** d'abonnement, de crédits ou de limites d'un service.
- **Étiquette IA** sur les contenus générés (métadonnée + mention dans l'app).
- **Modération** des prompts avant tout appel.
- **Voix** : aucun clonage, consentement requis pour toute voix imitée.
- **Clés API perso** : stockées sur l'appareil, jamais envoyées à nos serveurs, jamais journalisées.
- **Données** : projets stockés localement ; aucun compte obligatoire au début.
- **Licences** : fichier `THIRD_PARTY_LICENSES` tenu à jour (Mediabunny MPL-2.0, modèles Apache 2.0).
- **Musique** : uniquement CC0 / libre de droits, avec la source notée.

---

## 11. Identité visuelle (brief)

- **Ton** : professionnel, calme, créatif. Interface **sombre** avec une couleur d'accent chaude et unique.
- **À créer d'abord** : nom (vérifier qu'il est libre : marques et noms de domaine), logo, palette, icônes, typographie libre (OFL).
- **À éviter** : tout ce qui ressemble aux logos, icônes ou interfaces de CapCut ou Kling.
- **Principes mobiles** : zones tactiles ≥ 44 px, actions principales en bas de l'écran, timeline lisible au pouce.

---

## 12. Risques principaux

| Risque | Gravité | Réponse |
|---|---|---|
| Quota gratuit global trop petit | Haute | Quotas par utilisateur, clé perso, message clair |
| Éditeur lent sur téléphones modestes | Haute | Aperçu basse résolution, projets courts, export 720p de secours |
| Vidéo IA attendue « comme Kling » | Haute | Dire clairement ce qui est local, simple, ou premium |
| Changement de prix ou de quotas des services gratuits | Moyenne | Adaptateurs remplaçables, vérification régulière |
| Licences de modèles | Moyenne | Apache 2.0 d'abord, fichier de licences |
| Travail depuis un téléphone | Moyenne | Petites étapes, fichiers prêts à envoyer |

---

## Glossaire

- **PWA** : un site web qu'on installe sur l'écran d'accueil comme une application.
- **Worker** : petit programme hébergé gratuitement qui répond à l'application.
- **Quota** : nombre gratuit de générations par jour.
- **BYOK** : « apportez votre propre clé » d'un service d'IA.
- **Adaptateur** : pièce qui connecte un fournisseur d'IA à l'application.
- **Neuron** : unité de calcul de Cloudflare ; 10 000 sont offerts par jour.
