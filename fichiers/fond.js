// Ulyss — Chiffrage : mise à jour de l'extension par elle-même (même principe que l'extension Telemak).
// L'extension est chargée depuis Téléchargements\ulyss-chiffrage-extension. Quand une version plus récente est publiée
// récente (dépôt GitHub UlyssSoftware/extension-ulyss), ce script contrôle chaque fichier publié (empreinte), le télécharge dans ce dossier à la place de l'ancien, puis la page
// demande le rechargement de l'extension. Seuls des fichiers de ce site, aux noms simples, dans ce seul dossier.
// La liste des versions est lue dans le dépôt (branche main). Les fichiers, eux, sont téléchargés par jsDelivr, au commit de la
// version : GitHub « brut » annonce tout en text/plain, et Chrome sous Windows renomme alors chaque fichier téléchargé en .txt
// (constaté le 23/11/2026 : content.txt, manifest.txt…). jsDelivr annonce le bon type pour .js et .json.
var BASE = 'https://raw.githubusercontent.com/UlyssSoftware/extension-ulyss/main/fichiers/';
// « reference » = l'empreinte du commit qui contient les fichiers de la version (donnée par version.json) : adresse figée, sans cache à attendre.
function baseFichiers(reference) { return 'https://cdn.jsdelivr.net/gh/UlyssSoftware/extension-ulyss@' + reference + '/fichiers/'; }
var DOSSIER = 'ulyss-chiffrage-extension';
var DELAI = 5 * 60 * 1000;           // entre deux vérifications automatiques (la liste des versions ne pèse rien)
var DELAI_ECHEC = 2 * 60 * 1000;     // après un échec, on réessaie plus tôt
var CLE = 'gc-maj';

function plusRecente(a, b) {
  var x = String(a || '').split('.'), y = String(b || '').split('.');
  for (var i = 0; i < Math.max(x.length, y.length); i++) { var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0; if (p !== q) return p > q; }
  return false;
}
function lire(cle) { return new Promise(function (ok) { chrome.storage.local.get(cle, function (x) { ok(x ? x[cle] : undefined); }); }); }
function ecrire(cle, valeur) { return new Promise(function (ok) { var o = {}; o[cle] = valeur; chrome.storage.local.set(o, ok); }); }
function versionDisque() {
  return fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : {}; }).then(function (m) { return m.version || ''; }).catch(function () { return ''; });
}
function listePubliee() {
  return fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('la liste des versions ne répond pas (' + r.status + ')');
    return r.json();
  }).then(function (l) {
    var f = Array.isArray(l.fichiers) ? l.fichiers.map(String) : [], e = l.empreintes || {};
    if (!/^\d+\.\d+\.\d+$/.test(String(l.version || ''))) throw new Error('numéro de version illisible dans la liste');
    if (!f.length || f.length > 40 || f.indexOf('manifest.json') < 0 || f.some(function (n) { return !/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(n) || !/^[0-9a-f]{64}$/.test(String(e[n] || '')); })) throw new Error('liste de fichiers illisible');
    if (!/^[0-9a-f]{40}$/.test(String(l.reference || ''))) throw new Error('référence de publication absente de la liste');
    return { version: String(l.version), fichiers: f, empreintes: e, date: String(l.date || ''), reference: String(l.reference) };
  });
}
function empreinte(tampon) {
  return crypto.subtle.digest('SHA-256', tampon).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (o) { return ('0' + o.toString(16)).slice(-2); }).join(''); });
}
function finDuTelechargement(id) {
  return new Promise(function (ok) {
    var fin = Date.now() + 60000;
    (function voir() {
      chrome.downloads.search({ id: id }, function (l) {
        var d = l && l[0];
        if (!d || d.state === 'complete' || d.state === 'interrupted' || Date.now() > fin) return ok(d || null);
        setTimeout(voir, 300);
      });
    })();
  });
}
function telecharger(nom, reference) {
  return new Promise(function (ok) {
    chrome.downloads.download({ url: baseFichiers(reference) + nom, filename: DOSSIER + '/' + nom, conflictAction: 'overwrite', saveAs: false }, function (id) {
      if (chrome.runtime.lastError || id === undefined) return ok({ motif: (chrome.runtime.lastError || {}).message || 'refusé' });
      finDuTelechargement(id).then(function (d) {
        try { chrome.downloads.erase({ id: id }, function () { void chrome.runtime.lastError; }); } catch (e) {}   // retire la ligne de l'historique, pas le fichier
        ok(d && d.state === 'complete' ? { chemin: String(d.filename || '') } : { motif: (d && (d.error || d.danger)) || 'non terminé' });
      });
    });
  });
}
function discret(oui) { try { var p = chrome.downloads.setUiOptions({ enabled: !oui }); if (p && p.catch) p.catch(function () {}); } catch (e) {} }

var enCours = null;
// Résultat : { etat: 'a_jour' | 'telechargee' | 'hors_dossier' | 'echec', chargee, publiee, dossier, motif }
function verifier(force) {
  if (enCours) return enCours;
  var chargee = chrome.runtime.getManifest().version;
  enCours = lire(CLE).then(function (memo) {
    memo = memo || {};
    if (!force && memo.quand && Date.now() - memo.quand < DELAI && memo.resultat && memo.resultat.chargee === chargee) return memo.resultat;
    var fin = function (r, delai) { r.chargee = chargee; return ecrire(CLE, { quand: Date.now() - (delai ? DELAI - delai : 0), resultat: r }).then(function () { return r; }); };
    return listePubliee().then(function (liste) {
      if (!plusRecente(liste.version, chargee)) return fin({ etat: 'a_jour', publiee: liste.version, date: liste.date });
      return versionDisque().then(function (disque) {
        if (disque === liste.version) return fin({ etat: 'telechargee', publiee: liste.version });
        // 1. Tout contrôler avant d'écrire quoi que ce soit : un dépôt en cours sur le site ne doit pas donner une extension à moitié à jour.
        return liste.fichiers.reduce(function (suite, nom) {
          return suite.then(function () {
            return fetch(baseFichiers(liste.reference) + nom, { cache: 'no-store' }).then(function (r) {
              if (!r.ok) throw new Error('fichier « ' + nom + ' » pas encore disponible (' + r.status + ')');
              return r.arrayBuffer();
            }).then(empreinte).then(function (h) { if (h !== liste.empreintes[nom]) throw new Error('fichier « ' + nom + ' » différent de celui annoncé (dépôt en cours ?)'); });
          });
        }, Promise.resolve()).then(function () {
          // 2. Télécharger, le manifeste en dernier : un rechargement au milieu ne lirait pas un manifeste neuf avec des fichiers anciens.
          var ordre = liste.fichiers.filter(function (n) { return n !== 'manifest.json'; }).concat(['manifest.json']), dossier = '', echecs = [];
          // Relit un fichier juste téléchargé dans le dossier de l'extension : s'il n'y est pas ou n'a pas la bonne empreinte, on s'arrête
          // avant le manifeste (sauf si l'extension est chargée d'un autre dossier, cas traité plus bas).
          var relu = function (nom) {
            return fetch(chrome.runtime.getURL(nom) + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.arrayBuffer().then(empreinte) : ''; }).catch(function () { return ''; });
          };
          var premier = true, ailleurs = false;
          discret(true);
          return ordre.reduce(function (suite, nom) {
            return suite.then(function () {
              if (echecs.length) return;
              return telecharger(nom, liste.reference).then(function (t) {
                if (t.motif) { echecs.push(nom + ' : ' + t.motif); return; }
                if (!dossier) dossier = t.chemin.replace(/[\\/][^\\/]+$/, '');
                if (nom === 'manifest.json' || ailleurs) return;
                return relu(nom).then(function (h) {
                  if (h === liste.empreintes[nom]) { premier = false; return; }
                  if (premier) { ailleurs = true; return; }   // dès le premier fichier, rien n'arrive dans le dossier chargé : extension installée ailleurs
                  echecs.push(nom + ' : enregistré sous un autre nom ou incomplet');
                });
              });
            });
          }, Promise.resolve()).then(function () {
            discret(false);
            if (echecs.length) return fin({ etat: 'echec', publiee: liste.version, motif: 'téléchargement interrompu (' + echecs[0] + ')' }, DELAI_ECHEC);
            // 3. Si le dossier chargé par le navigateur n'a pas changé, c'est que l'extension est installée ailleurs.
            return versionDisque().then(function (apres) {
              return fin(apres === liste.version ? { etat: 'telechargee', publiee: liste.version, dossier: dossier } : { etat: 'hors_dossier', publiee: liste.version, dossier: dossier });
            });
          });
        });
      });
    }).catch(function (e) { discret(false); return fin({ etat: 'echec', motif: (e && e.message) || String(e) }, DELAI_ECHEC); });
  }).then(function (r) { enCours = null; return r; }, function (e) { enCours = null; return { etat: 'echec', chargee: chargee, motif: String(e) }; });
  return enCours;
}

// ---------- Tarifs chiffrés ----------
// Les grilles de prix et les forfaits ne sont pas dans le code : ils sont dans « tarifs.chiffre », illisible sans le code d'accès
// (AES-256-GCM, clé dérivée du code par PBKDF2-SHA256). Le code est saisi une fois par poste ; on ne garde que la clé dérivée.
var CLE_TARIFS = 'gc-cle';
function octets(b64) { var t = atob(b64), o = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) o[i] = t.charCodeAt(i); return o; }
function enB64(tampon) { var o = new Uint8Array(tampon), t = ''; for (var i = 0; i < o.length; i++) t += String.fromCharCode(o[i]); return btoa(t); }
// Le fichier chiffré est lu dans le dossier de l'extension ; s'il n'y est pas (téléchargement refusé ou renommé par le navigateur,
// constaté le 23/11/2026 avec l'ancien nom « tarifs.chiffre »), il est lu directement dans le dépôt : le poste n'est jamais bloqué.
function fichierTarifs() {
  var json = function (u) { return fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('absent'); return r.json(); }).then(function (j) { if (!j || !j.sel || !j.iv || !j.donnees) throw new Error('illisible'); return j; }); };
  return json(chrome.runtime.getURL('tarifs.json')).catch(function () { return json(chrome.runtime.getURL('tarifs.chiffre')); }).catch(function () { return json(chrome.runtime.getURL('tarifs.txt')); })
    .catch(function () { return json(BASE + 'tarifs.json'); })
    .catch(function () { throw new Error('fichier des tarifs introuvable sur ce poste et dans le dépôt'); });
}
function dechiffrer(fichier, cleBrute) {
  return crypto.subtle.importKey('raw', cleBrute, 'AES-GCM', false, ['decrypt']).then(function (k) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: octets(fichier.iv) }, k, octets(fichier.donnees));
  }).then(function (clair) { return JSON.parse(new TextDecoder().decode(clair)); });
}
// Réponse : { ok: true, tarifs } ou { ok: false, motif: 'code' (à saisir ou à ressaisir) | texte de l'erreur }
function lireTarifs() {
  return Promise.all([fichierTarifs(), lire(CLE_TARIFS)]).then(function (x) {
    var fichier = x[0], memo = x[1];
    if (!memo || memo.sel !== fichier.sel) return { ok: false, motif: 'code' };
    return dechiffrer(fichier, octets(memo.cle)).then(function (t) { return { ok: true, tarifs: t }; }, function () { return { ok: false, motif: 'code' }; });
  }).catch(function (e) { return { ok: false, motif: (e && e.message) || String(e) }; });
}
function enregistrerCode(code) {
  return fichierTarifs().then(function (fichier) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(String(code)), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: octets(fichier.sel), iterations: fichier.iterations }, k, 256);
    }).then(function (bits) {
      return dechiffrer(fichier, new Uint8Array(bits)).then(function (t) {
        return ecrire(CLE_TARIFS, { sel: fichier.sel, cle: enB64(bits) }).then(function () { return { ok: true, tarifs: t }; });
      }, function () { return { ok: false, motif: 'code' }; });
    });
  }).catch(function (e) { return { ok: false, motif: (e && e.message) || String(e) }; });
}

// Confirmation de rendez-vous par e-mail : le script d'envoi (hébergé sur ulyss-software.com) n'accepte que les appels qui
// présentent sa clé. Adresse et clé sont rangées avec les tarifs, dans le fichier chiffré : le code de l'extension est public.
function envoyerRdv(donnees, cible) {
  return lireTarifs().then(function (r) {
    if (!r.ok) return r;
    var c = r.tarifs && r.tarifs.rdv;
    if (!c || !c.cle || !/^https:\/\/www\.ulyss-software\.com\/extension-ulyss\//.test(String(c.url || ''))) return { ok: false, motif: "réglages de l'envoi absents du fichier chiffré (extension à mettre à jour)" };
    // Serveur /extension-ulyss/ : un sous-dossier par action (25/11/2026). cible « rappel » → rappel-demenagement/rappel.php
    // cible « charge » → charge/index.php (taux de charge du Planning, 26/11/2026)
    // cibles « avis » → avis/index.php (module Avis clients) et « demande-avis » → demande-avis/avis.php (26/11/2026)
    var DOSSIERS = { rappel: 'rappel-demenagement/rappel.php', charge: 'charge/index.php', avis: 'avis/index.php', 'demande-avis': 'demande-avis/avis.php', deplacement: 'deplacement/index.php', modules: 'modules/index.php', prix: 'prix/index.php', commercial: 'commercial/index.php' };
    var url = DOSSIERS[cible] ? String(c.url).replace(/confirmation-rdv\/envoyer\.php$/, DOSSIERS[cible]) : c.url;
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cle': c.cle }, body: JSON.stringify(donnees || {}), cache: 'no-store' })
      .then(function (rep) { return rep.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} return { ok: true, statut: rep.status, corps: j, brut: j ? '' : t.slice(0, 300) }; }); });
  }).catch(function (e) { return { ok: false, motif: 'le script d\'envoi ne répond pas (' + ((e && e.message) || e) + ')' }; });
}

// ---------- Avis clients : relevé des avis Google (26/11/2026) ----------
// À la demande d'une page d'Ulyss (avis.js), ouvre chaque fiche Google Maps dans un onglet en arrière-plan ; maps-avis.js
// y lit les avis récents et les renvoie ; l'onglet est refermé. Si l'onglet en arrière-plan ne rend rien (Google Maps
// dessine peu dans un onglet caché), second essai dans une petite fenêtre non active. Une fiche à la fois.
// Seules des adresses de fiche Google Maps sont acceptées ; maps-avis.js n'agit que dans les onglets listés ici.
var ongletsAvis = {};
function ouvrirFiche(url, fenetre) {
  return new Promise(function (ok) {
    var fini = false, minuterie = null, idOnglet = null, idFenetre = null;
    var fin = function (r) {
      if (fini) return; fini = true; clearTimeout(minuterie);
      if (idOnglet !== null) delete ongletsAvis[idOnglet];
      try { if (idFenetre !== null) chrome.windows.remove(idFenetre, function () { void chrome.runtime.lastError; }); else if (idOnglet !== null) chrome.tabs.remove(idOnglet, function () { void chrome.runtime.lastError; }); } catch (e) {}
      ok(r);
    };
    var suivre = function (onglet, f) {
      if (chrome.runtime.lastError || !onglet) return fin({ ok: false, motif: "onglet Google Maps impossible à ouvrir" });
      idOnglet = onglet.id; idFenetre = f; ongletsAvis[idOnglet] = fin;
    };
    minuterie = setTimeout(function () { fin({ ok: false, motif: "Google Maps n'a pas répondu en 50 s (page de consentement Google ou connexion lente)" }); }, 50000);
    try {
      if (fenetre) chrome.windows.create({ url: url, type: 'popup', focused: false, width: 520, height: 760 }, function (w) { suivre(w && w.tabs && w.tabs[0], w ? w.id : null); });
      else chrome.tabs.create({ url: url, active: false }, function (t) { suivre(t, null); });
    } catch (e) { fin({ ok: false, motif: String((e && e.message) || e) }); }
  });
}
var releveAvisEnCours = null;
function releverAvis(fiches) {
  if (releveAvisEnCours) return releveAvisEnCours;
  var liste = (Array.isArray(fiches) ? fiches : []).filter(function (f) { return f && /^[A-Z]$/.test(String(f.s)) && /^https:\/\/www\.google\.com\/maps\/place\/[^?#]+$/.test(String(f.url)); }).slice(0, 6);
  releveAvisEnCours = liste.reduce(function (suite, f) {
    return suite.then(function (res) {
      return ouvrirFiche(f.url, false).then(function (r) { return r.ok ? r : ouvrirFiche(f.url, true); }).then(function (r) {
        res.push({ s: f.s, ok: !!r.ok, motif: r.motif || '', nb: r.nb || 0, avis: r.ok && Array.isArray(r.avis) ? r.avis.slice(0, 20) : [] });
        return res;
      });
    });
  }, Promise.resolve([])).then(function (res) { releveAvisEnCours = null; return { ok: true, fiches: res }; }, function (e) { releveAvisEnCours = null; return { ok: false, motif: String((e && e.message) || e) }; });
  return releveAvisEnCours;
}

chrome.runtime.onMessage.addListener(function (msg, expediteur, repondre) {
  if (!msg || !msg.type) return;
  if (msg.type === 'gc-avis-onglet') { repondre({ oui: !!(expediteur && expediteur.tab && ongletsAvis[expediteur.tab.id]) }); return; }
  if (msg.type === 'gc-avis-lu') { var f = expediteur && expediteur.tab && ongletsAvis[expediteur.tab.id]; if (f) f(msg.resultat && typeof msg.resultat === 'object' ? msg.resultat : { ok: false, motif: 'réponse illisible' }); return; }
  if (msg.type === 'gc-avis-releve') {
    // demandé par une page d'Ulyss seulement
    if (!expediteur || !expediteur.tab || !/^https:\/\/(ulyss\.fr|fraisseix\.staging\.unova\.fr)\//.test(String(expediteur.url || expediteur.tab.url || ''))) { repondre({ ok: false, motif: 'demande refusée' }); return; }
    releverAvis(msg.fiches).then(repondre); return true;
  }
  if (msg.type === 'gc-etat') {
    versionDisque().then(function (d) { repondre({ chargee: chrome.runtime.getManifest().version, disque: d }); });
    return true;   // réponse différée
  }
  if (msg.type === 'gc-tarifs') { lireTarifs().then(repondre); return true; }
  if (msg.type === 'gc-rdv') { envoyerRdv(msg.donnees, msg.cible).then(repondre); return true; }
  if (msg.type === 'gc-code') { enregistrerCode(msg.code).then(repondre); return true; }
  if (msg.type === 'gc-verifier') { verifier(msg.force === true).then(repondre); return true; }
  if (msg.type === 'gc-recharger') {
    // On note l'onglet qui a demandé : c'est l'extension rechargée qui le réaffichera, une fois prête (voir onInstalled).
    var onglet = expediteur && expediteur.tab ? expediteur.tab.id : null;
    chrome.storage.local.set({ 'gc-onglet-a-recharger': onglet }, function () { repondre({ ok: true }); setTimeout(function () { chrome.runtime.reload(); }, 150); });
    return true;
  }
});
// Après un rechargement de l'extension : réafficher l'onglet d'Ulyss qui l'avait demandé, pour que la nouvelle version s'y installe.
chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get('gc-onglet-a-recharger', function (x) {
    var onglet = x && x['gc-onglet-a-recharger'];
    if (onglet == null) return;
    chrome.storage.local.remove('gc-onglet-a-recharger');
    chrome.tabs.reload(onglet, {}, function () { void chrome.runtime.lastError; });
  });
});
