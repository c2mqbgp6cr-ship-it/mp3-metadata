# MP3 Metadata

Application desktop locale (Electron + React) pour éditer les métadonnées
(Titre, Artiste, BPM, Cover carrée) de fichiers audio existants —
**MP3, WAV et FLAC** — sans jamais réencoder l'audio. Glisse un morceau,
édite ses tags sur sa page dédiée, exporte : le fichier d'origine est
modifié sur place.

## Architecture

- `server/` — API Node.js/Express locale (port 4321).
  - Tags : [`node-taglib-sharp`](https://github.com/benrr101/node-taglib-sharp),
    qui lit/écrit uniquement le conteneur de métadonnées adapté à chaque
    format (ID3v2 pour MP3 et WAV, Xiph Comment + bloc image pour FLAC).
    `file.save()` ne réécrit que ce conteneur ; les échantillons audio sont
    recopiés tels quels, jamais recompressés.
  - Cover : [`sharp`](https://sharp.pixelplumbing.com/) recadre l'image en
    carré strict et l'optimise (voir plus bas) avant de l'embarquer.
- `client/` — Interface React (Vite). Zone de glisser-déposer + page
  d'édition en plein écran avec upload/glisser-déposer de cover.
- `electron/` — Coquille desktop (`main.js` + `preload.js`) qui ouvre une
  vraie fenêtre native chargeant l'interface React, et expose de façon
  sécurisée `webUtils.getPathForFile` pour retrouver le chemin absolu d'un
  fichier glissé depuis le Finder (indispensable : un navigateur classique
  ne donne jamais ce chemin, une app web seule ne pourrait pas écrire sur
  le disque).

Les fichiers modifiés sont **écrits directement sur le disque**, à l'endroit
où ils se trouvent (aucune copie n'est créée).

## Formats supportés

| Format | Conteneur de tags        |
|--------|---------------------------|
| MP3    | ID3v2                     |
| WAV    | ID3v2 (chunk `id3 `)      |
| FLAC   | Xiph Comment + picture block |

## Optimiseur de cover

Quand tu déposes une image de cover, elle est :
1. recadrée en carré strict (centrée sur le plus petit côté) ;
2. réencodée en JPEG (meilleur compromis taille/qualité pour une pochette
   photo) via `sharp`/mozjpeg, en testant plusieurs tailles (jusqu'à
   1400×1400 px) et niveaux de qualité, du plus qualitatif au plus
   compressé, jusqu'à repasser sous la barre des **500 Ko** ;
3. embarquée dans le fichier, avec un retour affiché dans l'app
   (dimensions finales + poids).

Testé avec une image "pire cas" volontairement incompressible (bruit pur,
2400×1600, 5 Mo) : résultat 1400×1400, ~480 Ko, en un seul export — pour
une vraie photo de pochette le résultat est encore meilleur.

## Prérequis

- Node.js ≥ 18 (testé avec Node 22)
- macOS (l'app a été scaffoldée pour tourner sur ta machine)

## Premier lancement

Ouvre un Terminal **sur ta machine** (pas dans Cowork) à la racine du projet,
puis :

```bash
npm install --prefix server
npm install --prefix client
npm install
```

`npm install` télécharge Electron (~150-300 Mo) au premier lancement — prévois
une connexion internet pour cette étape.

## Lancer l'app

```bash
npm run dev:electron
```

Cela démarre en parallèle : le serveur API (`localhost:4321`), le serveur
de développement React/Vite (`localhost:5173`), puis ouvre la fenêtre
Electron une fois les deux prêts.

Tu peux aussi prévisualiser juste l'interface dans un navigateur classique
avec `npm run dev` (mais le glisser-déposer n'y écrira rien sur le disque —
seule la fenêtre Electron a accès au vrai chemin des fichiers).

## Utilisation

1. Glisse un ou plusieurs fichiers `.mp3` / `.wav` / `.flac` dans la zone
   prévue (ou clique pour les choisir via un sélecteur).
2. Une page d'édition s'ouvre automatiquement pour le morceau déposé (bouton
   "← Retour" en haut pour revenir à l'accueil — une confirmation est
   demandée si tu as des modifications en cours).
3. Modifie Titre / Artiste / BPM, et/ou dépose une image de
   cover (recadrée et optimisée automatiquement, voir plus haut).
4. Une carte affiche le nom du fichier sans extension avec un bouton
   "Copier" — utile pour le coller ailleurs (Trackstack, un DAW, etc.) sans
   action supplémentaire.
5. Clique sur "Exporter" : les tags sont écrits directement dans le fichier
   d'origine, l'audio reste strictement identique.
6. Si le fichier est un FLAC, un bloc "Exporter dans un autre format"
   propose de générer une copie WAV et/ou MP3 à côté de l'original (voir
   plus bas) — l'original n'est jamais touché par cette opération. Les
   sources MP3 n'affichent pas ce bloc (voir la section export ci-dessous).

## Export vers un autre format (WAV / MP3)

Pour un fichier source FLAC, l'app propose de créer une copie dans un
autre format, dans le même dossier que l'original (jamais un remplacement) :

- **FLAC** → export possible en WAV (décompression sans perte, PCM
  bit-à-bit identique) ou en MP3 (encodage `libmp3lame`, VBR haute qualité).

Les sources MP3 n'ont aucune option d'export : décoder un MP3 (déjà avec
pertes) en WAV n'apporte aucune amélioration de qualité, et MP3→MP3 n'a pas
de sens.

Le fichier exporté reprend automatiquement les tags actuels (Titre,
Artiste, BPM, Cover). En cas de collision de nom, un suffixe
`(export)` est ajouté plutôt que d'écraser un fichier existant.

Cette fonctionnalité utilise [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)
(binaire ffmpeg embarqué automatiquement à l'installation, pas besoin
d'installer ffmpeg toi-même). Si tu préfères utiliser un ffmpeg déjà
installé sur ta machine, tu peux définir la variable d'environnement
`FFMPEG_PATH` avant de lancer le serveur.

## API (serveur local, port 4321)

- `GET /api/health` — vérifie que le serveur tourne, liste les formats supportés.
- `GET /api/track?path=<chemin>` — tags complets + cover (base64) d'un fichier.
- `PUT /api/track` — body JSON `{ path, title, artist, bpm?, cover?, removeCover? }`.
  Met à jour uniquement les tags fournis, optimise et embarque la cover si
  fournie. Répond avec le résumé des tags à jour et, si une cover a été
  traitée, `coverInfo` (`{ width, height, quality, bytes, mime }`).
- `POST /api/convert` — body JSON `{ path, format: "wav" | "mp3" }`. Crée une
  copie convertie à côté de l'original (voir plus haut), n'existe que pour
  les sources FLAC. Répond `{ path, fileName }` du fichier créé.

## Champs de tags utilisés

| Champ UI | MP3 / WAV (ID3v2) | FLAC (Xiph Comment) |
|----------|--------------------|-----------------------|
| Titre    | TIT2               | TITLE                 |
| Artiste  | TPE1               | ARTIST                |
| BPM      | TBPM               | BPM                    |
| Cover    | APIC               | METADATA_BLOCK_PICTURE |

## Notes

- Seuls `.mp3`, `.wav` et `.flac` sont acceptés côté serveur (vérification
  par extension avant toute écriture).
- Aucune conversion de format n'est effectuée : le fichier reste dans son
  format d'origine, seul le conteneur de métadonnées est modifié. Vérifié
  en pratique : comparaison du flux PCM décodé avant/après écriture des
  tags, sur les trois formats → identique bit à bit.
- `node_modules` n'est pas versionné (exclu par `.gitignore`, comme
  `dist/`). Le premier `npm install` télécharge les binaires natifs
  (Electron, Vite/Rolldown, sharp) pour ta plateforme — prévois une
  connexion internet pour cette étape.

## Prochaine étape possible

- Empaqueter l'app en `.app`/`.dmg` installable (via `electron-builder`)
  pour ne plus dépendre de `npm run dev:electron`.

## Licence

[MIT](./LICENSE) — utilisation, copie et modification libres.

## Thème

Un bouton en haut à droite ("☀️ Clair" / "🌙 Sombre") bascule entre thème
sombre (par défaut) et thème clair. Le choix est mémorisé localement
(`localStorage`) ; au tout premier lancement, l'app respecte la préférence
système (clair/sombre) de macOS.

## Journal des changements

- 2026-08-26 — Création initiale : liste de dossier, édition Titre/Sous-titre/
  Artiste, upload + recadrage automatique de cover carrée, écriture des tags
  ID3 sans toucher à l'audio.
- 2026-08-26 — Passage à une vraie app desktop Electron (fenêtre native au
  lieu d'un onglet navigateur) + refonte de l'UX : zone de glisser-déposer
  au lieu d'un sélecteur de dossier, panneau latéral d'édition, bouton
  "Exporter".
- 2026-08-26 — Optimiseur de cover automatique (recadrage carré strict,
  réencodage JPEG optimisé, plafond 500 Ko) et support des formats WAV et
  FLAC en plus du MP3, via migration de `node-id3` vers `node-taglib-sharp`
  (support ID3v2 + Xiph Comment). Vérifié : audio bit-à-bit identique
  avant/après sur les trois formats.
- 2026-08-26 — Thème clair, avec bouton de bascule dans l'en-tête et
  préférence mémorisée localement.
- 2026-08-26 — Panneau latéral transformé en page complète (avec bouton
  "← Retour"). Ajout du champ BPM (TBPM / BPM selon le format). Ajout d'une
  carte "Nom de fichier" avec bouton de copie (sans extension). Ajout de
  l'export vers un autre format (WAV/MP3) pour les sources MP3/FLAC, via
  ffmpeg (`ffmpeg-static`), avec report automatique des tags sur le fichier
  exporté. Vérifié : FLAC→WAV bit-à-bit identique en PCM, export MP3→WAV et
  FLAC→MP3 fonctionnels, fichier d'origine jamais modifié par l'export.
- 2026-08-26 — Refonte UI/UX dans le langage visuel iOS récent ("Liquid
  Glass") : en-têtes en verre dépoli (blur + saturation) collées en haut,
  coins continus, boutons pill, listes groupées façon Réglages iOS pour les
  champs de tags / la carte fichier / les exports, bouton retour et bouton
  thème circulaires. Vérifié visuellement en thème clair et sombre.
- 2026-08-27 — Suppression de la liste des morceaux déjà ouverts : l'accueil
  n'affiche plus que la zone de glisser-déposer. Ajout d'une modale de
  confirmation ("Revenir à l'accueil ?") au clic sur "← Retour". Agrandissement
  de la carte de cover et déplacement de la carte d'info (copie du nom de
  fichier) juste en dessous.
- 2026-08-27 — Retrait de l'option "Exporter en WAV" pour les sources MP3 :
  décoder un MP3 (déjà avec pertes) en WAV n'apporte aucune amélioration de
  qualité, donc les fichiers MP3 n'affichent plus aucune option d'export. Seules
  les sources FLAC proposent encore l'export WAV et MP3. Changement appliqué
  côté frontend (`TrackPage.jsx` → `convertTargets`) et côté backend
  (`server/index.js` → `CONVERT_TARGETS_BY_SOURCE`, validation par extension
  source). Vérifié par API : MP3→WAV rejeté, FLAC→WAV et FLAC→MP3 toujours
  fonctionnels.
- 2026-08-27 — Suppression complète du champ Sous-titre (formulaire, API, tags
  TIT3/SUBTITLE écrits sur les fichiers, copie exportée en WAV/MP3,
  documentation). L'app ne gère plus que Titre / Artiste / BPM / Cover.
- 2026-08-27 — Titre et Artiste sont désormais obligatoires : le bouton
  "Exporter" reste désactivé tant que l'un des deux est vide (astérisque rouge
  sur les deux champs, message d'aide en bas de page). Même règle appliquée côté
  serveur (`PUT /api/track` rejette la requête si le titre ou l'artiste
  résultant est vide/blanc), pour ne pas pouvoir la contourner via l'API.
- 2026-08-27 — Ajout d'une liste "Réutiliser un morceau récent" en haut de la
  page d'édition : chaque export réussi (titre, artiste, BPM, cover) est gardé
  en mémoire pour la session en cours (jamais persisté sur disque — vidé à la
  fermeture de l'app). En cliquant sur une entrée, ses valeurs sont appliquées
  instantanément au fichier actuellement ouvert, sans rien écrire tant que
  "Exporter" n'est pas cliqué — utile pour retaguer plusieurs fichiers du même
  morceau (ex. export WAV + MP3) sans ressaisir deux fois les mêmes infos.
- 2026-08-27 — La zone de cover accepte désormais le glisser-déposer directement
  dessus (plus besoin de passer par "Choisir une image") : retour visuel pendant
  le survol, recadrage carré et optimisation automatiques identiques au
  sélecteur de fichier, et rejet propre (message d'erreur, cover existante
  conservée) si le fichier déposé n'est pas une image.
- 2026-08-27 — Passage en revue avant publication publique sur GitHub : le
  serveur local n'écoutait que sur `http://localhost:4321` mais sans le préciser
  au niveau du bind réseau, donc était en réalité joignable depuis tout le
  réseau local — corrigé en le liant explicitement à `127.0.0.1`. Nettoyage du
  dépôt (assets Vite par défaut inutilisés, README client générique, build
  `dist/` non versionné), ajout d'une licence MIT, et corrections de
  documentation obsolète (mentions d'un panneau latéral et d'une liste de
  morceaux, tous deux remplacés depuis).
