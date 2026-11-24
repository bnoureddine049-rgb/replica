# Journal de construction

- S08/S09/S10/S13 (éditeur) — 24/11/2026 — **partiel**
  - Fait : import vidéo/image, timeline (clips + texte), lecture, scinder, rogner, dupliquer, réordonner, supprimer, vitesse, cadrage, fondus, textes, annuler/rétablir, sauvegarde automatique (IndexedDB), export 720p/1080p avec son.
  - Manque : piste audio séparée, transitions autres que le fondu, filtres, sous-titres (S12), voix (S11), animation des textes.
  - Plus difficile que prévu : l'export. Il rejoue le montage en temps réel (MediaRecorder), donc il dure autant que la vidéo et l'écran doit rester allumé. Le passage à WebCodecs + Mediabunny est prévu pour l'accélérer.
  - Testé : Chromium headless (import, scinder, rogner, vitesse, annuler, texte, lecture, export 720p et 1080p avec son, annulation d'export, réouverture après rechargement). **Pas testé sur un vrai Android.**
