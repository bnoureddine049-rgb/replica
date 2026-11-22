# Recon — Studio vidéo/image IA (inspiré de CapCut Pro et Kling AI)

Date de l'analyse : 21 novembre 2026
Statut : **plan uniquement, aucun développement lancé.**

> **Honnêteté sur les sources.** Cette carte vient de sources publiques (pages d'aide, pages de tarifs, articles, docs de licences). Je n'ai pas observé les applications elles-mêmes. Les écrans et parcours ci-dessous sont donc **déduits** et marqués avec un niveau de confiance. Pour les confirmer, il faudra ouvrir CapCut et Kling avec **votre propre compte** et enregistrer vos captures dans `replica/screens/` (jamais livrées dans le produit).

## Règles du jeu (clean-room)

- On reconstruit des **fonctions et des parcours**, pas le code, ni les assets, ni les modèles propriétaires.
- Sources publiques et votre propre compte uniquement. Aucun contournement d'abonnement ou de crédits.
- Pas de lecture du code ni des appels réseau privés des applications.
- Les captures servent de référence de mise en page et ne vont jamais dans le produit.
- Identité visuelle **originale** : noms, logos, icônes, effets et sons du produit sont à créer.

---

## 1. Périmètre

| Question | Réponse |
|---|---|
| Quelle app, quelle plateforme | Un produit original inspiré de CapCut Pro (montage) et Kling AI (génération). Cibles : **web responsive (PWA)** puis **Android** |
| Quelle tranche | Boucle centrale : **idée → plans IA cohérents → montage → export vertical 1080p** |
| Pour qui | Votre propre produit, créateurs de contenu court (9:16 en priorité) |
| Contrainte majeure | **Budget 0 €/mois**, aucun abonnement obligatoire, open source et services gratuits d'abord |

---

## 2. Sources

| Source | Ce qu'elle apporte | URL | Statut |
|---|---|---|---|
| Aide CapCut Standard vs Pro | Liste des fonctions payantes | https://www.capcut.com/help/capcut-standard-vs-pro | lue (extrait) |
| Aide CapCut abonnements | Différences Standard / Pro | https://www.capcut.com/help/difference-between-standard-and-pro-subscription | lue (extrait) |
| Limites du plan gratuit CapCut | Quotas IA mensuels | https://flowith.io/blog/capcut-pricing-free-vs-pro-vs-team-paid-plan-worth-it | lue (tiers) |
| Guide Kling 3.0 | Multi-plans, audio natif, liaison de sujet | https://www.datacamp.com/tutorial/kling-3-0 | lue (tiers) |
| Coûts Kling 3.0 | Crédits par seconde et options | https://kling.ai/blog/kling-video-3-0-credit-cost-guide | lue (officiel) |
| Tarifs API Kling | API séparée de l'abonnement web | https://magichour.ai/blog/kling-ai-pricing | lue (tiers) |
| Modèles vidéo ouverts | Licences, VRAM, audio | https://ltx.io/blog/best-open-source-video-generation-models | lue (éditeur LTX, à recouper) |
| Modèles vidéo ouverts (comparatif) | Wan 2.2, LTX, Hunyuan, besoins GPU | https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models | lue (tiers) |
| Licences des modèles image | Qui est vraiment Apache 2.0 | https://invideo.io/blog/open-source-image-models-licenses/ | lue (tiers) |
| Modèles ouverts (voix, image) | Whisper, Kokoro, FLUX schnell | https://www.morphllm.com/open-source-ai-models | lue (tiers) |
| Workers AI, tarifs | 10 000 neurons/jour gratuits | https://developers.cloudflare.com/workers-ai/platform/pricing | lue (officiel) |
| Workers AI, changelog 28/07/2026 | Quelques modèles passent en payant | https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/ | lue (officiel) |
| GPU gratuits 2026 | Colab, Kaggle, ZeroGPU | https://gpuperhour.com/blog/free-cloud-gpus-and-credits | lue (tiers) |
| FAQ Colab | Usages interdits en offre gratuite | https://goo.gle/2wgbjec | lue (officiel) |
| Mediabunny | Bibliothèque média navigateur, MPL-2.0 | https://github.com/Vanilagy/mediabunny | lue (officiel) |
| Votre compte CapCut / Kling | Écrans réels, états, nombre de taps | — | **à faire par vous** |

Les prix et quotas changent souvent : à re-vérifier avant toute décision.

---

## 3. Inventaire des écrans

Les identifiants sont stables (S01, S02…) et utilisés par `features.csv` et `architecture.md`. Confiance : **M** = moyenne (déduit de descriptions publiques), à valider sur compte réel.

| ID | Écran | Accès | Utilité | Composants clés | États à enregistrer | Conf. |
|---|---|---|---|---|---|---|
| S01 | Accueil / Projets | Lancement de l'app | Reprendre ou créer un projet | Grille de projets, bouton « Nouveau », quota du jour | vide, chargé, hors-ligne | M |
| S02 | Nouveau projet | S01 → Nouveau | Choisir le format 9:16, 16:9 ou 1:1 | Cartes de format, sélecteur de durée | par défaut, erreur | M |
| S03 | Studio IA — Image | S01 ou S08 | Texte → image | Champ de prompt, styles, seed, grille de résultats | vide, en file, en cours, résultat, quota épuisé, refus de modération | M |
| S04 | Studio IA — Vidéo | S01 ou S08 | Texte → vidéo (ou clip animé) | Prompt, durée, format, modèle, estimation de coût | idem S03 + échec et remboursement | M |
| S05 | Animer une image | S03, S08 ou import | Image → vidéo | Image source, prompt de mouvement, intensité, modèle | idem S04 | M |
| S06 | Références visuelles | S04 ou S05 | Vidéo guidée par des images de référence | Slots de références, poids, aperçu | aucune référence, trop de références | M |
| S07 | Personnages | S03, S04, S06 | Garder un personnage cohérent | Fiche personnage, planche d'images, bouton « utiliser dans cette scène » | vide, planche générée, personnage verrouillé | M |
| S08 | Éditeur — timeline | S01 → projet | Monter | Aperçu, règle de temps, pistes vidéo/audio/texte, poignées de découpe | vide, chargé, long projet, mémoire faible | M |
| S09 | Découper / Fusionner | S08 | Couper, scinder, joindre des clips | Outils scinder / supprimer / dupliquer, magnétisme | sélection simple, multiple | M |
| S10 | Transitions, effets, filtres | S08 | Habiller les clips | Bibliothèque, curseur d'intensité, aperçu | aucun, appliqué, effet trop lourd | M |
| S11 | Audio | S08 | Musique, voix off, voix IA, bruitages | Enregistreur, texte → voix, bibliothèque libre de droits, volume | micro refusé, voix en cours, erreur | M |
| S12 | Sous-titres | S08 | Sous-titres auto et manuels | Transcription, éditeur de texte, styles | aucune parole, langue non supportée, résultat | M |
| S13 | Export | S08 | Rendre en 1080p max | Résolution, fréquence d'images, progression, partage | en cours, annulé, échec mémoire, terminé | M |
| S14 | Quotas et crédits | S01 ou toute génération | Transparence des coûts | Quota restant, historique, détail par génération | 0 restant, réinitialisation à minuit UTC | M |
| S15 | Bibliothèque et historique | S08 | Retrouver ses générations et imports | Grille d'assets, filtres, suppression | vide, plein (stockage) | M |
| S16 | Réglages | S01 | Langue, modèles, clés API perso | Sélecteur de modèle, champ de clé, thème | clé invalide, clé valide | M |
| S17 | Démarrage / connexion | Premier lancement | Compte et consentements | Connexion, consentement IA, âge | refusé, hors-ligne | M |

---

## 4. Parcours

**F01 — De l'idée à la vidéo exportée** (parcours principal)
S01 → S02 → S04 (génère 2–3 plans) → S08 (assemble) → S12 (sous-titres) → S13.
Cible à battre : **12 taps maximum** (à comparer avec le nombre réel sur CapCut/Kling).
Cas limites : quota du jour épuisé, génération refusée par la modération, projet interrompu, mémoire du téléphone saturée à l'export.

**F02 — Photo → animation → export vertical**
S05 → S08 → S13. Cible : **8 taps maximum**.
Cas limites : image trop petite, visage non reconnu, mouvement trop fort.

**F03 — Personnage cohérent sur 3 scènes**
S07 (créer la planche) → S04 (scène 1) → S04 (scène 2 avec le même personnage) → S08.
Cas limites : le personnage dérive entre deux plans, modèle sans référence d'image.

**F04 — Voix off + sous-titres**
S11 (texte → voix ou enregistrement) → S12 → S13.
Cas limites : micro refusé, langue mal détectée.

**F05 — Quota épuisé**
S14 → options : attendre la réinitialisation, utiliser sa propre clé API (S16), ou (plus tard) acheter des crédits.
Aucun paiement n'est obligatoire à aucune étape.

---

## 5. Composants

| Composant | Variantes | États | Écrans |
|---|---|---|---|
| Barre de navigation basse | 4–5 onglets | actif, inactif | S01, S03, S04, S14 |
| Bouton principal | plein, secondaire, destructif | normal, appuyé, désactivé, chargement | tous |
| Carte de format | 9:16, 16:9, 1:1 | sélectionnée | S02 |
| Champ de prompt | court, long, avec suggestions | vide, erreur, limite de caractères | S03–S06 |
| Sélecteur de modèle | gratuit, avec clé perso, premium (plus tard) | verrouillé, disponible | S03–S06, S16 |
| Estimation de coût | quota, crédits | suffisant, insuffisant | S03–S06 |
| Carte de génération | image, vidéo | en file, en cours, terminée, échec | S03–S06, S15 |
| Timeline | pistes vidéo, audio, texte | zoom, sélection, lecture | S08–S12 |
| Poignée de découpe | début, fin | glissement, magnétisme | S08, S09 |
| Panneau d'effets | transitions, filtres, effets | aperçu, intensité | S10 |
| Enregistreur vocal | — | autorisé, refusé, en cours | S11 |
| Éditeur de sous-titres | ligne, mot | édition, synchro | S12 |
| Feuille d'export | 720p, 1080p | progression, annulé, erreur | S13 |
| Jauge de quota | jour | plein, bas, vide | S01, S14 |
| Toast / message | info, erreur | affiché | tous |

---

## 6. Modèle de données (inféré, à confirmer)

| Entité | Champs principaux | Preuve | Confiance |
|---|---|---|---|
| User | id, email (optionnel), langue, créé_le | S17 | haute |
| Project | id, user_id, titre, format, durée, timeline_json, mis_à_jour | S01, S02, S08 | haute |
| Timeline (JSON) | pistes[], clips[], effets[], sous-titres[] | S08–S12 | moyenne |
| Asset | id, project_id, type (image/vidéo/audio), url, durée, origine (import/IA) | S15 | haute |
| Generation | id, type, prompt, modèle, statut, coût, asset_id, erreur | S03–S06 | haute |
| Character | id, user_id, nom, description, planche_asset_ids[], seed | S07 | moyenne |
| ReferenceSet | id, generation_id, asset_ids[], poids[] | S06 | faible |
| QuotaLedger | id, user_id, date, delta, raison, generation_id | S14 | haute |
| ProviderConfig | id, user_id, fournisseur, clé_chiffrée_locale | S16 | moyenne |
| ExportJob | id, project_id, résolution, statut, durée_rendu | S13 | haute |

Les montants de crédits sont **une unité interne** : à 0 €, un « crédit » est un quota gratuit du jour.

---

## 7. Matrice des fonctionnalités

Voir `features.csv` (colonnes : feature, area, priority, original, clone, notes). Toutes les lignes commencent avec `clone = no`. Les lignes `priority = skip` sont les exclusions (section 8).

---

## 8. Ce qui ne peut pas être cloné (ou pas à 0 €)

- **Les modèles propriétaires de Kling** : leur qualité n'est pas reproductible avec des modèles ouverts, seulement approchée.
- **Les bibliothèques de CapCut** : templates, effets, polices, musiques sous licence. On crée les nôtres ou on utilise du libre de droits.
- **L'intégration TikTok / ByteDance** et les 4K payants.
- **La capacité GPU hébergée** : générer de la vidéo IA pour des inconnus coûte du GPU, donc de l'argent (voir `architecture.md`).
- **Le clonage de voix** : exige consentement, et les bons modèles ont des licences à vérifier. Exclu du MVP.

---

## 9. Taille

| Mesure | Valeur |
|---|---|
| Écrans | 17 |
| Parcours | 5 |
| Entités | 10 |
| Points durs | timeline sur téléphone (performances et mémoire), export 1080p dans le navigateur, **vidéo IA à 0 €**, cohérence des personnages, quotas anti-abus |

**Taille globale : XL** (à découper). **MVP à 0 € : M** (quelques semaines), car la vidéo IA hébergée gratuitement n'est pas réaliste.

---

## Résumé en cinq lignes

1. **Boucle centrale** : idée → plans IA cohérents → montage → export 9:16 en 1080p.
2. **Volumes** : 17 écrans, 5 parcours, 10 entités.
3. **Trois points durs** : vidéo IA à 0 €, éditeur fluide sur téléphone, cohérence des personnages.
4. **Hors périmètre** : modèles propriétaires de Kling, bibliothèques CapCut, clonage de voix, paiement obligatoire.
5. **Étape suivante** : `architecture.md`, puis validation avec vous avant toute ligne de code.
