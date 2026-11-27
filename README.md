
# Replica

Studio de création vidéo et image avec IA, utilisable depuis un téléphone Android (web responsive, installable). Budget : 0 € par mois.

**Statut : version 0.4, en ligne et fonctionnelle.**
Site : https://replica-studio.pages.dev

## Ce que fait l'application

- **Images IA** : décrivez une image (français, arabe…) et elle est générée (FLUX.1 schnell via Cloudflare Workers AI), avec un quota quotidien.
- **Animer** : zoom et panoramique sur une image, puis export en vidéo MP4.
- **Éditeur** : import de vidéos et d'images, découpe début/fin, durée des images, texte, ordre des clips, export du montage avec le son.
- **Projets** : liste des projets enregistrés sur l'appareil.
- Formats 9:16, 16:9 et 1:1, export 720p.

## Organisation du dépôt

- `site/` : l'application web (HTML, CSS, JavaScript, sans outil de compilation).
- `worker/worker.js` : le Worker Cloudflare qui appelle le modèle d'images (il n'accepte que les requêtes venant du site).
- `replica/` : analyse des applications de référence, matrice des fonctionnalités et architecture.

## Documents

- [replica/recon.md](replica/recon.md) : écrans, parcours, données
- [replica/features.csv](replica/features.csv) : fonctionnalités et priorités
- [replica/architecture.md](replica/architecture.md) : architecture à 0 € et plan de route

## Principes

- Open source et services gratuits d'abord
- Aucun contournement d'abonnement ou de crédits d'un service existant
- Identité visuelle originale
- Aucune clé API ni capture d'écran des applications de référence dans ce dépôt
