# extension-ulyss

Extension de navigateur pour l'ERP Ulyss (Groupe Limo Dem) : chiffrage par grille et par forfait dans la pré-planification.

- `fichiers/` : les fichiers de l'extension tels que les postes les téléchargent pour se mettre à jour, et `version.json`
  (numéro de version, liste des fichiers, empreinte SHA-256 de chacun).
- `fichiers/tarifs.chiffre` : les grilles de prix et les forfaits, chiffrés (AES-256-GCM, clé dérivée du code d'accès par
  PBKDF2-SHA256). Illisible sans le code d'accès, qui n'est écrit nulle part dans ce dépôt.
- `outils/` : le script qui fabrique une publication à partir des sources.

Ce dépôt ne contient aucun tarif en clair. Ne jamais y ajouter `grilles.js`, `forfaits.js` ni le code d'accès.
