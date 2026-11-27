// Moteur de calcul v2 : des lignes de moyens, une grille de référence, une saison.
var HEURES_PAR_JOUR = 8;
var CAPACITES = [20, 40, 50, 60, 100];
var CASES = [
  ['loc', 'Location de matériel'], ['mm', 'Monte-meuble'], ['mo', 'Main d\'oeuvre'], ['dep', 'Frais de déplacement'],
  ['veh', 'Véhicules'], ['emb', 'Fourniture d\'emballage'], ['pan', 'Panneaux de stationnement']
];
var TYPES = [{ id: 'homme', label: 'Homme', unite: 'j', cas: 'mo', pu: function (g, s) { return g.homme[s]; } }];
CAPACITES.forEach(function (c, k) {
  TYPES.push({ id: 'v' + c, label: 'Véhicule ' + c + ' m³', unite: 'j', cas: 'veh', coef: true, pu: function (g, s) { return g.veh[k][0] * g.coef[s]; } });
});
CAPACITES.forEach(function (c, k) {
  TYPES.push({ id: 'k' + c, label: 'Kilomètres, véhicule ' + c + ' m³', unite: 'km', cas: 'veh', coef: true, pu: function (g, s) { return g.veh[k][1] * g.coef[s]; } });
});
// Camionnette (type « CAM » d'Ulyss, genre Vito : peu de volume utile, amène des hommes et du matériel ou tracte un monte-meuble
// remorqué) — 27/11/2026. Tarif propre [jour, km] dans la grille ; valeurs de départ si la grille du poste ne l'a pas encore.
var CAM_DEFAUT = [80, 0.5];
TYPES.push(
  { id: 'vcam', label: 'Camionnette (CAM)', unite: 'j', cas: 'veh', coef: true, pu: function (g, s) { return (g.cam || CAM_DEFAUT)[0] * g.coef[s]; } },
  { id: 'kcam', label: 'Kilomètres, camionnette (CAM)', unite: 'km', cas: 'veh', coef: true, pu: function (g, s) { return (g.cam || CAM_DEFAUT)[1] * g.coef[s]; } }
);
TYPES.push(
  { id: 'mm', label: 'Monte-meubles', unite: 'j', cas: 'mm', pu: function (g) { return g.mm[0]; } },
  { id: 'mmkm', label: 'Kilomètres, monte-meubles', unite: 'km', cas: 'mm', pu: function (g) { return g.mm[1]; } },
  { id: 'mmp', label: 'Monte-meubles porteur', unite: 'j', cas: 'mm', pu: function (g) { return g.mmPorteur[0]; } },
  { id: 'mmpkm', label: 'Kilomètres, monte-meubles porteur', unite: 'km', cas: 'mm', pu: function (g) { return g.mmPorteur[1]; } },
  { id: 'mmext', label: 'Monte-meubles en location extérieure', unite: 'u', cas: 'mm', pu: function (g) { return g.mmExt; } },
  { id: 'loc', label: 'Location de matériel', unite: 'm³', cas: 'loc', pu: function (g) { return g.location; } },
  { id: 'emb', label: 'Emballage perdu', unite: 'm³', cas: 'emb', pu: function (g) { return g.emballage; } },
  { id: 'nuit', label: 'Nuit', unite: 'u', cas: 'dep', pu: function (g) { return g.nuit; } },
  { id: 'repas', label: 'Repas du soir', unite: 'u', cas: 'dep', pu: function (g) { return g.repas; } },
  { id: 'p87', label: 'Panneaux en Haute-Vienne', unite: 'u', cas: 'pan', pu: function (g) { return g.pan87; } },
  { id: 'phors', label: 'Panneaux hors Haute-Vienne', unite: 'u', cas: 'pan', pu: function (g) { return g.panHors; } },
  { id: 'gar', label: 'Garantie contractuelle', unite: '€ déclarés', cas: 'mo', pu: function (g) { return g.garantie; } },
  // Item préconfiguré : il a sa propre ligne dans le devis, comme un item personnalisé, et n'entre dans aucun des sept postes.
  { id: 'gm', label: 'Manutention garde-meubles', unite: 'm³', cas: 'libre', pu: function (g) { return g.gmES; } },
  { id: 'libre', label: 'Item personnalisé', unite: '', cas: 'libre', pu: function () { return 0; } }
);
function typeDe(id) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i]; return TYPES[TYPES.length - 1]; }

// Une ligne : { type, nombre, quantite, puLibre }. Montant = nombre × quantité × prix unitaire.
function prixUnitaire(g, saison, ligne) {
  var t = typeDe(ligne.type);
  return t.id === 'libre' ? (ligne.puLibre || 0) : t.pu(g, saison);
}
function montantLigne(g, saison, ligne) { return ligne.nombre * ligne.quantite * prixUnitaire(g, saison, ligne); }

// forces : { cas: montant HT imposé par le commercial }
// remise : { mode: 'R0' | 'R10' | 'RX' | 'RN', rn: % de la remise neutralisée, x: valeur saisie, xType: 'pct' | 'val' }
//   R0  pas de remise
//   R10 remise de 10 %
//   RX  remise au choix, en pourcentage ou en euros
//   RN  remise « nulle » : une remise de rn % est affichée, mais les postes sont majorés pour que le net ne change pas
// La remise porte sur les sept postes, pas sur les items personnalisés. Elle est à 20 % de TVA comme eux.
function chiffrer(g, saison, lignes, forces, remise) {
  var cases = {}, libres = 0, tvaLibres = 0, brut = 0;
  CASES.forEach(function (c) { cases[c[0]] = { calcule: 0, retenu: 0, affiche: 0, force: false }; });
  lignes.forEach(function (l) {
    var m = montantLigne(g, saison, l), cas = typeDe(l.type).cas;
    if (cas === 'libre') { libres += m; tvaLibres += m * (typeof l.tva === 'number' ? l.tva : 0.2); } else cases[cas].calcule += m;
  });
  CASES.forEach(function (c) {
    var k = cases[c[0]], f = forces ? forces[c[0]] : null;
    k.force = typeof f === 'number';
    k.retenu = k.force ? f : k.calcule;
    brut += k.retenu;
  });
  var mode = remise ? remise.mode : 'R0', facteur = 1, montant = 0, pct = 0;
  if (mode === 'R10') pct = 0.1;
  else if (mode === 'RN') { pct = Math.min(Math.max((remise.rn || 0) / 100, 0), 0.9); facteur = 1 / (1 - pct); }
  else if (mode === 'RX' && remise.xType === 'pct') pct = Math.min(Math.max((remise.x || 0) / 100, 0), 1);
  var majore = brut * facteur;
  if (mode === 'RX' && remise.xType === 'val') { montant = Math.min(Math.max(remise.x || 0, 0), majore); pct = majore ? montant / majore : 0; }
  else montant = majore * pct;
  CASES.forEach(function (c) { cases[c[0]].affiche = cases[c[0]].retenu * facteur; });   // ce qui s'affiche et part dans Ulyss
  var net = majore - montant, ht = net + libres, tva = net * 0.2 + tvaLibres;
  return { cases: cases, libres: libres, brut: majore, facteur: facteur, remise: montant, remisePct: pct, ht: ht, tva: tva, ttc: ht + tva };
}
