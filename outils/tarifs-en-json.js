// Évalue les deux fichiers de tarifs en clair et écrit leur contenu en JSON sur la sortie standard.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8') + '\n;' + fs.readFileSync(process.argv[3], 'utf8') + '\n;({ grilles: GRILLES_REFERENCE, forfaits: FORFAITS })';
process.stdout.write(JSON.stringify((0, eval)(src)));
