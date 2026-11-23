// Ulyss — Chiffrage : mise à jour de l'extension par elle-même (même principe que l'extension Telemak).
// L'extension est chargée depuis Téléchargements\ulyss-chiffrage-extension. Quand une version plus récente est publiée
// récente (dépôt GitHub UlyssSoftware/extension-ulyss), ce script contrôle chaque fichier publié (empreinte), le télécharge dans ce dossier à la place de l'ancien, puis la page
// demande le rechargement de l'extension. Seuls des fichiers de ce site, aux noms simples, dans ce seul dossier.
var BASE = 'https://raw.githubusercontent.com/UlyssSoftware/extension-ulyss/main/fichiers/';
var DOSSIER = 'ulyss-chiffrage-extension';
var DELAI = 30 * 60 * 1000;          // entre deux vérifications automatiques
var DELAI_ECHEC = 5 * 60 * 1000;     // après un échec, on réessaie plus tôt
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
    return { version: String(l.version), fichiers: f, empreintes: e, date: String(l.date || '') };
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
function telecharger(nom, version) {
  return new Promise(function (ok) {
    chrome.downloads.download({ url: BASE + nom + '?v=' + version, filename: DOSSIER + '/' + nom, conflictAction: 'overwrite', saveAs: false }, function (id) {
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
            return fetch(BASE + nom + '?v=' + liste.version, { cache: 'no-store' }).then(function (r) {
              if (!r.ok) throw new Error('fichier « ' + nom + ' » absent du site (' + r.status + ')');
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
              return telecharger(nom, liste.version).then(function (t) {
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
  return json(chrome.runtime.getURL('tarifs.json')).catch(function () { return json(chrome.runtime.getURL('tarifs.chiffre')); })
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

chrome.runtime.onMessage.addListener(function (msg, expediteur, repondre) {
  if (!msg || !msg.type) return;
  if (msg.type === 'gc-etat') {
    versionDisque().then(function (d) { repondre({ chargee: chrome.runtime.getManifest().version, disque: d }); });
    return true;   // réponse différée
  }
  if (msg.type === 'gc-tarifs') { lireTarifs().then(repondre); return true; }
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
