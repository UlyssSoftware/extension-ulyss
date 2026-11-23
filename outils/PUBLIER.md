# Publier une version

1. `publier.py` fabrique `publication/fichiers/` (tarifs chiffrés, `version.json` sans référence).
2. Copier tous les fichiers sauf `version.json` dans `fichiers/`, valider : c'est le commit des fichiers.
3. Écrire `fichiers/version.json` avec `"reference"` = l'empreinte complète de ce commit, valider, pousser `main`.

Les postes lisent `version.json` sur la branche `main` (dépôt brut), puis téléchargent chaque fichier par jsDelivr à cette référence :
`https://cdn.jsdelivr.net/gh/UlyssSoftware/extension-ulyss@<reference>/fichiers/<fichier>`.
GitHub brut ne convient pas pour les fichiers : il annonce tout en `text/plain`, et Chrome sous Windows enregistre alors
`content.js` sous le nom `content.txt`.
