// Ulyss — Chiffrage par grille. Script de page.
// Lit la pré-planification du dossier ouvert, chiffre avec une grille de référence,
// puis reporte les montants dans le formulaire « Estimation » d'Ulyss. N'envoie rien lui-même :
// c'est le commercial qui clique sur « Valider » dans Ulyss.
(function () {
  if (window.__chiffrageGrille) return;
  window.__chiffrageGrille = true;

  var CHEMIN = /^\/contracts\/(\d+)\/phases/;
  var SAISONS = ['Basse saison', 'Saison normale', 'Haute saison', 'Très haute saison'];
  var SIGLES = ['B', 'N', 'H', 'TH'];
  var CHEVRON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SOCIETES = [[/fraisseix/i, 'fra'], [/limousins/i, 'ldl'], [/bardon/i, 'bd']];
  var TITRES_ULYSS = { 'Location de matériel': 'loc', 'Monte-meuble': 'mm', "Main d'oeuvre": 'mo', 'Frais de déplacement': 'dep', 'Véhicules': 'veh', "Fourniture d'emballage": 'emb', 'Panneaux de stationnement': 'pan' };
  var TVA_ULYSS = [[0.2, '20 %'], [0.1, '10 %'], [0.055, '5,5 %'], [0, '0 %']];   // vat_id Ulyss : 3, 2, 1, 4
  // Moyens proposés par « Ajouter un moyen à la phase », en plus de l'item personnalisé. Pour le moment : la manutention
  // de garde-meubles seule (tarif de la grille par m³, m³ saisis à la main en attendant la mise à jour d'Ulyss sur l'inventaire par phase).
  var AJOUT_RAPIDE = ['gm'];
  var etat = null, hote = null, racine = null;

  function fr(x, d) { return x.toLocaleString('fr-FR', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 4 : d }); }
  function euros(x) { return fr(x, 2) + ' €'; }
  function nombre(t) { var x = parseFloat(String(t == null ? '' : t).replace(/\s/g, '').replace(',', '.')); return isFinite(x) && x >= 0 ? x : 0; }
  function arrondi(x) { return Math.round(x * 10000) / 10000; }
  function $(id) { return racine.getElementById(id); }
  function echappe(t) { return String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  // Mémoire locale au poste : stockage de l'extension, ou celui du navigateur sur la page d'aperçu.
  function memoire(cle, valeur) {
    var ext = null;
    try { if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ext = chrome.storage.local; } catch (e) {}
    if (valeur === undefined) {
      return new Promise(function (ok) {
        try {
          if (ext) ext.get(cle, function (r) { ok(r ? r[cle] : undefined); });
          else { var t = localStorage.getItem('chiffrage-' + cle); ok(t ? JSON.parse(t) : undefined); }
        } catch (e) { ok(undefined); }
      });
    }
    try { if (ext) { var o = {}; o[cle] = valeur; ext.set(o); } else localStorage.setItem('chiffrage-' + cle, JSON.stringify(valeur)); } catch (e) {}
  }
  // Ce que le commercial a réglé sur un dossier est gardé d'une ouverture du panneau à l'autre : saison, grille, unité,
  // et pour chaque phase ses moyens, ses montants saisis, sa remise et l'état de son report.
  function clePhase(ph, i) { return ph.id || 'p' + i; }
  function empreinte(depart) { return JSON.stringify(depart.lignes.map(function (l) { return [l.g, l.type, l.nombre, l.quantite]; })); }
  function sauver() {
    if (!etat) return;
    var o = { saison: etat.saison, grille: etat.grille, unite: etat.unite, phases: {} };
    etat.phases.forEach(function (ph, i) {
      o.phases[clePhase(ph, i)] = { empreinte: empreinte(ph.depart), lignes: ph.lignes, groupes: ph.groupes, forces: ph.forces, remise: ph.remise, reporte: ph.reporte || null };
    });
    memoire('dossier-' + etat.numero, o);
  }

  // ---------- Bouton dans la page de pré-planification ----------
  function poserBouton() {
    var ancre = document.querySelector('a#new_proposal-link');
    if (!(CHEMIN.test(location.pathname) || window.__chiffrageApercu) || !ancre || document.getElementById('gc-bouton')) return;
    // Deux boutons côte à côte : « Grille » (chiffrage d'après la pré-planification) et « Forfait » (demande du 22/11/2026).
    var b = document.createElement('a');
    b.id = 'gc-bouton'; b.href = '#'; b.className = ancre.className; b.textContent = 'Grille';
    b.addEventListener('click', function (e) { e.preventDefault(); ouvrir(); });
    var f = document.createElement('a');
    f.id = 'gc-forfait'; f.href = '#'; f.className = ancre.className; f.textContent = 'Forfait';
    f.addEventListener('click', function (e) { e.preventDefault(); ouvrirForfait(); });
    ancre.parentElement.insertBefore(b, ancre);
    ancre.parentElement.insertBefore(f, ancre);
  }
  // ---------- Version de l'extension et mises à jour ----------
  // L'extension télécharge elle-même ses nouveaux fichiers dans son dossier (voir fond.js). Ici : un petit bouton qui donne la
  // version en service et permet de vérifier, et le rechargement de l'extension quand de nouveaux fichiers sont arrivés.
  var EXT = (function () { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    return new Promise(function (ok) {
      try { EXT.sendMessage(msg, function (r) { ok(chrome.runtime.lastError ? null : r || null); }); } catch (e) { ok(null); }
    });
  }
  // ---------- Tarifs : chiffrés dans l'extension, lus avec le code d'accès saisi une fois par poste ----------
  // Les grilles de prix et les forfaits ne sont plus dans le code (qui est public) mais dans « tarifs.json ». Le service worker
  // les déchiffre avec la clé gardée sur le poste ; sans elle, « Grille » et « Forfait » demandent le code d'accès.
  function tarifsPrets(sansForfaits) { return typeof GRILLES_REFERENCE !== 'undefined' && !!GRILLES_REFERENCE && (!!sansForfaits || (typeof FORFAITS !== 'undefined' && !!FORFAITS)); }
  function poserTarifs(t) { if (t && t.grilles && t.forfaits) { window.GRILLES_REFERENCE = t.grilles; window.FORFAITS = t.forfaits; } return tarifsPrets(); }
  if (EXT && !tarifsPrets()) demander({ type: 'gc-tarifs' }).then(function (r) { if (r && r.ok) poserTarifs(r.tarifs); });
  function demanderCode(ensuite) {
    if (!EXT) { afficherMessage({ texte: 'Tarifs indisponibles.', erreur: true }); return; }
    // D'abord un nouvel essai silencieux : la clé est peut-être déjà sur le poste (page ouverte avant la réponse du service worker).
    demander({ type: 'gc-tarifs' }).then(function (r) {
      if (r && r.ok && poserTarifs(r.tarifs)) { ensuite(); return; }
      if (r && !r.ok && r.motif !== 'code') { afficherMessage({ texte: 'Tarifs illisibles : ' + r.motif + '.', erreur: true }); return; }
      var ancien = document.getElementById('gc-code'); if (ancien) ancien.remove();
      var f = document.createElement('div');
      f.id = 'gc-code';
      f.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,30,.45);display:flex;align-items:center;justify-content:center;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#17212b';
      f.innerHTML = '<form style="background:#fff;border-radius:10px;padding:22px 24px;width:380px;max-width:92vw;box-shadow:0 12px 40px rgba(15,23,30,.3)">' +
        '<div style="font-weight:700;font-size:17px;margin-bottom:6px">Code d\'accès aux tarifs</div>' +
        '<div style="color:#4a5866;margin-bottom:14px">À saisir une seule fois sur ce poste.</div>' +
        '<input type="password" autocomplete="off" aria-label="Code d\'accès aux tarifs" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #b9c2cc;border-radius:6px;font:inherit">' +
        '<div role="alert" style="min-height:22px;margin-top:8px;color:#8a1c1c"></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px"><button type="button" data-annuler style="padding:9px 14px;border:1px solid #b9c2cc;border-radius:6px;background:#fff;font:inherit;cursor:pointer">Annuler</button>' +
        '<button type="submit" style="padding:9px 16px;border:0;border-radius:6px;background:#0b4f5a;color:#fff;font:inherit;font-weight:600;cursor:pointer">Valider</button></div></form>';
      document.body.appendChild(f);
      var champ = f.querySelector('input'), alerte = f.querySelector('[role=alert]'), valider = f.querySelector('button[type=submit]');
      champ.focus();
      f.querySelector('[data-annuler]').addEventListener('click', function () { f.remove(); });
      f.addEventListener('mousedown', function (e) { if (e.target === f) f.remove(); });
      f.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        if (!champ.value) return;
        valider.disabled = true; alerte.style.color = '#4a5866'; alerte.textContent = 'Vérification…';
        demander({ type: 'gc-code', code: champ.value }).then(function (x) {
          valider.disabled = false;
          if (x && x.ok && poserTarifs(x.tarifs)) { f.remove(); ensuite(); return; }
          alerte.style.color = '#8a1c1c';
          alerte.textContent = x && x.motif && x.motif !== 'code' ? 'Tarifs illisibles : ' + x.motif + '.' : 'Code incorrect.';
          champ.select();
        });
      });
    });
  }
  // Sous la dernière icône de la barre latérale d'Ulyss, sur toutes les pages (demande du 23/11/2026 : l'extension fera à terme
  // plusieurs choses à différents endroits d'Ulyss, sa version n'a donc pas sa place dans la seule pré-planification).
  function poserVersion() {
    if (!EXT || document.getElementById('gc-version')) return;
    var zone = document.querySelector('#global-sidebar .discret-scroll') || document.getElementById('global-sidebar');
    if (!zone) return;
    var v = document.createElement('a');
    v.id = 'gc-version'; v.href = '#'; v.textContent = 'ext ' + EXT.getManifest().version; v.title = 'Extension Ulyss : cliquez pour vérifier les mises à jour';
    v.style.cssText = 'display:block;text-align:center;padding:12px 4px 16px;font:12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#9b9cab;text-decoration:none;white-space:nowrap';
    v.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); ouvrirVersion(v); });
    zone.appendChild(v);
    marquerVersion();
  }
  // Pastille rouge autour de « ext x.y.z » tant qu'une version plus récente est publiée et pas encore en service (demande du 23/11/2026).
  // En temps normal elle ne dure que le temps d'une page : la mise à jour se fait seule. Elle reste si le poste n'y arrive pas
  // (extension chargée d'un autre dossier que Téléchargements, téléchargement refusé) : un clic dit alors quoi faire.
  var etatMaj = null;
  function marquerVersion(e) {
    if (e) etatMaj = e;
    var v = document.getElementById('gc-version');
    if (!v || !EXT) return;
    var enRetard = !!etatMaj && !!etatMaj.publiee && plusRecente(etatMaj.publiee, EXT.getManifest().version) && /^(telechargee|hors_dossier|echec)$/.test(etatMaj.etat);
    var texte = 'ext ' + EXT.getManifest().version;
    // En retard : la pastille rouge, et dessous, en toutes lettres, « Mise à jour » avec le numéro publié (demande du 23/11/2026).
    v.innerHTML = enRetard ? '<span style="display:inline-block;padding:4px 9px;border-radius:999px;background:#c62828;color:#fff;font-weight:600">' + echappe(texte) + '</span>' +
      '<span style="display:block;margin-top:5px;color:#c62828;font-weight:700;white-space:normal">Mise à jour<br>' + echappe(etatMaj.publiee) + ' à installer</span>' : echappe(texte);
    v.title = enRetard ? 'Extension Ulyss : la version ' + etatMaj.publiee + ' est publiée — cliquez pour mettre à jour' : 'Extension Ulyss : cliquez pour vérifier les mises à jour';
  }
  function ouvrirVersion(v) {
    var ancien = document.getElementById('gc-version-etat'); if (ancien) { ancien.remove(); return; }
    var r = v.getBoundingClientRect(), m = document.createElement('div');
    m.id = 'gc-version-etat'; m.setAttribute('role', 'status');
    m.style.cssText = 'position:fixed;z-index:2147482000;bottom:' + Math.max(8, window.innerHeight - r.bottom) + 'px;left:' + Math.max(8, Math.min(r.right + 8, window.innerWidth - 348)) + 'px;width:340px;background:#fff;border:1px solid #cfd6dd;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,30,.18);padding:12px 14px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#17212b';
    m.textContent = 'Vérification…';
    document.body.appendChild(m);
    setTimeout(function () { document.addEventListener('click', function fermerEtat(e) { if (m.contains(e.target)) return; m.remove(); document.removeEventListener('click', fermerEtat); }); }, 0);
    var bouton = function (texte) { return '<button type="button" id="gc-version-go" style="margin-top:6px;padding:8px 12px;border:0;border-radius:6px;background:#0b4f5a;color:#fff;font:inherit;font-weight:600;cursor:pointer">' + texte + '</button>'; };
    var rouge = function (t) { return '<span style="color:#8a1c1c">' + t + '</span>'; };
    // Vérifie tout de suite (sans attendre le délai habituel) ; si une version plus récente est publiée, elle est téléchargée dans la foulée.
    demander({ type: 'gc-verifier', force: true }).then(function (e) {
      if (!m.isConnected) return;
      if (!e) { m.textContent = 'L\'extension vient d\'être mise à jour : rechargez la page.'; return; }
      marquerVersion(e);
      var lignes = ['<b>Extension Ulyss</b>', 'Version en service : ' + echappe(e.chargee)], suite = '';
      if (e.etat === 'a_jour') lignes.push('<span style="color:#17572a">À jour' + (e.date ? ' (version du ' + echappe(e.date) + ')' : '') + '.</span>');
      else if (e.etat === 'telechargee') { lignes.push('La version ' + echappe(e.publiee) + ' est téléchargée : il reste à la mettre en service.'); suite = bouton('Mettre en service maintenant'); }
      else if (e.etat === 'hors_dossier') lignes.push(rouge('La version ' + echappe(e.publiee) + ' est téléchargée dans « ' + echappe(e.dossier || 'Téléchargements\\ulyss-chiffrage-extension') + ' », mais ce navigateur charge l\'extension depuis un autre dossier.') + ' Une seule fois : dans la page des extensions, supprimez celle-ci, puis « Charger l\'extension non empaquetée » et choisissez ce dossier. Les mises à jour suivantes se feront seules.');
      else lignes.push(rouge('La vérification n\'a pas abouti : ' + echappe(e.motif || 'raison inconnue') + '.') + ' Nouvel essai automatique dans quelques minutes.');
      m.innerHTML = lignes.map(function (l) { return '<div style="margin-bottom:4px">' + l + '</div>'; }).join('') + suite;
      var go = document.getElementById('gc-version-go');
      if (go) go.addEventListener('click', function () { mettreEnService(e.publiee); });
    });
  }
  // Vrai si la version a est strictement plus récente que b (comparaison nombre par nombre : 1.10.0 > 1.9.0).
  function plusRecente(a, b) {
    var x = String(a || '').split('.'), y = String(b || '').split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0; if (p !== q) return p > q; }
    return false;
  }
  // Recharge l'extension (nouveaux fichiers du disque) puis la page, et affiche un mot à l'arrivée.
  function mettreEnService(version) {
    try { sessionStorage.setItem('gc-maj-tentee', version); sessionStorage.setItem('gc-message', JSON.stringify({ texte: 'Extension de chiffrage mise à jour : version ' + version + '.', erreur: false })); } catch (e) {}
    // L'extension rechargée réaffiche elle-même cet onglet ; le délai ci-dessous n'est qu'un filet si elle ne le fait pas.
    demander({ type: 'gc-recharger' }).then(function () { setTimeout(function () { location.reload(); }, 8000); });
  }
  // À l'arrivée sur une page d'Ulyss : si une nouvelle version est déjà téléchargée, on la met en service tout de suite ; sinon on
  // laisse l'extension vérifier (au plus toutes les 5 minutes) et télécharger — elle sera mise en service à la page suivante.
  // Jamais de rechargement pendant qu'un panneau est ouvert ni qu'une validation est en attente, et une seule tentative par version.
  if (EXT) setTimeout(function () {
    demander({ type: 'gc-etat' }).then(function (e) {
      if (!e) return;
      if (!e.disque || e.disque === e.chargee) { demander({ type: 'gc-verifier' }).then(function (r) { if (r) marquerVersion(r); }); return; }
      var tentee = ''; try { tentee = sessionStorage.getItem('gc-maj-tentee') || ''; } catch (x) {}
      if (tentee === e.disque || hote || lireAttente() || document.querySelector('#new_proposal_modal form')) return;
      mettreEnService(e.disque);
    });
  }, 1200);
  // ---------- Panneaux de stationnement : lus sur les adresses du dossier (règle du 22/11/2026) ----------
  // Aucune saisie : seule la case « Panneaux » de l'adresse compte. Tarif local si l'adresse est en Haute-Vienne (code postal 87…),
  // tarif national sinon. Lecture seule de la fiche de chaque lieu.
  function lireLieu(dossier, lieu) {
    return fetch('/contracts/' + dossier + '/places/' + lieu + '/edit', { credentials: 'same-origin', headers: { Accept: 'text/vnd.turbo-stream.html, text/html', 'Turbo-Frame': 'modal' } }).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (t) {
      var d = new DOMParser().parseFromString(t.replace(/<\/?template>/g, ''), 'text/html'), c = d.querySelector('input[type="checkbox"][name="place[sign]"]');
      if (!c) return Promise.reject();
      var z = d.querySelector('[name="place[address_attributes][zip_code]"]'), cp = z ? String(z.tagName === 'SELECT' ? (z.selectedOptions[0] || {}).value || '' : z.value || '').trim() : '';
      return { panneaux: c.checked, cp: cp, local: !cp || /^87/.test(cp) };   // code postal non lu : compté au tarif local
    });
  }
  // Toutes les adresses du dossier : leurs identifiants sont les options du champ « Lieu » du formulaire d'une étape.
  function lirePanneauxDossier(urlEtape) {
    var vide = { local: 0, national: 0, illisible: true }, dossier = (String(urlEtape || '').match(/\/contracts\/(\d+)\//) || [])[1];
    if (!dossier) return Promise.resolve(vide);
    return fetch(urlEtape.split('?')[0] + '/edit', { credentials: 'same-origin', headers: { Accept: 'text/vnd.turbo-stream.html, text/html' } }).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (t) {
      var s = new DOMParser().parseFromString(t.replace(/<\/?template>/g, ''), 'text/html').querySelector('select[name$="[place_id]"]');
      if (!s) return Promise.reject();
      var ids = [].slice.call(s.options).map(function (o) { return o.value; }).filter(Boolean);
      return Promise.all(ids.map(function (id) { return lireLieu(dossier, id).catch(function () { return null; }); }));
    }).then(function (lieux) {
      var o = { local: 0, national: 0, illisible: lieux.some(function (l) { return !l; }) };
      lieux.forEach(function (l) { if (l && l.panneaux) o[l.local ? 'local' : 'national']++; });
      return o;
    }).catch(function () { return vide; });
  }

  // ---------- Panneau « Forfait » (demande du 22/11/2026) ----------
  // Sens inverse de la grille : on ne lit pas l'organisation, on l'écrit. Le commercial choisit l'adresse (une étape déjà posée
  // par Ulyss) et un forfait ; le panneau ajuste cette étape (durée, opérateur, monte-meuble) puis propose de reporter le prix.
  var forfait = null;
  function heureTexte(h) { var m = Math.round((h % 1) * 60); return Math.floor(h) + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m : ''); }
  function echappe(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lireFormulaireEtape(ev) {
    return fetch(ev.url.split('?')[0] + '/edit', { credentials: 'same-origin', headers: { Accept: 'text/vnd.turbo-stream.html, text/html' } }).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (t) {
      var d = new DOMParser().parseFromString(t.replace(/<\/?template>/g, ''), 'text/html');
      var f = [].slice.call(d.querySelectorAll('form')).filter(function (x) { return new RegExp('/' + ev.item + '(\\?|$)').test(x.getAttribute('action') || '') && x.querySelector('[name="schedule_requirement_item[start_hour]"]'); })[0];
      return f || Promise.reject();
    });
  }
  function etatEtape(f) {
    var I = 'schedule_requirement_item', v = function (n) { var x = f.querySelector('[name="' + I + n + '"]'); return x ? x.value : ''; };
    var types = [].slice.call(f.querySelectorAll('select[name*="schedule_vehicules_attributes"][name$="[vehicule_type_id]"]')).map(function (s) { return s.selectedOptions[0] ? s.selectedOptions[0].textContent.trim() : ''; });
    var caps = [].slice.call(f.querySelectorAll('input[name*="schedule_collaborators_attributes"][name$="[id]"]')).map(function (i) {
      var s = f.querySelector('select[name="' + i.name.replace('[id]', '[capability_ids][]') + '"]');
      return s ? [].slice.call(s.selectedOptions).map(function (o) { return o.textContent.trim(); }).join(' ') : '';
    });
    return { label: v('[label]'), debut: parseFloat(v('[start_hour]')), fin: parseFloat(v('[end_hour]')), hommes: caps.length, operateurs: caps.filter(function (c) { return /monte/i.test(c); }).length, vehicules: types, mm: types.filter(function (t) { return /monte/i.test(t); }).length };
  }
  // Écrit le forfait dans la pré-planification. La première plage réutilise l'étape choisie (formulaire entier d'Ulyss, renvoyé avec
  // les seuls champs du forfait changés) ; les plages suivantes (pause de midi, après-midi, jours suivants) sont créées, rattachées à
  // la même adresse. Aucune étape n'est supprimée. On relit ensuite toute la phase.
  function hhmm(h) { var m = Math.round((h % 1) * 60); return (h < 10 ? '0' : '') + Math.floor(h) + ':' + (m < 10 ? '0' : '') + m; }
  function plagesForfait(fo, ev, d0) {
    return fo.plages.map(function (p) {
      var debut = p[1] == null ? d0 : p[1], fin = p[1] == null ? d0 + p[2] : p[2];
      if (fin > 20) { debut = Math.max(5.5, 20 - (fin - debut)); fin = 20; }
      return { jour: ev.jour + p[0], debut: debut, fin: fin, pause: p[3] === 'pause' };
    });
  }
  // Intitulés posés par les forfaits : c'est à eux que l'on reconnaît une étape de forfait.
  var NOMS_FORFAIT = /^\s*(location monte-meuble|assistance)\s*$/i;
  function memeNom(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
  function plagePresente(liste, p, ev, label) { return liste.filter(function (e) { return e.jour === p.jour && e.debut === hhmm(p.debut) && e.fin === hhmm(p.fin) && (p.pause ? /^\s*pause\s*$/i.test(e.nom) : e.item !== ev.item && memeNom(e.nom, label)); })[0]; }
  // Étapes d'un forfait précédent devenues inutiles (accord de Guillaume du 22/11/2026 pour les retirer) :
  // - les autres étapes de forfait de la même adresse qui ne sont plus dans le forfait choisi ;
  // - la pause d'une journée de forfait qui n'en a plus besoin, s'il n'y a ce jour-là aucune étape d'une autre opération.
  // Jamais une étape d'une autre adresse ou d'un autre nom.
  function etapesARetirer(liste, plages, ev, label) {
    var suite = plages.slice(1), estF = function (e) { return NOMS_FORFAIT.test(e.nom) && e.lieu === ev.lieu; }, estPause = function (e) { return /^\s*pause\s*$/i.test(e.nom); };
    var voulue = function (e) { return suite.some(function (p) { return plagePresente([e], p, ev, label) === e; }); };
    var joursForfait = {}; liste.forEach(function (e) { if (e.item === ev.item || estF(e)) joursForfait[e.jour] = 1; });
    return liste.filter(function (e) {
      if (e.item === ev.item || voulue(e)) return false;
      if (estF(e)) return true;
      if (!estPause(e) || !joursForfait[e.jour]) return false;
      return !liste.some(function (x) { return x.jour === e.jour && x.item !== ev.item && !estPause(x) && !estF(x); });
    });
  }
  function lirePhaseForfait() {
    return fetch(location.pathname, { credentials: 'same-origin', headers: { Accept: 'text/html' } }).then(function (r) { return r.text(); }).then(function (t) {
      return etapesDe(new DOMParser().parseFromString(t, 'text/html'));
    });
  }
  function etapesDe(doc) {
    var c = doc.querySelector('[data-controller~="calendar"]'), l = [];
    try { l = JSON.parse(c.getAttribute('data-events') || '[]'); } catch (e) {}
    return l.filter(function (e) { return e.url; }).map(function (e) { return { url: e.url, item: String(e.id || '').replace(/\D/g, ''), nom: e.name || '', lieu: e.location || '', jour: Number(String(e.start).slice(8, 10)) || 1, debut: String(e.start).slice(11, 16), fin: String(e.end).slice(11, 16), hommes: e.nbEmp || 0, mm: e.nbLift || 0, vl: e.nbVehLight || 0, pl: e.nbVehHeavy || 0, societe: e.structure || '', numero: e.contract_number || '' }; });
  }
  // Retire une étape : formulaire de suppression qu'Ulyss joint au formulaire d'édition de cette étape, et de celle-là seule.
  function retirerEtape(e) {
    return fetch(e.url.split('?')[0] + '/edit', { credentials: 'same-origin', headers: { Accept: 'text/vnd.turbo-stream.html, text/html' } }).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (t) {
      var d = new DOMParser().parseFromString(t.replace(/<\/?template>/g, ''), 'text/html');
      var f = [].slice.call(d.querySelectorAll('form')).filter(function (x) { var m = x.querySelector('[name="_method"]'); return m && m.value === 'delete' && new RegExp('/schedule_requirements/' + e.item + '(\\?|$)').test(x.getAttribute('action') || ''); })[0];
      if (!f) return Promise.reject('Commande de retrait introuvable pour une étape.');
      return fetch(f.getAttribute('action'), { method: 'POST', body: new FormData(f), credentials: 'same-origin', headers: { Accept: 'text/vnd.turbo-stream.html, text/html' } });
    });
  }
  // Écrit le forfait dans la pré-planification. compo = { label, hommes, operateur, vl, pl, mm } : ce que porte chaque étape de travail.
  // La première plage réutilise l'étape choisie (formulaire entier d'Ulyss, renvoyé avec les seuls champs du forfait changés) ;
  // on retire ensuite les étapes de forfait devenues inutiles, on crée celles qui manquent, et on relit toute la phase.
  function appliquerForfait(ev, fo, compo) {
    var I = 'schedule_requirement_item', C = I + '[schedule_collaborators_attributes]', V = I + '[schedule_vehicules_attributes]', cible = compo.hommes, label = compo.label;
    var envoi = function (f, fd) { return fetch(f.getAttribute('action'), { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'text/vnd.turbo-stream.html, text/html' } }); };
    var clesDe = function (fd) { var k = []; fd.forEach(function (x, n) { k.push(n); }); return k; };
    return lireFormulaireEtape(ev).then(function (f) {
      // Types de véhicule et compétences d'Ulyss, retrouvés par leur libellé. Une étape sans véhicule (ou sans déménageur) n'a aucun
      // sélecteur affiché : la liste est alors dans le gabarit « ajouter un emplacement » du formulaire ; à défaut, on prend les
      // identifiants connus d'Ulyss (1 Véhicule léger 20 m³, 2 Monte meuble, 3 Poids lourd 50 m³, compétence 9 Monte-meubles).
      var sources = [f].concat([].slice.call(f.querySelectorAll('[data-form-element-list-form-value]')).map(function (x) { return new DOMParser().parseFromString(x.getAttribute('data-form-element-list-form-value') || '', 'text/html'); }));
      var option = function (champ, re) {
        for (var i = 0; i < sources.length; i++) {
          var sels = [].slice.call(sources[i].querySelectorAll('select')).filter(function (x) { return (x.getAttribute('name') || '').indexOf(champ) >= 0; });
          for (var j = 0; j < sels.length; j++) { var o = [].slice.call(sels[j].options).filter(function (y) { return re.test(y.textContent); })[0]; if (o) return o; }
        }
        return null;
      };
      var capMM = (option('capability_ids', /monte/i) || { value: '9' }).value, premier = new FormData(f), lieu = premier.get(I + '[place_id]') || '', activite = premier.get(I + '[activity]') || 'loading';
      // Les véhicules voulus, dans l'ordre : chacun avec l'identifiant de son type dans Ulyss et son volume de référence.
      var voulus = [];
      [[compo.pl, /lourd/i, '3', '50'], [compo.vl, /l[ée]ger/i, '1', '20'], [compo.mm, /monte/i, '2', '0']].forEach(function (x) {
        if (!x[0]) return;
        var o = option('vehicule_type_id', x[1]), v = o ? { type: o.value, vol: String(nombre(o.getAttribute('data-volume'))) } : { type: x[2], vol: x[3] };
        for (var n = 0; n < x[0]; n++) voulus.push(v);
      });
      var d0 = parseFloat(premier.get(I + '[start_hour]')), plages = plagesForfait(fo, ev, d0), p0 = plages[0];
      var operateur = compo.operateur && capMM;
      // Le formulaire d'une étape existante, avec les seuls champs du forfait changés : intitulé, heures, déménageurs, véhicules.
      var preparer = function (g, p) {
        var fd = new FormData(g), cles = function () { return clesDe(fd); };
        var index = function (prefixe) { var o = {}; cles().forEach(function (k) { var m = k.indexOf(prefixe + '[') === 0 && k.slice(prefixe.length).match(/^\[(\d+)\]\[id\]$/); if (m) o[m[1]] = 1; }); return Object.keys(o).map(Number).sort(function (x, y) { return x - y; }); };
        fd.delete('draft');
        fd.set(I + '[label]', label); fd.set(I + '[start_hour]', p.debut.toFixed(1)); fd.set(I + '[end_hour]', p.fin.toFixed(1));
        cles().filter(function (k) { return /\[spread\]$/.test(k); }).forEach(function (k) { fd.set(k, 'false'); });   // n'écrire que cette étape
        var hommes = index(C), suivant = (hommes.length ? hommes[hommes.length - 1] : 0) + 1;
        hommes.forEach(function (n, rang) {
          if (rang >= cible) { fd.set(C + '[' + n + '][_destroy]', '1'); return; }
          if (rang === 0 && operateur) { fd.delete(C + '[' + n + '][capability_ids][]'); fd.append(C + '[' + n + '][capability_ids][]', ''); fd.append(C + '[' + n + '][capability_ids][]', capMM); }
        });
        for (var k = hommes.length; k < cible; k++, suivant++) { fd.set(C + '[' + suivant + '][spread]', 'false'); fd.append(C + '[' + suivant + '][capability_ids][]', ''); if (k === 0 && operateur) fd.append(C + '[' + suivant + '][capability_ids][]', capMM); }
        var vehs = index(V), vsuivant = (vehs.length ? vehs[vehs.length - 1] : 0) + 1;
        vehs.forEach(function (n, rang) { if (rang >= voulus.length) fd.set(V + '[' + n + '][_destroy]', '1'); else { fd.set(V + '[' + n + '][vehicule_type_id]', voulus[rang].type); fd.set(V + '[' + n + '][volume_in_float]', voulus[rang].vol); } });
        for (var w = vehs.length; w < voulus.length; w++, vsuivant++) { fd.set(V + '[' + vsuivant + '][spread]', 'false'); fd.set(V + '[' + vsuivant + '][vehicule_type_id]', voulus[w].type); fd.set(V + '[' + vsuivant + '][volume_in_float]', voulus[w].vol); fd.append(V + '[' + vsuivant + '][characteristic_ids][]', ''); }
        return fd;
      };
      var fd = preparer(f, p0);
      var base = (ev.url.split('?')[0].match(/^(.*\/schedule_requirements)\/\d+\/schedule_requirement_items\/\d+$/) || [])[1];
      var jeton = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
      // Crée une étape : Ulyss rend d'abord un formulaire brouillon pour le jour et l'heure demandés, que l'on complète et renvoie.
      var creer = function (p) {
        if (!base) return Promise.reject('Adresse de création d\'étape introuvable.');
        return fetch(base, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'text/vnd.turbo-stream.html, text/html', 'X-CSRF-Token': jeton },
          body: JSON.stringify({ schedule_requirement_item: { start_hour: p.debut, end_hour: p.fin, schedule_requirement: { week_position: p.jour } }, draft: true }) }).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (t) {
          var d = new DOMParser().parseFromString(t.replace(/<\/?template>/g, ''), 'text/html'), g = [].slice.call(d.querySelectorAll('form')).filter(function (x) { return x.querySelector('[name="' + I + '[start_hour]"]'); })[0];
          if (!g) return Promise.reject();
          var gd = new FormData(g); gd.delete('draft');
          clesDe(gd).filter(function (k) { return /schedule_(collaborators|vehicules)_attributes/.test(k); }).forEach(function (k) { gd.delete(k); });
          gd.set(I + '[label]', p.pause ? 'Pause' : label); gd.set(I + '[activity]', p.pause ? 'break' : activite); gd.set(I + '[place_id]', p.pause ? '' : lieu);
          gd.set(I + '[start_hour]', p.debut.toFixed(1)); gd.set(I + '[end_hour]', p.fin.toFixed(1));
          if (!p.pause) {
            for (var n = 1; n <= cible; n++) { gd.set(C + '[' + n + '][spread]', 'false'); gd.append(C + '[' + n + '][capability_ids][]', ''); if (n === 1 && operateur) gd.append(C + '[' + n + '][capability_ids][]', capMM); }
            voulus.forEach(function (v, i) { var P = V + '[' + (i + 1) + ']'; gd.set(P + '[spread]', 'false'); gd.set(P + '[vehicule_type_id]', v.type); gd.set(P + '[volume_in_float]', v.vol); gd.append(P + '[characteristic_ids][]', ''); });
          }
          return envoi(g, gd);
        });
      };
      var lirePhase = lirePhaseForfait, presente = function (liste, p) { return plagePresente(liste, p, ev, label); }, retirees = 0;
      var conforme = function (x) { return x.hommes === cible && x.mm === compo.mm && x.vl === compo.vl && x.pl === compo.pl; };
      return envoi(f, fd).then(lirePhase).then(function (liste) {
        var enTrop = etapesARetirer(liste, plages, ev, label), suite = Promise.resolve();
        retirees = enTrop.length;
        enTrop.forEach(function (e) { suite = suite.then(function () { return retirerEtape(e); }); });
        return suite.then(lirePhase);
      }).then(function (liste) {
        // Les autres étapes du forfait déjà en place (après-midi, jour suivant) reçoivent les mêmes moyens que la première :
        // un déménageur ou un véhicule ajouté vaut pour toute la durée du forfait.
        var aCreer = plages.slice(1).filter(function (p) { return !presente(liste, p); }), suite = Promise.resolve();
        plages.slice(1).forEach(function (p) {
          var x = !p.pause && presente(liste, p);
          if (x && !conforme(x)) suite = suite.then(function () { return lireFormulaireEtape(x); }).then(function (g) { return envoi(g, preparer(g, p)); });
        });
        aCreer.forEach(function (p) { suite = suite.then(function () { return creer(p); }); });
        return suite.then(function () { return aCreer.length; });
      }).then(function (creees) {
        return Promise.all([lireFormulaireEtape(ev), lirePhase()]).then(function (r) {
          var e = etatEtape(r[0]), liste = r[1], moi = liste.filter(function (x) { return x.item === ev.item; })[0];
          var ok = Math.abs(e.debut - p0.debut) < 0.01 && Math.abs(e.fin - p0.fin) < 0.01 && e.hommes === cible && e.vehicules.length === voulus.length && !!moi && conforme(moi);
          plages.slice(1).forEach(function (p) { var x = presente(liste, p); if (!x || (!p.pause && !conforme(x))) ok = false; });
          if (etapesARetirer(liste, plages, ev, label).length) ok = false;
          // Étapes de la phase hors forfait (autres adresses, autres opérations) : signalées, jamais touchées.
          var autres = liste.filter(function (x) { return x.item !== ev.item && !plages.slice(1).some(function (p) { return presente([x], p); }); }).length;
          return { ok: ok, etat: e, creees: creees, retirees: retirees, autres: autres };
        });
      });
    });
  }
  function annonceRetraits(tous, fo, ev, label) {
    var r = etapesARetirer(tous, plagesForfait(fo, ev, Number(ev.debut.slice(0, 2)) + Number(ev.debut.slice(3)) / 60), ev, label);
    if (!r.length) return '';
    return ' ' + r.length + ' étape' + (r.length > 1 ? 's seront retirées' : ' sera retirée') + ' : ' + r.map(function (e) { return e.nom + ' jour ' + e.jour + ' ' + e.debut + '–' + e.fin; }).join(', ') + '.';
  }
  function decrirePlages(fo, ev) {
    var jours = {};
    fo.plages.forEach(function (p) { if (p[3] === 'pause') return; (jours[p[0]] = jours[p[0]] || []).push(p[1] == null ? heureTexte(p[2]) + ' à partir de ' + ev.debut : heureTexte(p[1]) + ' – ' + heureTexte(p[2])); });
    var k = Object.keys(jours);
    return k.map(function (j) { return (k.length > 1 ? 'jour ' + (ev.jour + Number(j)) + ' : ' : '') + jours[j].join(' et '); }).join(' ; ');
  }
  function pluriel(n, mot, mots) { return n + ' ' + (n > 1 ? (mots || mot + 's') : mot); }
  function ouvrirForfait() {
    if (!tarifsPrets()) { demanderCode(ouvrirForfait); return; }
    fermer();
    var tous = etapesDe(document), evs = tous.filter(function (e) { return !/^\s*pause\s*$/i.test(e.nom); });
    var soc = (SOCIETES.filter(function (x) { return x[0].test((evs[0] || {}).societe || ''); })[0] || [0, 'fra'])[1], g = GRILLES_REFERENCE[soc];
    // type : 'mm' location de monte-meuble · 'as' assistance. Chaque type garde son choix de durée et sa composition.
    forfait = { ev: evs.length === 1 ? 0 : -1, type: 'mm', f: { mm: '', as: '' }, sup: 0, as: { hommes: 1, vl: 0, pl: 0, mm: 0 }, ecrit: false, modifie: false };
    hote = document.createElement('div'); hote.id = 'gc-panneau';
    racine = hote.attachShadow({ mode: 'open' });
    var ligne = function (id, texte, aide) { return '<div class="fo-r"><span>' + texte + (aide ? '<small class="fo-a" id="' + id + '-a"></small>' : '') + '</span><span class="fo-n"><button data-moins="' + id + '" aria-label="' + texte + ' : un de moins">−</button><b id="' + id + '">0</b><button data-plus="' + id + '" aria-label="' + texte + ' : un de plus">+</button></span></div>'; };
    var prix = function (id, texte) { return '<div class="fo-r" id="' + id + '-l"><label for="' + id + '">' + texte + ', € HT</label><input class="fo-p" id="' + id + '" inputmode="decimal" placeholder="à saisir"></div>'; };
    racine.innerHTML = '<style>' + STYLE + '.fo-l{display:flex;flex-direction:column;gap:8px}.fo-o{display:flex;gap:10px;align-items:flex-start;text-align:left;width:100%;padding:11px 12px;border:1.5px solid #cfd6dd;border-radius:8px;background:#fff;cursor:pointer;font:inherit;color:inherit}.fo-o[aria-pressed=true]{border-color:var(--soc,#0f6b7a);box-shadow:inset 0 0 0 1px var(--soc,#0f6b7a);background:#f6fafb}.fo-o small{display:block;color:#5a6876;font-size:12.5px}.fo-g{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.fo-g .fo-o{flex-direction:column;gap:2px;align-items:center;justify-content:center;text-align:center;font-weight:600}.fo-g .fo-o small{font-weight:400}.fo-c{display:flex;align-items:center;gap:10px;cursor:pointer}.fo-c input{width:22px;height:22px}.fo-r{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}.fo-a{display:block;color:#5a6876;font-size:12.5px}.fo-n{display:flex;align-items:center;gap:10px}.fo-n button{width:40px;height:40px;border-radius:8px;border:1.5px solid #cfd6dd;background:#fff;font:600 20px system-ui;cursor:pointer}.fo-n b{min-width:22px;text-align:center;font-size:17px}.fo-p{width:120px;padding:9px 10px;border:1.5px solid #cfd6dd;border-radius:8px;font:inherit;text-align:right}#fo-reporter{background:var(--soc,#0f6b7a);color:#fff;border-color:transparent;font-weight:600;min-height:48px}#fo-reporter:disabled{opacity:.45;cursor:default}.fo-res{margin:0;padding:10px 12px;border-radius:8px;background:#e9eef2}.fo-ok{background:#e3f3e6;color:#17572a}.fo-ko{background:#fde8e8;color:#8a1c1c}</style>' +
      '<div class="fond"><div class="tiroir" id="tiroir" role="dialog" aria-label="Forfait" style="--soc:' + ({ fra: '#14284b', ldl: '#c1272d', bd: '#e07b12' }[soc]) + '"><div class="tete"><div><div class="prix" id="fo-prix"><b>Forfait</b></div></div><button class="croix" id="fermer" title="Fermer" aria-label="Fermer"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></div>' +
      '<div class="fo-g" id="fo-types"><button class="fo-o" data-type="mm">Location monte-meuble<small>avec opérateur</small></button><button class="fo-o" data-type="as">Assistance<small>déménageurs, véhicules</small></button></div>' +
      '<section class="carte"><h2>Adresse</h2><div class="fo-l" id="fo-evs"></div></section>' +
      '<section class="carte" id="fo-s-mm"><h2>Monte-meuble avec opérateur</h2><div class="fo-g" id="fo-fs-mm"></div>' + ligne('fo-sup', 'Déménageurs en plus de l\'opérateur') + prix('fo-pf', 'Forfait monte-meuble') + prix('fo-ph', 'Déménageurs en plus') + '</section>' +
      '<section class="carte" id="fo-s-as" hidden><h2>Assistance</h2><div class="fo-g" id="fo-fs-as"></div>' + ligne('fo-as-hommes', 'Déménageurs', true) + ligne('fo-as-vl', 'Véhicule léger 20 m³', true) + ligne('fo-as-pl', 'Poids lourd', true) + ligne('fo-as-mm', 'Monte-meuble', true) + prix('fo-as-pmo', 'Main-d\'œuvre') + prix('fo-as-pveh', 'Véhicules') + prix('fo-as-pmm', 'Monte-meuble') + '</section>' +
      '<section class="carte" id="fo-pan-c" hidden><div class="fo-r" style="margin-top:0"><span>Panneaux de stationnement<small class="fo-a" id="fo-pan-t"></small></span><span id="fo-pan-p" style="white-space:nowrap"></span></div></section>' +
      '<p class="fo-res" id="fo-res" role="status" hidden></p><button class="b" id="fo-reporter" disabled>Reporter le prix dans l\'estimation Ulyss</button></div></div>';
    document.body.appendChild(hote);
    var q = function (id) { return racine.getElementById(id); };
    // Sortie : on laisse finir l'écriture en cours avant de recharger la page, sinon elle serait coupée.
    var sortir = function () {
      if (minuteur) { clearTimeout(minuteur); minuteur = null; ecrire(); }
      var fin = function () { var recharger = forfait && forfait.modifie; fermer(); if (recharger) { if (window.__chiffrageApercu) document.dispatchEvent(new Event('gc-apercu-maj')); else location.reload(); } };
      if (enCours) attendre(function () { return !enCours; }, 30000).then(fin); else fin();
    };
    q('fermer').addEventListener('click', sortir);
    racine.querySelector('.fond').addEventListener('click', function (e) { if (e.target === e.currentTarget) sortir(); });
    q('fo-evs').innerHTML = evs.length ? evs.map(function (e, i) { return '<button class="fo-o" data-ev="' + i + '"><span><b>' + echappe(e.nom) + '</b> · jour ' + e.jour + ' · ' + e.debut + '–' + e.fin + '<small>' + echappe(e.lieu) + '</small></span></button>'; }).join('') : '<p class="note" style="margin:0">Aucune étape dans la pré-planification de cette phase : le forfait a besoin d\'une adresse déjà posée par Ulyss.</p>';
    // Panneaux : pas de case à cocher. On reprend ce qui est enregistré sur l'adresse dans le dossier (cases « Panneaux » et
    // « Dem. de stationnement » du lieu), lu sur la fiche du lieu de l'étape choisie. Lecture seule.
    var panneaux = {};   // par étape : { etat: 'lecture' | 'oui' | 'non' | 'inconnu', local }
    var lirePanneaux = function (i) {
      var ev = evs[i]; if (!ev || panneaux[i]) return;
      panneaux[i] = { etat: 'lecture' };
      var dossier = (ev.url.match(/\/contracts\/(\d+)\//) || [])[1];
      lireFormulaireEtape(ev).then(function (f) {
        var lieu = (f.querySelector('[name="schedule_requirement_item[place_id]"]') || {}).value;
        return lieu && dossier ? lireLieu(dossier, lieu) : Promise.reject();
      }).then(function (l) { panneaux[i] = { etat: l.panneaux ? 'oui' : 'non', local: l.local }; })
        .catch(function () { panneaux[i] = { etat: 'inconnu' }; }).then(function () { if (forfait && hote) maj(); });
    };
    var prixPanneaux = function () { var x = panneaux[forfait.ev]; return x && x.etat === 'oui' ? (x.local ? g.pan87 : g.panHors) || 0 : 0; };
    var de = function (type) { return FORFAITS.filter(function (x) { return x.type === type; }); };
    q('fo-fs-mm').innerHTML = de('mm').map(function (x) { return '<button class="fo-o" data-f="' + x.id + '">' + echappe(x.label) + (x.prix[soc] != null ? '<small>' + fr(x.prix[soc]) + ' € HT</small>' : '') + '</button>'; }).join('');
    q('fo-fs-as').innerHTML = de('as').map(function (x) { return '<button class="fo-o" data-f="' + x.id + '">' + echappe(x.label) + '<small>' + fr(x.homme[soc]) + ' € HT par déménageur</small></button>'; }).join('');
    var courant = function () { return FORFAITS.filter(function (x) { return x.id === forfait.f[forfait.type]; })[0]; };
    // Composition écrite dans Ulyss sur chaque étape de travail.
    var composition = function () {
      if (forfait.type === 'mm') return { label: 'Location monte-meuble', hommes: 1 + forfait.sup, operateur: true, vl: 0, pl: 0, mm: 1 };
      var a = forfait.as; return { label: 'Assistance', hommes: a.hommes, operateur: a.mm > 0 && a.hommes > 0, vl: a.vl, pl: a.pl, mm: a.mm };
    };
    // Tarifs de l'assistance : hommes au forfait de la durée ; véhicules au tarif jour de la grille de la société, au prorata de la durée.
    var tarifsAs = function (fo) { var part = fo ? fo.part : 1; return { homme: fo ? fo.homme[soc] : 0, vl: g.veh[0][0] * part, pl: g.veh[2][0] * part, mm: g.mm[0] * part }; };
    var decrire = function (c) {
      var m = [];
      if (c.hommes) m.push(forfait.type === 'mm' ? '1 opérateur' + (c.hommes > 1 ? ' + ' + pluriel(c.hommes - 1, 'déménageur') : '') : pluriel(c.hommes, 'déménageur') + (c.operateur ? ' dont 1 opérateur monte-meuble' : ''));
      if (c.pl) m.push(pluriel(c.pl, 'poids lourd', 'poids lourds')); if (c.vl) m.push(pluriel(c.vl, 'véhicule léger', 'véhicules légers')); if (c.mm) m.push(pluriel(c.mm, 'monte-meuble'));
      return m.join(', ');
    };
    var montants = function () {
      var pan = prixPanneaux();
      if (forfait.type === 'mm') return { mm: nombre(q('fo-pf').value), mo: forfait.sup ? nombre(q('fo-ph').value) : 0, veh: 0, pan: pan };
      var a = forfait.as; return { mo: a.hommes ? nombre(q('fo-as-pmo').value) : 0, veh: a.vl + a.pl ? nombre(q('fo-as-pveh').value) : 0, mm: a.mm ? nombre(q('fo-as-pmm').value) : 0, pan: pan };
    };
    var maj = function (recalcul) {
      var fo = courant(), ev = evs[forfait.ev], a = forfait.as, c = composition(), t = tarifsAs(forfait.type === 'as' ? fo : null), as = forfait.type === 'as';
      [].slice.call(racine.querySelectorAll('[data-type]')).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-type') === forfait.type)); });
      [].slice.call(racine.querySelectorAll('[data-ev]')).forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-ev')) === forfait.ev)); });
      [].slice.call(racine.querySelectorAll('[data-f]')).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-f') === forfait.f[forfait.type])); });
      q('fo-s-mm').hidden = as; q('fo-s-as').hidden = !as;
      q('fo-sup').textContent = forfait.sup; q('fo-ph-l').hidden = !forfait.sup;
      q('fo-as-hommes').textContent = a.hommes; q('fo-as-vl').textContent = a.vl; q('fo-as-pl').textContent = a.pl; q('fo-as-mm').textContent = a.mm;
      q('fo-as-pmo-l').hidden = !a.hommes; q('fo-as-pveh-l').hidden = !(a.vl + a.pl); q('fo-as-pmm-l').hidden = !a.mm;
      var parUnite = function (x) { return as && fo ? fr(x, 2) + ' € HT l\'unité' : ''; };
      q('fo-as-hommes-a').textContent = parUnite(t.homme); q('fo-as-vl-a').textContent = parUnite(t.vl); q('fo-as-pl-a').textContent = parUnite(t.pl); q('fo-as-mm-a').textContent = parUnite(t.mm);
      if (recalcul && fo && !as) { var p = fo.prix[soc], h = fo.hommeSup[soc]; q('fo-pf').value = p == null ? '' : fr(p, 2); q('fo-ph').value = h == null ? '' : fr(h * forfait.sup, 2); }
      if (recalcul && fo && as) { q('fo-as-pmo').value = fr(t.homme * a.hommes, 2); q('fo-as-pveh').value = fr(t.vl * a.vl + t.pl * a.pl, 2); q('fo-as-pmm').value = fr(t.mm * a.mm, 2); }
      var px = panneaux[forfait.ev], etatP = px ? px.etat : '';
      q('fo-pan-c').hidden = !(ev && (etatP === 'oui' || etatP === 'inconnu'));
      q('fo-pan-p').textContent = etatP === 'oui' ? fr(prixPanneaux()) + ' € HT' : '';
      q('fo-pan-t').textContent = etatP === 'oui' ? 'Demandés sur cette adresse dans le dossier, tarif ' + (px.local ? 'local' : 'national') + '.' : etatP === 'inconnu' ? 'Fiche de l\'adresse illisible : non comptés, à vérifier.' : '';
      var m = montants(), total = m.mm + m.mo + m.veh + m.pan;
      q('fo-prix').innerHTML = total > 0 ? '<b>' + fr(total, 2) + '€HT</b> - ' + fr(total * 1.2, 2) + '€TTC' : '<b>Forfait</b>';
      var vide = as && !(a.hommes + a.vl + a.pl + a.mm);
      q('fo-reporter').disabled = !forfait.ecrit || enCours || !!minuteur;
    };
    // Écriture directe (demande du 22/11/2026) : dès que l'adresse et la durée sont choisies, chaque changement — durée, déménageur en
    // plus, véhicule… — est écrit aussitôt sur l'étape dans Ulyss, sans bouton « Appliquer ». Les appuis rapprochés sont regroupés,
    // et une écriture attend la fin de la précédente.
    var enCours = false, aRefaire = false, minuteur = null;
    var etat = function (classe, texte) { q('fo-res').className = 'fo-res' + (classe ? ' ' + classe : ''); q('fo-res').hidden = !texte; q('fo-res').textContent = texte; };
    var pret = function () { var fo = courant(), a = forfait.as; return !!(fo && evs[forfait.ev]) && !(forfait.type === 'as' && !(a.hommes + a.vl + a.pl + a.mm)); };
    var planifier = function () {
      clearTimeout(minuteur); minuteur = null;
      if (!pret()) { maj(); return; }
      etat('', 'Écriture dans Ulyss…');
      minuteur = setTimeout(function () { minuteur = null; ecrire(); }, 600);
      maj();
    };
    var ecrire = function () {
      if (enCours) { aRefaire = true; return; }
      if (!pret()) return;
      var fo = courant(), ev = evs[forfait.ev], c = composition();
      enCours = true; forfait.modifie = true; forfait.ecrit = false; maj();
      appliquerForfait(ev, fo, c).then(function (r) {
        if (aRefaire || minuteur || !hote) return;   // un changement plus récent attend : on n'affiche que le dernier résultat
        var e = r.etat, texte = e.label + ', ' + heureTexte(e.debut) + ' – ' + heureTexte(e.fin) + ', ' + pluriel(e.hommes, 'homme') + (e.operateurs ? ' dont ' + e.operateurs + ' opérateur monte-meuble' : '') + ', ' + (e.vehicules.join(' + ') || 'aucun véhicule') + '.';
        if (!r.ok) { etat('fo-ko', 'Le résultat relu dans Ulyss ne correspond pas à ce qui est demandé : ' + texte + ' Vérifiez la pré-planification.'); return; }
        forfait.ecrit = true;
        etat('fo-ok', 'Pré-planification à jour : ' + texte + (r.retirees ? ' ' + pluriel(r.retirees, 'étape retirée', 'étapes retirées') + '.' : '') + (r.creees ? ' ' + pluriel(r.creees, 'étape créée', 'étapes créées') + '.' : '') + (r.autres ? ' ' + (r.autres > 1 ? r.autres + ' autres étapes de la phase n\'ont pas été touchées.' : '1 autre étape de la phase n\'a pas été touchée.') : ''));
      }).catch(function (m) { if (hote) etat('fo-ko', (typeof m === 'string' ? m : 'L\'étape n\'a pas pu être lue ou écrite dans Ulyss.') + ' Vérifiez la pré-planification.'); })
        .then(function () { enCours = false; if (aRefaire) { aRefaire = false; ecrire(); } else if (hote) maj(); });
    };
    var bornes = { 'fo-sup': [0, 8], 'fo-as-hommes': [0, 12], 'fo-as-vl': [0, 6], 'fo-as-pl': [0, 6], 'fo-as-mm': [0, 3] };
    var compteur = function (id, pas) {
      var cle = id === 'fo-sup' ? null : id.replace('fo-as-', ''), v = (cle ? forfait.as[cle] : forfait.sup) + pas;
      if (v < bornes[id][0] || v > bornes[id][1]) return;
      if (cle) forfait.as[cle] = v; else forfait.sup = v;
      maj(true); planifier();
    };
    racine.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
      if (b.hasAttribute('data-type')) { if (forfait.type === b.getAttribute('data-type')) return; forfait.type = b.getAttribute('data-type'); maj(true); planifier(); }
      else if (b.hasAttribute('data-ev')) { forfait.ev = Number(b.getAttribute('data-ev')); lirePanneaux(forfait.ev); maj(); planifier(); }
      else if (b.hasAttribute('data-f')) { forfait.f[forfait.type] = b.getAttribute('data-f'); maj(true); planifier(); }
      else if (b.hasAttribute('data-plus')) compteur(b.getAttribute('data-plus'), 1);
      else if (b.hasAttribute('data-moins')) compteur(b.getAttribute('data-moins'), -1);
    });
    ['fo-pf', 'fo-ph', 'fo-as-pmo', 'fo-as-pveh', 'fo-as-pmm'].forEach(function (id) { q(id).addEventListener('input', function () { maj(); }); });
    q('fo-reporter').addEventListener('click', function () { var m = montants(); fermer(); reporterForfait(m); });
    if (forfait.ev >= 0) lirePanneaux(forfait.ev);
    maj();
  }
  // Le prix du forfait dans l'estimation d'Ulyss, chaque montant dans sa case : monte-meuble, main-d'œuvre, véhicules, panneaux ; le reste à zéro.
  function reporterForfait(m) {
    var lien = document.querySelector('a#new_proposal-link'), averti = false;
    if (!lien) { bandeauPage(document.body, 'Bouton « Estimation » introuvable : le prix du forfait n\'a pas été reporté.', true); return; }
    [].slice.call(document.querySelectorAll('#new_proposal_modal form')).forEach(function (f) { f.setAttribute('data-gc-ancien', '1'); });
    lien.click();
    attendre(function () {
      var mo = document.querySelector('#new_proposal_modal'), f = mo && mo.querySelector('form[action*="/proposals"]:not([data-gc-ancien])');
      if (f) return f;
      var c = mo && !averti && [].slice.call(mo.querySelectorAll('a')).filter(function (a) { return /new_from_warning_modal/.test(a.getAttribute('href') || ''); })[0];
      if (c) { averti = true; c.click(); }
      return null;
    }, 15000).then(function (form) {
      if (!form) { bandeauPage(document.body, 'L\'estimation d\'Ulyss ne s\'est pas ouverte. Le prix du forfait n\'a pas été reporté.', true); return; }
      var total = 0, parCas = { mm: m.mm || 0, mo: m.mo || 0, veh: m.veh || 0, pan: m.pan || 0 };
      [].slice.call(form.querySelectorAll('input[name*="[title]"]')).forEach(function (t) {
        var cas = TITRES_ULYSS[t.value.trim()], nom = t.name.replace('[title]', '[unit_ht_in_float]');
        if (!cas) return;
        var v = (parCas[cas] || 0).toFixed(2);
        [].slice.call(form.querySelectorAll('input')).forEach(function (i) { if (i.name !== nom) return; i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
        total += Number(v);
      });
      var detail = [['mm', 'monte-meuble'], ['mo', 'main-d\'œuvre'], ['veh', 'véhicules'], ['pan', 'panneaux']].filter(function (x) { return parCas[x[0]] > 0; }).map(function (x) { return x[1] + ' ' + euros(parCas[x[0]]); }).join(', ');
      bandeauPage(form, 'Forfait reporté : ' + euros(total) + ' HT' + (detail ? ' (' + detail + ')' : '') + ', les autres postes à zéro. Vérifiez, puis cliquez sur Valider.' + (total > 0 ? '' : ' Attention : aucun prix n\'a été saisi dans le panneau.'), !(total > 0));
      form.addEventListener('submit', function () { if (!window.__chiffrageApercu) setTimeout(function () { location.reload(); }, 2500); });
    });
  }
  // ---------- Moyens par étape, au-dessus de la pré-planification (demande du 23/11/2026) ----------
  // Information seule : rien n'est écrit ni corrigé. Une ligne par étape de la phase affichée, avec ses déménageurs et ses véhicules,
  // lisible même quand le créneau est trop court pour que le calendrier d'Ulyss montre les moyens. Ce qui change par rapport à
  // l'étape précédente est surligné : un écart n'est pas forcément une erreur, il doit seulement se voir tout de suite.
  // Détail des véhicules de chaque étape (demande du 23/11/2026 : « 1 PL » ne suffit pas, il faut le volume et les spécificités).
  // Le calendrier ne donne que des compteurs : le type, le volume et les caractéristiques sont lus dans le formulaire de chaque
  // étape (lecture seule, quatre à la fois), une fois par état de la pré-planification.
  var moyensDetail = { sig: null, parItem: {}, pret: false };
  function sigleVehicule(type) {
    var t = String(type || '').replace(/\s+/g, ' ').trim();
    return /l[ée]ger/i.test(t) ? 'VL' : /lourd/i.test(t) ? 'PL' : /monte/i.test(t) ? 'MM' : t || 'véhicule';
  }
  function vehiculesDuFormulaire(f) {
    return [].slice.call(f.querySelectorAll('select[name*="schedule_vehicules_attributes"][name$="[vehicule_type_id]"]')).map(function (sel) {
      var base = sel.name.replace(/\[vehicule_type_id\]$/, '');
      var retire = f.querySelector('input[name="' + base + '[_destroy]"]');
      if (retire && /^(1|true)$/.test(retire.value)) return null;
      var vol = f.querySelector('input[name="' + base + '[volume_in_float]"]'), car = f.querySelector('select[name="' + base + '[characteristic_ids][]"]');
      var v = vol ? nombre(vol.value) : 0;
      var specs = car ? [].slice.call(car.selectedOptions).map(function (o) { return o.textContent.replace(/\s+/g, ' ').trim(); }).filter(Boolean) : [];
      return vehicule(sigleVehicule(sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '') + (v > 0 ? ' ' + fr(v) + ' m³' : ''), specs);
    }).filter(Boolean);
  }
  function vehicule(t, specs) { return { t: t, specs: specs || [], cle: t + (specs && specs.length ? ' (' + specs.join(', ') + ')' : '') }; }
  // Regroupe les véhicules identiques : [{ n: 2, t: 'PL 50 m³', specs: ['Hayon'], cle }], triés pour que deux étapes égales se comparent égales.
  function grouperVehicules(liste) {
    var par = {}, ordre = [];
    liste.forEach(function (v) { if (!par[v.cle]) { par[v.cle] = { n: 0, t: v.t, specs: v.specs, cle: v.cle }; ordre.push(v.cle); } par[v.cle].n++; });
    return ordre.sort().map(function (c) { return par[c]; });
  }
  function chargerDetailMoyens(brut, etapes) {
    if (moyensDetail.sig === brut) return;
    var etat = moyensDetail = { sig: brut, parItem: {}, pret: false };
    var file = etapes.filter(function (e) { return e.url && e.item; }), i = 0, actifs = 0;
    var suite = function () {
      if (moyensDetail !== etat) return;   // la pré-planification a changé entre-temps : cette lecture ne sert plus
      if (i >= file.length) { if (!actifs && !etat.pret) { etat.pret = true; poserCoherence(); } return; }
      var e = file[i++]; actifs++;
      lireFormulaireEtape(e).then(function (f) { etat.parItem[e.item] = vehiculesDuFormulaire(f); }, function () { etat.parItem[e.item] = null; }).then(function () { actifs--; suite(); });
    };
    for (var k = 0; k < 4; k++) suite();
  }
  // ---------- Moyens par étape : présentation en « blocs de moyens » (refonte du 24/11/2026) ----------
  // Ce qui compte, c'est où les moyens changent. Les étapes qui se suivent avec exactement les mêmes moyens forment un bloc ;
  // entre deux blocs, on dit ce qui change (+1 déménageur, PL 50 m³ → PL 30 m³…). Huit étapes identiques = un seul bloc.
  var ICONES = {
    homme: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="7.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M4.8 20c.6-4 3.4-6.2 7.2-6.2s6.600 2.200 7.200 6.200" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    camion: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2.500 6.500h11v9.500h-11zM13.500 9.500h4.200l3.300 3.400v3.100h-7.500z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7" cy="17.300" r="1.900" fill="#fff" stroke="currentColor" stroke-width="1.800"/><circle cx="17" cy="17.300" r="1.900" fill="#fff" stroke="currentColor" stroke-width="1.800"/></svg>',
    fleche: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h13M13 6.500l5.500 5.500-5.500 5.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron: '<svg class="gcm-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9.500l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  var STYLE_MOYENS = '#gc-coherence{font:14px/1.4 inherit;font-family:inherit;color:#1f2a44}#gc-coherence *{box-sizing:border-box}' +
    '#gc-coherence details{position:relative}#gc-coherence summary{list-style:none;cursor:pointer;user-select:none}#gc-coherence summary::-webkit-details-marker{display:none}' +
    '.gcm-pill{display:inline-flex;align-items:center;gap:10px;height:40px;padding:0 14px 0 12px;border-radius:999px;background:#fff;border:1px solid #dfe5ee;box-shadow:0 1px 2px rgba(31,42,68,.06);white-space:nowrap;transition:box-shadow .15s,border-color .15s}' +
    '.gcm-pill:hover{border-color:#c5cfdd;box-shadow:0 2px 8px rgba(31,42,68,.10)}#gc-coherence summary:focus-visible .gcm-pill{outline:2px solid #4a7cf6;outline-offset:2px}' +
    '.gcm-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:none}.gcm-pill.ok .gcm-dot{background:#16a34a;box-shadow:0 0 0 3px #dcfce7}.gcm-pill.var .gcm-dot{background:#d97706;box-shadow:0 0 0 3px #fef3c7}' +
    '.gcm-t{font-weight:600}.gcm-pill.var .gcm-t{color:#92400e}.gcm-s{color:#64748b}' +
    '.gcm-mini{display:inline-flex;align-items:center;gap:3px;width:84px;height:6px}.gcm-mini i{display:block;height:6px;border-radius:3px;background:#cbd5e1;min-width:5px}.gcm-pill.ok .gcm-mini i{background:#86efac}.gcm-pill.var .gcm-mini i:nth-child(even){background:#fbbf24}' +
    '.gcm-chev{color:#94a3b8;transition:transform .15s}#gc-coherence details[open] .gcm-chev{transform:rotate(180deg)}' +
    '.gcm-pop{position:absolute;top:calc(100% + 10px);left:50%;transform:translateX(-50%);width:max-content;max-width:min(94vw,1500px);background:#fff;border:1px solid #dfe5ee;border-radius:16px;box-shadow:0 18px 50px rgba(31,42,68,.18);padding:16px 18px 14px;z-index:40}' +
    '.gcm-tete{display:flex;align-items:baseline;justify-content:space-between;gap:24px;margin-bottom:12px}.gcm-tete b{font-size:15px}.gcm-tete span{color:#64748b;font-size:12.5px}' +
    '.gcm-flux{display:flex;flex-wrap:wrap;align-items:stretch;gap:12px 0;max-height:62vh;overflow:auto}.gcm-pas{display:flex;align-items:stretch;flex:none}' +
    '.gcm-bloc{flex:none;min-width:220px;max-width:300px;border:1px solid #e3e8f0;border-radius:12px;background:#f8fafc;padding:12px 14px}' +
    '.gcm-per{display:flex;align-items:center;gap:6px;color:#475569;font-size:12.5px;font-variant-numeric:tabular-nums;margin-bottom:9px}.gcm-per b{color:#1f2a44;font-weight:600}.gcm-per em{font-style:normal;color:#94a3b8}' +
    '.gcm-moy{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}' +
    '.gcm-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-radius:9px;background:#fff;border:1px solid #dbe2ec;font-weight:600;white-space:nowrap}.gcm-chip svg{color:#4a6fd8;flex:none}.gcm-chip.vide{color:#94a3b8;font-weight:500;border-style:dashed}' +
    '.gcm-chip small{font-size:11.500px;font-weight:500;color:#475569;background:#eef2f7;border-radius:5px;padding:1px 6px}.gcm-chip.att{color:#94a3b8}' +
    '.gcm-et{list-style:none;margin:0;padding:8px 0 0;border-top:1px dashed #dbe2ec;display:grid;grid-template-columns:auto auto 1fr;gap:3px 10px;font-size:12.500px;color:#475569;font-variant-numeric:tabular-nums}.gcm-et li{display:contents}.gcm-et .j{color:#94a3b8}.gcm-et .n{color:#1f2a44;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}' +
    '.gcm-delta{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:0 10px;color:#b45309}' +
    '.gcm-delta span{display:block;padding:3px 9px;border-radius:999px;background:#fef3c7;border:1px solid #fcd34d;color:#92400e;font-size:12.500px;font-weight:600;white-space:nowrap}.gcm-delta span.moins{background:#fff;border-color:#e2c48a;color:#a16207}' +
    '.gcm-pied{margin:10px 0 0;color:#64748b;font-size:12px;width:0;min-width:100%}';
  function poserCoherence() {
    var cal = document.querySelector('[data-controller~="calendar"]'), bloc = document.getElementById('gc-coherence');
    if (!(CHEMIN.test(location.pathname) || window.__chiffrageApercu) || !cal || !cal.parentElement) { if (bloc) bloc.remove(); return; }
    // Place : sur la ligne du nom de la phase (nom, trois points … pagination), centré. À défaut de cette ligne, au-dessus du calendrier.
    var titre = document.getElementById('phase-title'), ligne = titre && titre.parentElement ? titre.parentElement.parentElement : null;
    var enPlace = function () { return ligne ? bloc.parentElement === ligne : bloc.nextElementSibling === cal; };
    var brut = cal.getAttribute('data-events') || '[]';
    var sig = brut + (moyensDetail.sig === brut && moyensDetail.pret ? '|détail' : '');
    if (bloc && bloc.getAttribute('data-sig') === sig && enPlace()) return;
    var evs = [];
    try { evs = JSON.parse(brut); } catch (e) {}
    var etapes = evs.filter(function (e) { return e.start && e.end && !/^\s*pause\s*$/i.test(e.name || ''); }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }).map(function (e) {
      return { url: e.url || '', item: String(e.id || '').replace(/\D/g, ''), jour: Number(String(e.start).slice(8, 10)) || 1, debut: String(e.start).slice(11, 16), fin: String(e.end).slice(11, 16), nom: e.name || '', hommes: e.nbEmp || 0, vl: e.nbVehLight || 0, pl: e.nbVehHeavy || 0, mm: e.nbLift || 0 };
    });
    var ouvert = !!(bloc && bloc.querySelector('details[open]'));
    if (!bloc) { bloc = document.createElement('div'); bloc.id = 'gc-coherence'; }
    bloc.setAttribute('data-sig', sig);
    if (!enPlace()) {
      if (ligne) { if (getComputedStyle(ligne).position === 'static') ligne.style.position = 'relative'; ligne.appendChild(bloc); }
      else cal.parentElement.insertBefore(bloc, cal);
    }
    if (etapes.length < 2) { bloc.hidden = true; bloc.innerHTML = ''; return; }
    chargerDetailMoyens(brut, etapes);
    var detailPret = moyensDetail.sig === brut && moyensDetail.pret;
    // Véhicules d'une étape : le détail lu dans son formulaire ; à défaut (illisible, ou pas d'adresse), les compteurs du calendrier.
    etapes.forEach(function (x) {
      var d = detailPret ? moyensDetail.parItem[x.item] : null, l = [];
      if (!d) { for (var i = 0; i < x.vl; i++) l.push(vehicule('VL')); for (i = 0; i < x.pl; i++) l.push(vehicule('PL')); for (i = 0; i < x.mm; i++) l.push(vehicule('MM')); }
      x.veh = grouperVehicules(d || l);
      x.illisible = detailPret && d === null;
      x.cle = x.hommes + ' | ' + x.veh.map(function (v) { return v.n + ' ' + v.cle; }).join(' + ');
    });
    // Blocs : suites d'étapes aux moyens identiques.
    var blocs = [];
    etapes.forEach(function (x) { var b = blocs[blocs.length - 1]; if (b && b.cle === x.cle) b.etapes.push(x); else blocs.push({ cle: x.cle, hommes: x.hommes, veh: x.veh, etapes: [x] }); });
    var n = blocs.length - 1, pluriel = function (k, mot) { return k + ' ' + mot + (k > 1 ? 's' : ''); };
    // Ce qui change d'un bloc au suivant.
    var deltas = function (a, b) {
      var o = [], dh = b.hommes - a.hommes, moins = [], plus = [], cles = {};
      if (dh) o.push('<span>' + (dh > 0 ? '+' : '−') + pluriel(Math.abs(dh), 'déménageur') + '</span>');
      a.veh.forEach(function (v) { cles[v.cle] = (cles[v.cle] || 0) - v.n; }); b.veh.forEach(function (v) { cles[v.cle] = (cles[v.cle] || 0) + v.n; });
      Object.keys(cles).sort().forEach(function (c) { if (cles[c] < 0) moins.push([-cles[c], c]); else if (cles[c] > 0) plus.push([cles[c], c]); });
      if (moins.length === 1 && plus.length === 1 && moins[0][0] === plus[0][0]) o.push('<span>' + (moins[0][0] > 1 ? moins[0][0] + ' ' : '') + echappe(moins[0][1]) + ' → ' + echappe(plus[0][1]) + '</span>');
      else { plus.forEach(function (p) { o.push('<span>+ ' + p[0] + ' ' + echappe(p[1]) + '</span>'); }); moins.forEach(function (m) { o.push('<span class="moins">− ' + m[0] + ' ' + echappe(m[1]) + '</span>'); }); }
      return o.join('');
    };
    var carte = function (b) {
      var p = b.etapes[0], d = b.etapes[b.etapes.length - 1];
      var periode = '<b>Jour ' + p.jour + '</b> ' + p.debut + ' <em>→</em> ' + (d.jour !== p.jour ? '<b>Jour ' + d.jour + '</b> ' : '') + d.fin;
      var moyens = '<span class="gcm-chip' + (b.hommes ? '' : ' vide') + '">' + ICONES.homme + (b.hommes ? pluriel(b.hommes, 'déménageur') : 'aucun déménageur') + '</span>' +
        (b.veh.length ? b.veh.map(function (v) { return '<span class="gcm-chip">' + ICONES.camion + v.n + ' ' + echappe(v.t) + v.specs.map(function (s) { return '<small>' + echappe(s) + '</small>'; }).join('') + '</span>'; }).join('') : '<span class="gcm-chip vide">' + ICONES.camion + 'aucun véhicule</span>') +
        (detailPret ? (b.etapes.some(function (e) { return e.illisible; }) ? '<span class="gcm-chip att">détail illisible</span>' : '') : '<span class="gcm-chip att">volume et spécificités…</span>');
      return '<section class="gcm-bloc"><div class="gcm-per">' + periode + '</div><div class="gcm-moy">' + moyens + '</div><ul class="gcm-et">' +
        b.etapes.map(function (e) { return '<li><span class="j">J' + e.jour + '</span><span>' + e.debut + '–' + e.fin + '</span><span class="n" title="' + echappe(e.nom) + '">' + echappe(e.nom) + '</span></li>'; }).join('') + '</ul></section>';
    };
    // Chaque changement reste collé au bloc qu'il introduit, même quand la ligne passe à la suivante.
    var flux = blocs.map(function (b, i) { return '<div class="gcm-pas">' + (i ? '<div class="gcm-delta" title="Ce qui change à partir de cette étape">' + deltas(blocs[i - 1], b) + ICONES.fleche + '</div>' : '') + carte(b) + '</div>'; }).join('');
    // Mini-frise dans la pastille : un segment par bloc, large comme son nombre d'étapes.
    var mini = '<span class="gcm-mini" aria-hidden="true">' + blocs.map(function (b) { return '<i style="flex:' + b.etapes.length + '"></i>'; }).join('') + '</span>';
    bloc.hidden = false;
    bloc.style.cssText = ligne ? 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30' : 'position:relative;margin:0 0 12px';
    // Toujours replié à l'arrivée : la pastille dit s'il y a des changements, le détail se déplie par-dessus le calendrier sans décaler la page.
    bloc.innerHTML = '<style>' + STYLE_MOYENS + '</style><details' + (ouvert ? ' open' : '') + '><summary><span class="gcm-pill ' + (n ? 'var' : 'ok') + '"><span class="gcm-dot"></span>' +
      '<span class="gcm-t">' + (n ? pluriel(n, 'changement') + ' de moyens' : 'Moyens constants') + '</span><span class="gcm-s">' + etapes.length + ' étapes</span>' + mini + ICONES.chevron + '</span></summary>' +
      '<div class="gcm-pop"><div class="gcm-tete"><b>Moyens par étape</b><span>' + (n ? pluriel(blocs.length, 'bloc') + ' de moyens sur ' + etapes.length + ' étapes' : 'Les mêmes moyens du début à la fin') + '</span></div>' +
      '<div class="gcm-flux">' + flux + '</div>' +
      '<p class="gcm-pied">VL véhicule léger · PL poids lourd · MM monte-meuble. Les étapes qui se suivent avec les mêmes moyens sont regroupées. Information seule.</p></div></details>';
  }
  // Un clic ailleurs dans la page replie le détail des moyens.
  document.addEventListener('click', function (e) { var b = document.getElementById('gc-coherence'), d = b && b.querySelector('details[open]'); if (d && !b.contains(e.target)) d.removeAttribute('open'); });
  var tout = function () { poserBouton(); poserCoherence(); poserVersion(); };
  new MutationObserver(tout).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-events'] });
  tout();

  // ---------- Lecture du dossier ----------
  function lireBandeau() {
    var o = { volume: 0, km: 0, valeur: 0 };
    document.querySelectorAll('#contract_header_banner div').forEach(function (e) {
      var ic = e.firstElementChild ? String(e.firstElementChild.className) : '', v = nombre(e.textContent.replace(/[^\d.,]/g, ''));
      if (e.children.length !== 1) return;
      if (/icon-volume/.test(ic)) o.volume = v; else if (/icon-route/.test(ic)) o.km = v; else if (/icon-estimate/.test(ic)) o.valeur = v;
    });
    return o;
  }
  function lireEvenements(doc) {
    var el = (doc || document).querySelector('[data-events]'), brut = [];
    try { brut = JSON.parse(el.getAttribute('data-events')) || []; } catch (e) {}
    // On ne garde ni le nom du client ni l'adresse.
    return brut.filter(function (e) { return e.nbEmp || e.nbVehLight || e.nbVehHeavy || e.nbLift; }).map(function (e) {
      return {
        nom: e.name, jour: Number(String(e.start).slice(8, 10)), debut: String(e.start).slice(11, 16), fin: String(e.end).slice(11, 16),
        heures: (new Date(e.end) - new Date(e.start)) / 36e5, hommes: e.nbEmp || 0, vl: e.nbVehLight || 0, pl: e.nbVehHeavy || 0, mm: e.nbLift || 0,
        url: e.url, item: String(e.id || '').replace(/\D/g, ''), societe: e.structure || '', numero: e.contract_number || ''
      };
    });
  }
  // Les phases du dossier : liens « /contracts/<id>/phases/<phase> » de la page de pré-planification.
  function lirePhases() {
    var vues = {}, phases = [];
    [].slice.call(document.querySelectorAll('a[href*="/phases/"]')).forEach(function (a) {
      var m = (a.getAttribute('href') || '').match(/^\/contracts\/\d+\/phases\/(\d+)$/);
      if (!m || vues[m[1]]) return;
      vues[m[1]] = true;
      phases.push({ id: m[1], href: m[0], titre: a.textContent.replace(/\s+/g, ' ').trim() || 'Phase ' + (phases.length + 1) });
    });
    return phases;
  }
  // Une seule phase : on lit la page affichée. Plusieurs : on lit la page de chacune.
  function lireEvenementsPhase(ph, seule) {
    if (seule) return Promise.resolve(lireEvenements(document));
    return fetch(ph.href, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(function (t) { return lireEvenements(new DOMParser().parseFromString(t, 'text/html')); })
      .catch(function () { ph.illisible = true; return []; });
  }
  function capacite(volume, defaut) {
    if (!(volume > 0)) return defaut;
    return CAPACITES.reduce(function (a, c) { return Math.abs(c - volume) <= Math.abs(a - volume) ? c : a; }, CAPACITES[0]);
  }
  // Capacité des véhicules : elle n'est pas dans data-events, il faut lire le formulaire de chaque événement.
  function lireVehicules(ev) {
    var parDefaut = function (incertain) {
      var v = {}; if (ev.vl) v[20] = ev.vl; if (ev.pl) v[50] = ev.pl; return { parCapacite: v, incertain: incertain };
    };
    if (!ev.url || !(ev.vl + ev.pl)) return Promise.resolve(parDefaut(false));
    // « <url de l'événement>/edit » renvoie le formulaire de cet événement, et de lui seul (lecture, aucun enregistrement).
    return fetch(ev.url + '/edit', { credentials: 'same-origin', headers: { Accept: 'text/vnd.turbo-stream.html, text/html' } }).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (t) {
      var d = new DOMParser().parseFromString(t.replace(/<\/?template>/g, ''), 'text/html'), v = {}, n = 0, sansRef = [], rq = 0, pl50 = 0;
      [].slice.call(d.querySelectorAll('select[name*="schedule_vehicules_attributes"][name*="vehicule_type_id"]')).forEach(function (s) {
        if (!s.form || (s.form.getAttribute('action') || '').indexOf('/' + ev.item) < 0) return;
        var type = s.selectedOptions[0] ? s.selectedOptions[0].textContent : '';
        if (/monte/i.test(type)) return;
        // Règle du 22/11/2026 : on chiffre d'après le TYPE de véhicule posé dans la pré-planification, pas d'après le volume
        // saisi sur l'événement. Le tarif est celui du volume de référence du type dans Ulyss (Véhicule léger 20 m³, Poids lourd 50 m³…).
        var ref = nombre(s.selectedOptions[0] && s.selectedOptions[0].getAttribute('data-volume'));
        if (!(ref > 0)) sansRef.push(type.replace(/\s+/g, ' ').trim());
        var c = capacite(ref, /lourd/i.test(type) ? 50 : 20);
        v[c] = (v[c] || 0) + 1; n++;
        if (/^\s*RQ\s*$|remorque/i.test(type)) rq++; else if (/lourd/i.test(type) && c === 50) pl50++;
      });
      // Le tarif 100 m³ de la grille = un poids lourd de 50 m³ attelé d'une remorque de 50 m³ (Guillaume, 22/11/2026) :
      // chaque remorque posée avec un poids lourd fait un ensemble à 100 m³, pas deux véhicules à 50 m³.
      var ens = Math.min(rq, pl50);
      if (ens) { v[50] -= 2 * ens; if (!v[50]) delete v[50]; v[100] = (v[100] || 0) + ens; }
      if (rq > ens) sansRef.push('remorque sans poids lourd');
      if (sansRef.length) return { parCapacite: v, incertain: false, note: sansRef.join(', ') + ' : tarif à vérifier' };
      return n > 0 ? { parCapacite: v, incertain: false } : parDefaut(true);
    }).catch(function () { return parDefaut(true); });
  }
  // Une étape = un jour et un nom (« Jour 1 · Chargement »), même si Ulyss la découpe en matin et après-midi.
  // Dans une étape, les moyens identiques (même type, même nombre) cumulent leurs durées.
  function construireLignes(evs, vehs, bandeau, avecDossier) {
    var groupes = [], lignes = [], id = 1, maxi = {}, parCle = {};
    var ajoute = function (g, type, nb, q, note) {
      var deja = lignes.filter(function (l) { return l.g === g.id && l.type === type && l.nombre === nb && typeDe(type).unite === 'j'; })[0];
      if (deja) { deja.quantite = arrondi(deja.quantite + q); deja.ref.quantite = deja.quantite; if (note) deja.note = note; return; }
      lignes.push({ id: id++, g: g.id, origine: 'prep', type: type, nombre: nb, quantite: q, puLibre: 0, note: note || '', ref: { type: type, nombre: nb, quantite: q } });
    };
    evs.forEach(function (e, i) {
      var cle = e.jour + '|' + e.nom, g = parCle[cle], j = arrondi(e.heures / HEURES_PAR_JOUR);
      if (!g) { g = parCle[cle] = { id: groupes.length + 1, origine: 'prep', titre: 'Jour ' + e.jour + ' · ' + e.nom, plages: [], heures: 0 }; groupes.push(g); }
      g.plages.push(e.debut + '–' + e.fin); g.heures += e.heures;
      if (e.hommes) ajoute(g, 'homme', e.hommes, j);
      Object.keys(vehs[i].parCapacite).forEach(function (c) {
        var nb = vehs[i].parCapacite[c];
        ajoute(g, 'v' + c, nb, j, vehs[i].incertain ? 'type de véhicule non lu, à vérifier' : (vehs[i].note || ''));
        maxi[c] = Math.max(maxi[c] || 0, nb);
      });
      if (e.mm) ajoute(g, 'mm', e.mm, j);
    });
    groupes.forEach(function (g) { g.detail = g.plages.join(' et ') + ' · ' + fr(arrondi(g.heures)) + ' h'; });
    if (!avecDossier) return { groupes: groupes, lignes: lignes };   // volume, distance et valeur déclarée ne se comptent qu'une fois
    var d = { id: groupes.length + 1, origine: 'prep', titre: 'Postes du dossier', detail: 'volume, distance, valeur déclarée et panneaux lus sur le dossier' };
    if (bandeau.km > 0) Object.keys(maxi).forEach(function (c) { ajoute(d, 'k' + c, maxi[c], bandeau.km * 2); });
    if (bandeau.volume > 0) ajoute(d, 'loc', 1, bandeau.volume);
    if (bandeau.volume > 0) ajoute(d, 'emb', 1, bandeau.volume);   // fourniture d'emballage : au m³, comme la location de matériel
    if (bandeau.valeur > 0) ajoute(d, 'gar', 1, bandeau.valeur);
    // Panneaux : un par adresse du dossier dont la case « Panneaux » est cochée, au tarif local ou national selon l'adresse.
    var pan = bandeau.panneaux || {}, notePan = pan.illisible ? 'une adresse n\'a pas pu être lue, à vérifier' : '';
    if (pan.local) ajoute(d, 'p87', pan.local, 1, notePan);
    if (pan.national) ajoute(d, 'phors', pan.national, 1, notePan);
    groupes.push(d);
    return { groupes: groupes, lignes: lignes };
  }

  // ---------- Panneau ----------
  var STYLE = ':host{all:initial}*{box-sizing:border-box}' +
    '.fond{position:fixed;inset:0;background:rgba(15,23,30,.18);z-index:2147483000;display:flex;justify-content:flex-end;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#17212b}' +
    '.tiroir{width:min(100vw,clamp(420px,37vw,760px));container-type:inline-size;height:100%;background:#f3f5f7;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:14px;border-left:5px solid var(--soc,#0f6b7a)}' +
    '#corps{display:flex;flex-direction:column;gap:14px}h1{font-size:20px;margin:0}h2{font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:#5a6876;margin:0 0 8px}' +
    '.tete{display:flex;justify-content:space-between;gap:12px;align-items:center;position:sticky;top:-18px;z-index:2;background:var(--soc,#0f6b7a);margin:-18px -18px 0;padding:12px 18px 10px}.sous{color:#fff;font-size:13px;margin:0}.sous:empty{display:none}.prix{font:400 22px ui-monospace,Consolas,monospace;color:#fff;white-space:nowrap;letter-spacing:-.01em}.prix b{font-weight:700}.croix{flex:none;width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:none;border:0;border-radius:6px;color:rgba(255,255,255,.85);cursor:pointer}.croix:hover,.croix:focus-visible{color:#fff;background:rgba(255,255,255,.18)}' +
    '.carte{background:#fff;border:1px solid #d9dfe5;border-radius:8px;padding:14px}' +
    '.choix{display:flex;flex-wrap:wrap;gap:6px}.choix button{font:inherit;min-height:42px;padding:6px 12px;border:1px solid #d9dfe5;background:#fff;color:#17212b;border-radius:6px;cursor:pointer;text-align:left}' +
    '.choix button[aria-pressed=true]{background:var(--soc,#0f6b7a);border-color:var(--soc,#0f6b7a);color:#fff}.choix b{display:block;font:600 14px ui-monospace,Consolas,monospace}.choix small{display:block;font-size:11.5px;opacity:.8}' +
    '.trois{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.trois button{text-align:center;min-height:52px}.chev{display:flex;width:100%;justify-content:center;align-items:center;background:none;border:0;padding:0;margin:2px 0 0;min-height:26px;color:#8a97a3;cursor:pointer;border-radius:6px}.chev:hover,.chev:focus-visible{color:#0f6b7a;background:rgba(15,107,122,.07)}.chev svg{transition:transform .15s}.chev.ouvert svg{transform:rotate(180deg)}@media (prefers-reduced-motion:reduce){.chev svg{transition:none}}' +
    '.titre{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;padding:4px 6px 4px 14px;background:#fff;border:1px solid #d9dfe5;border-radius:8px}.titre.ouvert{border-radius:8px 8px 0 0}.tt{flex:1;min-width:0;min-height:38px;padding:0;font:700 15px system-ui,sans-serif;color:#17212b;text-align:left;background:none;border:0;cursor:pointer}.tc{flex:none;width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:none;border:0;color:#8a97a3;cursor:pointer}.tc svg{transition:transform .15s}.titre.ouvert .tc svg{transform:rotate(180deg)}.sous-titre{border-top:0;border-radius:0 0 8px 8px}.seg.petit button{min-width:44px;min-height:34px;padding:2px 9px;font-size:13px}' +
    '.phases{display:flex;flex-direction:column;gap:4px}.phases button{display:flex;justify-content:space-between;gap:12px;align-items:center;width:100%;min-height:42px;padding:6px 12px;font:inherit;text-align:left;color:#17212b;background:#fff;border:1px solid #d9dfe5;border-left:5px solid #d9dfe5;border-radius:6px;cursor:pointer}.phases button[aria-pressed=true]{border-left-color:var(--soc,#0f6b7a);font-weight:700}.phases b{font:600 15px ui-monospace,Consolas,monospace;white-space:nowrap}.phases span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.b:disabled{opacity:.45;cursor:not-allowed}.avis+.avis{margin-top:6px}.st{flex:none;font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid #d9dfe5;color:#5a6876;font-weight:500}.st.fait{background:#e3f4ea;border-color:#e3f4ea;color:#0b6b3a}.st.modif{background:#fff4dc;border-color:#fff4dc;color:#9a5b00}.phases button>span:first-child{flex:1}.note.ok{color:#0b6b3a;font-size:13.5px;margin:10px 0 0}.reglages{padding:8px 14px 2px}.rgc{display:flex;flex-direction:column;gap:10px;padding:4px 0}.reglages.plie{background:none;border-color:transparent;padding:0;margin:-8px 0}.reglages.plie .chev{margin:0}.rg{display:flex;align-items:flex-start;gap:12px}.rg .etiq{width:128px;flex:none;margin:0;padding-top:12px}.rg>div{flex:1;min-width:0}.seg{gap:0;flex:none!important}.seg button{min-width:52px;min-height:42px;text-align:center;font-weight:700;border-radius:0;margin-left:-1px}.seg button:first-child{border-radius:6px 0 0 6px;margin-left:0}.seg button:last-child{border-radius:0 6px 6px 0}.seg button[aria-pressed=true]{position:relative}@container (max-width:700px){.rg{flex-direction:column;gap:2px}.rg .etiq{padding-top:0;width:auto}}' +
    '.etiq{font-size:12px;color:#5a6876;margin:0 0 4px}.zone{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}' +
    'th,td{padding:5px 6px;text-align:left;vertical-align:middle}thead th{font-size:12px;color:#5a6876;border-bottom:2px solid #17212b;white-space:nowrap}tbody td{border-bottom:1px solid #d9dfe5}' +
    '.num{text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:13.5px;white-space:nowrap}thead .num{font-family:inherit;font-size:12px}' +
    'input,select{font:14px system-ui,sans-serif;min-height:40px;color:#17212b;background:#f3f5f7;border:1px solid #d9dfe5;border-radius:5px;padding:6px 8px;width:100%}' +
    'input.n{font-family:ui-monospace,Consolas,monospace;text-align:right}.c-t{min-width:210px}.c-n{width:74px}.c-q input{width:84px}.q{display:flex;align-items:center;gap:6px}.q span{font-size:12px;color:#5a6876;white-space:nowrap}' +
    '.ap{margin-top:10px;padding:12px;border:1px solid #d9dfe5;border-radius:6px;background:#fafbfc}.ap .act{margin-top:0}.ap select{width:auto;min-width:240px}.std input{width:84px}.perso{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px 10px;margin:10px 0}.perso label{grid-column:span 3;font-size:12px;color:#5a6876}.perso label.court{grid-column:span 2}.perso label{display:block}.perso input,.perso select{display:block;width:100%;min-width:0;margin-top:3px}.lib{margin-top:4px}.tv{margin-top:4px;width:110px;float:right}' +
    'details{margin-top:12px;border-top:1px solid #d9dfe5;padding-top:4px}summary{cursor:pointer;font-weight:600;color:#0f6b7a;min-height:42px;display:flex;align-items:center;gap:8px}summary::before{content:"▸"}details[open] summary::before{content:"▾"}summary::-webkit-details-marker{display:none}#synthese td{padding:9px 6px;font-size:15px;white-space:nowrap}#synthese .num{font-size:14.5px}#synthese .nom{max-width:0;width:46%;overflow:hidden;text-overflow:ellipsis}.pv{color:#9a5b00;font:12px system-ui,sans-serif}' +
    'tr.et td{background:#e9eef2;border-bottom:0;padding:9px 8px;border-top:10px solid #fff}tr.et:first-child td{border-top:0}tr.et b{font-size:15px}.de{color:#5a6876;font-size:12.5px;margin-left:10px}.ti{width:260px;font-weight:700}tr.pe td{border-bottom:0;padding:0 6px 4px}' +
    '.change{border-color:#9a5b00;background:#fff4dc}.prevu{display:block;font-size:11.5px;color:#9a5b00}' +
    '.p{display:inline-block;text-transform:none;letter-spacing:0;font-weight:500;font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid #d9dfe5;color:#5a6876;white-space:nowrap}.p.m{background:#fff4dc;color:#9a5b00;border-color:#fff4dc}' +
    '.lien{font:inherit;font-size:13px;background:none;border:0;padding:8px 0;color:#0f6b7a;text-decoration:underline;cursor:pointer}' +
    '.b{font:inherit;min-height:42px;padding:8px 14px;border-radius:6px;border:1px solid #d9dfe5;background:#fff;color:#17212b;cursor:pointer}.b.pr{background:#0f6b7a;border-color:#0f6b7a;color:#fff;font-weight:600}' +
    '.tp{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.tp h2{margin:0}.rp{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;margin:0 0 8px;font-size:13.5px;color:#5a6876}.rp input{width:84px}.rp #rm-motif{width:min(340px,100%);text-align:left}.seg button[aria-pressed=true]{background:var(--soc,#0f6b7a);border-color:var(--soc,#0f6b7a);color:#fff}td.moins{font-weight:600}.act{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}.cases input{width:130px;float:right}.cases{table-layout:fixed}.cases thead th{white-space:normal}.cases th:nth-child(2),.cases td.mt{width:150px}.cases th:nth-child(3){width:34%}.cases td:first-child{overflow-wrap:break-word}@container (max-width:700px){.cases th:nth-child(2),.cases td.mt{width:108px}.cases input{width:98px}.cases th:nth-child(3){width:26%}.cases td,.cases th{padding-left:3px;padding-right:3px}.cases td.num.mt{padding-right:11px}}.cases td.num.mt{padding-right:15px}.cases td.aj{white-space:normal}.plus,.moins{font:600 14px ui-monospace,Consolas,monospace}.plus{color:#0b6b3a}.moins{color:#b3261e}.cal{display:block;font:12px system-ui,sans-serif;color:#5a6876}.cal .lien{padding:0;font-size:12px}' +
    'tfoot td{text-align:right;font-family:ui-monospace,Consolas,monospace}tfoot td:first-child{text-align:left;font-family:inherit}tfoot .ht td{font-weight:700;border-top:2px solid #17212b;padding-top:9px}tfoot .ttc td{font-weight:700;font-size:17px;color:#0f6b7a}' +
    '.avis{background:#fff4dc;color:#9a5b00;border-radius:6px;padding:8px 12px;font-size:13px;margin:0}.note{font-size:12.5px;color:#5a6876;margin:8px 0 0}[hidden]{display:none!important}';
  var COULEURS = { fra: '#14284b', ldl: '#c1272d', bd: '#e07b12', chalard: '#0f6b7a', jacquet: '#0f6b7a' };

  function grille() { return GRILLES_REFERENCE[etat.grille]; }
  function ligne(id) { return etat.lignes.filter(function (l) { return l.id === id; })[0]; }
  function enHeures(t) { return t.unite === 'j' && etat.unite === 'h'; }
  function hm(j) { var m = Math.round(j * HEURES_PAR_JOUR * 60); return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2); }
  function qteTexte(t, q) { return enHeures(t) ? hm(q) : fr(q); }
  // En heures : « 8:30 » ou « 8,5 » ; en journées : « 1,0625 ».
  function lireQte(t, texte) {
    if (!enHeures(t)) return nombre(texte);
    var p = String(texte).split(/[:hH]/), h = p.length > 1 ? nombre(p[0]) + nombre(p[1]) / 60 : nombre(texte);
    return arrondi(h / HEURES_PAR_JOUR);
  }
  function heuresTexte(j) {
    if (!(j > 0)) return 'j';
    var h = j * HEURES_PAR_JOUR, jours = Math.floor(j + 1e-9), reste = Math.round((j - jours) * HEURES_PAR_JOUR * 100) / 100;
    return 'j = ' + (jours ? jours + ' j' + (reste ? ' et ' + fr(reste) + ' h' : '') : fr(h) + ' h');
  }

  function ouvrir() {
    if (!tarifsPrets(true)) { demanderCode(ouvrir); return; }
    var bandeau = lireBandeau(), liens = lirePhases();
    if (!liens.length) liens = [{ id: '', href: '', titre: 'Phase' }];
    fermer();
    hote = document.createElement('div'); hote.id = 'gc-panneau';
    racine = hote.attachShadow({ mode: 'open' });
    racine.innerHTML = '<style>' + STYLE + '</style><div class="fond"><div class="tiroir" id="tiroir" role="dialog" aria-label="Chiffrage par grille"><div class="tete"><div><div class="prix" id="prix" aria-live="polite"></div><p class="sous" id="sous">Lecture de la pré-planification…</p></div><button class="croix" id="fermer" title="Fermer" aria-label="Fermer"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div><div id="corps"></div></div></div>';
    document.body.appendChild(hote);
    $('fermer').addEventListener('click', fermer);
    racine.querySelector('.fond').addEventListener('click', function (e) { if (e.target === e.currentTarget) fermer(); });   // un appui à côté du panneau le referme
    var seule = liens.length === 1;
    Promise.all(liens.map(function (ph) { return lireEvenementsPhase(ph, seule); })).then(function (parPhase) {
      var premier = parPhase.reduce(function (a, evs) { return a || evs[0]; }, null);
      if (!premier) { $('sous').textContent = 'Aucun moyen trouvé dans la pré-planification de ce dossier.'; return; }
      var societe = (SOCIETES.filter(function (x) { return x[0].test(premier.societe); })[0] || [0, 'fra'])[1];
      return Promise.all([Promise.all(parPhase.map(function (evs) { return Promise.all(evs.map(lireVehicules)); })), memoire('grille-' + societe), memoire('dossier-' + premier.numero), lirePanneauxDossier(premier.url)]).then(function (r) {
        bandeau.panneaux = r[3];
        etat = { societe: societe, numero: premier.numero, grille: GRILLES_REFERENCE[r[1]] ? r[1] : societe, saison: 1, suivant: 1000, phase: 0, unite: 'h' };   // durées affichées en heures et minutes par défaut
        etat.phases = liens.map(function (ph, i) {
          var depart = construireLignes(parPhase[i], r[0][i], bandeau, i === 0), c = JSON.parse(JSON.stringify(depart));
          return { id: ph.id, titre: ph.titre, illisible: !!ph.illisible, depart: depart, lignes: c.lignes, groupes: c.groupes, forces: {}, remise: { mode: 'R0', rn: 10, x: 0, xType: 'pct', motif: '' } };
        });
        var garde = r[2];
        if (garde && garde.phases) {
          if (GRILLES_REFERENCE[garde.grille]) etat.grille = garde.grille;
          if (garde.saison >= 0 && garde.saison < 4) etat.saison = garde.saison;
          if (garde.unite === 'h' || garde.unite === 'j') etat.unite = garde.unite;
          etat.phases.forEach(function (ph, i) {
            var g0 = garde.phases[clePhase(ph, i)];
            if (!g0) return;
            ph.reporte = g0.reporte || null;
            // Si la pré-planification a changé depuis, les ajustements gardés ne valent plus : on repart de la lecture.
            if (g0.empreinte !== empreinte(ph.depart)) { ph.perime = true; return; }
            ph.lignes = g0.lignes; ph.groupes = g0.groupes; ph.forces = g0.forces || {}; if (g0.remise) ph.remise = g0.remise;
            ph.lignes.forEach(function (l) { if (l.id >= etat.suivant) etat.suivant = l.id + 1; });
            ph.groupes.forEach(function (x) { if (x.id >= etat.suivant) etat.suivant = x.id + 1; });
          });
        }
        // On ouvre sur la phase affichée dans Ulyss : c'est la seule que l'on peut reporter depuis cette page.
        var ouverte = phaseOuverte();
        etat.phases.forEach(function (ph, i) { if (ouverte && ph.id === ouverte) etat.phase = i; });
        // Le reste du panneau travaille sur « la phase affichée » : ces propriétés y renvoient.
        ['lignes', 'groupes', 'forces', 'depart', 'remise'].forEach(function (k) {
          Object.defineProperty(etat, k, { get: function () { return etat.phases[etat.phase][k]; }, set: function (v) { etat.phases[etat.phase][k] = v; } });
        });
        dessiner();
      });
    });
  }
  function phaseOuverte() {
    var l = document.querySelector('a#new_proposal-link');
    return l ? ((l.getAttribute('href') || '').match(/phase_id=(\d+)/) || [])[1] || '' : '';
  }
  function repartir() { var c = JSON.parse(JSON.stringify(etat.depart)); etat.lignes = c.lignes; etat.groupes = c.groupes; etat.forces = {}; }
  function fermer() { if (hote) { hote.remove(); hote = null; } }

  function dessiner() {
    var h = '<div class="phases" id="phases" hidden></div><section class="carte reglages plie" id="rg"><div class="rgc" id="rg-corps" hidden><div class="rg"><p class="etiq">Saison</p><div class="choix seg" id="saisons"></div></div>' +
      '<div class="rg"><p class="etiq">Grille de référence</p><div id="grilles"></div></div></div><button class="chev" id="rg-chev">' + CHEVRON + '</button></section>' +
      '<section><div class="titre" id="mo-barre"><button class="tt" id="mo-titre" aria-expanded="false">Moyens de la phase</button><span class="p m" id="compte" hidden></span>' +
      '<div class="choix seg petit" id="unites"><button data-u="h" title="Afficher les durées en heures et minutes" aria-label="Durées en heures et minutes">HH:MM</button><button data-u="j" title="Afficher les durées en journées" aria-label="Durées en journées">J</button></div>' +
      '<button class="tc" id="mo-chev" aria-label="Déplier ou replier les moyens de la phase">' + CHEVRON + '</button></div><div class="carte sous-titre" id="mo-corps" hidden><div class="zone"><table><thead><tr><th>Moyen</th><th class="num">Quantité</th><th class="num">Prix unit. HT, €</th><th class="num">Montant HT, €</th></tr></thead><tbody id="synthese"></tbody></table></div>' +
      '<div class="act"><button class="b" id="ap-ouvrir">Ajouter un moyen à la phase</button><span class="note" id="ap-etat" style="margin:0" role="status"></span></div>' +
      '<div class="ap" id="ap" hidden><div class="act"><select id="ap-t" aria-label="Moyen à ajouter"></select>' +
      '<span class="std"><span id="ap-nx"><input inputmode="decimal" class="n" id="ap-n" aria-label="Nombre" value="1"> × </span><input inputmode="decimal" class="n" id="ap-q" aria-label="Quantité"> <span class="note" id="ap-u"></span></span></div>' +
      '<div class="perso" id="ap-perso"><label>Intitulé<input id="ap-l" maxlength="120"></label><label>Description, facultative<input id="ap-d" maxlength="250"></label>' +
      '<label class="court">Prix unitaire HT<input inputmode="decimal" class="n" id="ap-p"></label><label class="court">Quantité<input inputmode="decimal" class="n" id="ap-pq" value="1"></label>' +
      '<label class="court">TVA<select id="ap-v">' + TVA_ULYSS.map(function (v) { return '<option value="' + v[0] + '">' + v[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="act"><button class="b pr" id="ap-ok">Ajouter</button><button class="lien" id="ap-non">annuler</button></div></div>' +
      '<details id="detail"><summary>Détail par étape, pour ajuster les moyens</summary><div class="zone"><table><thead><tr><th>Moyen</th><th class="num">Nombre</th><th>Quantité</th><th class="num">Prix unitaire HT</th><th class="num">Montant HT</th><th></th><th></th></tr></thead><tbody id="lignes"></tbody></table></div>' +
      '<div class="act"><button class="b" id="ajouter">Ajouter une étape</button><button class="b" id="retablir">Revenir à la pré-planification</button></div>' +
      '<p class="note">Le temps se compte en journées de 8 heures. Montant = nombre × quantité × prix unitaire.</p></details></div></section>' +
      '<section class="carte"><div class="tp"><h2>Détails des postes</h2><div class="choix seg" id="remises"></div></div>' +
      '<div class="rp" id="rm-rx" hidden><span>Remise de</span><input inputmode="decimal" class="n" id="rm-x" aria-label="Remise"><div class="choix seg" id="rm-type"><button data-t="pct">%</button><button data-t="val">€</button></div></div>' +
      '<div class="rp" id="rm-mo" hidden><label for="rm-motif">Raison ou origine</label><input id="rm-motif" maxlength="80" placeholder="ancien client, partenaire, haute saison…"></div>' +
      '<div class="rp" id="rm-rn" hidden><span>Remise affichée de</span><input inputmode="decimal" class="n" id="rm-n" aria-label="Pourcentage de la remise neutralisée"><span>%, compensée par une hausse des postes</span></div>' +
      '<table class="cases"><thead><tr><th>Poste</th><th class="num">Montant HT, €</th><th class="num" title="Écart par rapport au tarif de la saison normale">Ajustement / normal, €</th></tr></thead><tbody id="cases"></tbody><tbody id="items"></tbody><tbody><tr id="rm-ligne" hidden><td id="rm-l"></td><td class="num mt moins" id="rm-m"></td><td></td></tr></tbody><tfoot id="pied"></tfoot></table>' +
      '<p class="avis" id="avis-perime" hidden>La pré-planification de cette phase a changé depuis votre dernier passage : les ajustements gardés n\'ont pas été repris.</p><p class="note ok" id="rp-etat" hidden></p><p class="avis" id="avis-phase" hidden>Cette phase n\'est pas celle qui est ouverte dans Ulyss. Ouvrez-la dans la pré-planification pour reporter son estimation.</p><p class="avis" id="avis-libre" hidden>Les items ajoutés ne peuvent pas entrer dans l\'estimation : Ulyss ne les accepte qu\'une fois le devis créé. Ils seront à ajouter dans l\'onglet Devis.</p>' +
      '<div class="act"><button class="b pr" id="reporter">Reporter dans l\'estimation Ulyss</button><span class="note" style="margin:0">Ouvre l\'estimation d\'Ulyss avec ces montants. Rien n\'est enregistré tant que vous n\'avez pas cliqué sur Valider dans Ulyss.</span></div></section>';
    $('corps').innerHTML = h;
    dessinerChoix(); dessinerLignes(); dessinerCases(); calculer();
    $('rg-chev').addEventListener('click', function () { etat.voirReglages = !etat.voirReglages; dessinerChoix(); });
    // « Moyens de la phase » : seul le titre est visible à l'ouverture, il fait office de bouton.
    var basculeMoyens = function () {
      etat.voirMoyens = !etat.voirMoyens;
      $('mo-corps').hidden = !etat.voirMoyens; $('mo-titre').setAttribute('aria-expanded', String(!!etat.voirMoyens)); $('mo-barre').classList.toggle('ouvert', !!etat.voirMoyens);
    };
    $('mo-titre').addEventListener('click', basculeMoyens); $('mo-chev').addEventListener('click', basculeMoyens);
    // Durées en heures et minutes (par défaut) ou en journées : seul l'affichage change, le calcul reste en journées de 8 heures.
    $('unites').addEventListener('click', function (e) {
      var u = e.target.getAttribute('data-u');
      if (!u) return;
      etat.unite = u; dessinerLignes(); calculer();
    });
    $('phases').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-phase]');
      if (!b) return;
      etat.phase = Number(b.getAttribute('data-phase')); $('ap').hidden = true; $('ap-etat').textContent = '';
      dessinerLignes(); dessinerCases(); calculer();
    });
    $('lignes').addEventListener('input', function (e) {
      var tr = e.target.closest('tr'), champ = e.target.getAttribute('data-c'), g = e.target.getAttribute('data-titre');
      if (g) { groupe(Number(g)).titre = e.target.value; return; }
      if (!tr || !champ) return;
      var l = ligne(Number(tr.getAttribute('data-id')));
      l[champ] = (champ === 'type' || champ === 'libelle' || champ === 'description') ? e.target.value : (champ === 'tva' ? Number(e.target.value) : (champ === 'quantite' ? lireQte(typeDe(l.type), e.target.value) : nombre(e.target.value)));
      if (champ === 'type') dessinerLignes();   // l'intitulé et la TVA n'existent que sur un item personnalisé
      calculer();
    });
    $('lignes').addEventListener('click', function (e) {
      var id = e.target.getAttribute('data-retirer'), g = e.target.getAttribute('data-ajout');
      if (id) { etat.lignes = etat.lignes.filter(function (l) { return l.id !== Number(id); }); dessinerLignes(); calculer(); }
      if (g) { var l = nouvelleLigne(Number(g)); dessinerLignes(); calculer(); $('n' + l.id).focus(); }
    });
    $('ajouter').addEventListener('click', function () {
      var g = { id: etat.suivant++, origine: 'ajout', titre: 'Nouvelle étape', detail: '' };
      etat.groupes.splice(etat.groupes.length - 1, 0, g);
      nouvelleLigne(g.id); dessinerLignes(); calculer();
      var t = $('g' + g.id); t.focus(); t.select();
    });
    $('retablir').addEventListener('click', function () { repartir(); dessinerLignes(); dessinerCases(); calculer(); });
    // Ajout rapide depuis la synthèse : un moyen de la grille, ou un item personnalisé comme dans Ulyss
    // (intitulé, description, prix unitaire HT, quantité, TVA). La ligne va dans une étape « Complément ».
    $('ap-t').innerHTML = '<option value="libre">Item personnalisé…</option>' + AJOUT_RAPIDE.map(function (id) { return '<option value="' + id + '">' + typeDe(id).label + '</option>'; }).join('');
    var forme = function () {
      var t = typeDe($('ap-t').value), perso = t.id === 'libre';
      $('ap-perso').hidden = !perso; racine.querySelector('.std').hidden = perso;
      $('ap-nx').hidden = t.unite === 'm³';   // un volume se saisit seul, sans « nombre × »
      $('ap-q').setAttribute('aria-label', t.unite === 'm³' ? 'Volume en m³' : 'Quantité');
      $('ap-u').textContent = t.unite === 'j' ? heuresTexte(nombre($('ap-q').value)) : (t.unite === 'u' ? '' : t.unite);
    };
    $('ap-ouvrir').addEventListener('click', function () { $('ap').hidden = false; $('ap-etat').textContent = ''; ['ap-q', 'ap-l', 'ap-d', 'ap-p'].forEach(function (i) { $(i).value = ''; }); forme(); $('ap-t').focus(); });
    $('ap-non').addEventListener('click', function () { $('ap').hidden = true; });
    $('ap-t').addEventListener('change', forme); $('ap-q').addEventListener('input', forme);
    $('ap-ok').addEventListener('click', function () {
      var perso = $('ap-t').value === 'libre', volume = typeDe($('ap-t').value).unite === 'm³', manque = [];
      var exige = function (id, ok) { $(id).classList.toggle('change', !ok); if (!ok) manque.push(id); };
      if (perso) { exige('ap-l', $('ap-l').value.trim() !== ''); exige('ap-p', nombre($('ap-p').value) > 0); exige('ap-pq', nombre($('ap-pq').value) > 0); }
      else { if (volume) $('ap-n').value = '1'; exige('ap-n', nombre($('ap-n').value) > 0); exige('ap-q', nombre($('ap-q').value) > 0); }
      if (manque.length) { $('ap-etat').textContent = perso ? 'Indiquez un intitulé, un prix et une quantité.' : (volume ? 'Indiquez le nombre de m³.' : 'Indiquez un nombre et une quantité.'); return; }
      var g = etat.groupes.filter(function (x) { return x.origine === 'ajout' && x.titre === 'Complément'; })[0];
      if (!g) { g = { id: etat.suivant++, origine: 'ajout', titre: 'Complément', detail: 'moyens ajoutés à la phase' }; etat.groupes.splice(etat.groupes.length - 1, 0, g); }
      var l = nouvelleLigne(g.id); l.type = $('ap-t').value;
      if (perso) { l.libelle = $('ap-l').value.trim(); l.description = $('ap-d').value.trim(); l.puLibre = nombre($('ap-p').value); l.nombre = 1; l.quantite = nombre($('ap-pq').value); l.tva = Number($('ap-v').value); }
      else { l.nombre = nombre($('ap-n').value); l.quantite = nombre($('ap-q').value); }
      dessinerLignes(); calculer();
      $('ap').hidden = true; $('ap-etat').textContent = 'Ajouté : ' + (perso ? l.libelle : typeDe(l.type).label) + '. La ligne se retrouve dans le détail, à l\'étape « Complément ».';
    });
    $('cases').addEventListener('input', function (e) {
      var c = e.target.getAttribute('data-force');
      if (!c) return;
      var r0 = chiffrer(grille(), etat.saison, etat.lignes, {}, etat.remise), calcule = r0.cases[c].calcule, v = nombre(e.target.value) / r0.facteur;
      // Champ vidé ou remis au montant calculé : plus d'ajustement.
      if (String(e.target.value).trim() === '' || Math.abs(v - calcule) < 0.005) delete etat.forces[c]; else etat.forces[c] = v;
      calculer();
    });
    $('cases').addEventListener('focusout', function () { setTimeout(calculer, 0); });
    $('cases').addEventListener('click', function (e) {
      var c = e.target.getAttribute('data-retour');
      if (!c) return;
      delete etat.forces[c]; calculer();
    });
    $('remises').innerHTML = [['R0', 'Pas de remise'], ['R10', 'Remise de 10 %'], ['RX', 'Remise au choix, en pourcentage ou en euros'], ['RN', 'Remise affichée mais neutralisée par une hausse des postes']].map(function (r) { return '<button data-r="' + r[0] + '" title="' + r[1] + '" aria-label="' + r[1] + '">' + r[0] + '</button>'; }).join('');
    $('remises').addEventListener('click', function (e) { var r = e.target.getAttribute('data-r'); if (!r) return; etat.remise.mode = r; calculer(); if (r === 'RX') $('rm-x').focus(); });
    $('rm-type').addEventListener('click', function (e) { var t = e.target.getAttribute('data-t'); if (!t) return; etat.remise.xType = t; calculer(); });
    $('rm-x').addEventListener('input', function (e) { etat.remise.x = nombre(e.target.value); calculer(); });
    $('rm-n').addEventListener('input', function (e) { etat.remise.rn = nombre(e.target.value); calculer(); });
    $('rm-motif').addEventListener('input', function (e) { etat.remise.motif = e.target.value; calculer(); });
    $('reporter').addEventListener('click', reporter);
    calculer();   // une fois le sélecteur de remise en place
  }
  // Grilles : les trois sociétés alignées, les commerciaux repliés. Saisons : seule la saison retenue est affichée,
  // les autres se déplient pour en choisir une.
  function dessinerChoix() {
    var zg = $('grilles'), zs = $('saisons'); zg.innerHTML = ''; zs.innerHTML = '';
    // Bloc des réglages : replié par défaut, il ne laisse voir que le chevron, sans cadre.
    var ouvertR = !!etat.voirReglages, texteR = ouvertR ? 'Replier la saison et la grille' : 'Changer la saison ou la grille';
    $('rg-corps').hidden = !ouvertR; $('rg').classList.toggle('plie', !ouvertR);
    $('rg-chev').className = 'chev' + (ouvertR ? ' ouvert' : ''); $('rg-chev').title = texteR; $('rg-chev').setAttribute('aria-label', texteR); $('rg-chev').setAttribute('aria-expanded', String(ouvertR));
    var cles = Object.keys(GRILLES_REFERENCE), estSociete = function (k) { return GRILLES_REFERENCE[k].type === 'Société'; };
    var boutonGrille = function (k) {
      var b = document.createElement('button');
      b.innerHTML = echappe(GRILLES_REFERENCE[k].label) + (k === etat.societe ? '<small>société du dossier</small>' : '');
      b.setAttribute('aria-pressed', String(k === etat.grille));
      b.addEventListener('click', function () { etat.grille = k; memoire('grille-' + etat.societe, k); dessinerChoix(); calculer(); });
      return b;
    };
    var bascule = function (texte, ouvert, action) {
      var b = document.createElement('button');
      // Petit chevron : vers le bas pour déplier, vers le haut pour replier.
      b.className = 'chev' + (ouvert ? ' ouvert' : ''); b.title = texte; b.setAttribute('aria-label', texte); b.setAttribute('aria-expanded', String(ouvert));
      b.innerHTML = CHEVRON;
      b.addEventListener('click', action);
      return b;
    };
    var rang = document.createElement('div'); rang.className = 'choix trois';
    cles.filter(estSociete).forEach(function (k) { rang.appendChild(boutonGrille(k)); });
    zg.appendChild(rang);
    var ligne2 = document.createElement('div'); ligne2.className = 'choix trois'; ligne2.style.marginTop = '6px';
    var commerciaux = cles.filter(function (k) { return !estSociete(k); }), actif = !estSociete(etat.grille), ouvert = etat.voirCommerciaux || actif;
    if (commerciaux.length) {
      if (ouvert) {
        commerciaux.forEach(function (k) { ligne2.appendChild(boutonGrille(k)); });
        zg.appendChild(ligne2);
      }
      zg.appendChild(bascule(ouvert ? 'Replier les grilles des commerciaux' : 'Afficher les grilles des commerciaux', ouvert, function () { if (actif) return; etat.voirCommerciaux = !ouvert; dessinerChoix(); calculer(); }));
    }
    // Saisons : quatre lettres, B N H TH. Le tarif correspondant se lit dans l'en-tête du panneau.
    SAISONS.forEach(function (nom, i) {
      var b = document.createElement('button');
      b.textContent = SIGLES[i]; b.title = nom; b.setAttribute('aria-label', nom);
      b.setAttribute('aria-pressed', String(i === etat.saison));
      b.addEventListener('click', function () { etat.saison = i; dessinerChoix(); calculer(); });
      zs.appendChild(b);
    });
  }
  function groupe(id) { return etat.groupes.filter(function (g) { return g.id === id; })[0]; }
  function nouvelleLigne(g) {
    var l = { id: etat.suivant++, g: g, origine: 'ajout', type: 'homme', nombre: 1, quantite: 0.5, puLibre: 0, libelle: '', description: '', tva: 0.2, note: '', ref: null };
    etat.lignes.push(l); return l;
  }
  function dessinerLignes() {
    // Une étape ajoutée puis vidée disparaît ; une étape de la pré-planification reste affichée, même vide.
    etat.groupes = etat.groupes.filter(function (g) { return g.origine === 'prep' || etat.lignes.some(function (l) { return l.g === g.id; }); });
    $('lignes').innerHTML = etat.groupes.map(function (g) {
      var titre = g.origine === 'ajout' ? '<input class="ti" id="g' + g.id + '" data-titre="' + g.id + '" aria-label="Nom de l\'étape" value="' + echappe(g.titre) + '">' : '<b>' + echappe(g.titre) + '</b>';
      var tete = '<tr class="et"><td colspan="4">' + titre + (g.detail ? '<span class="de">' + echappe(g.detail) + '</span>' : '') + '</td><td class="num"><b id="tg' + g.id + '"></b></td><td colspan="2"></td></tr>';
      var corps = etat.lignes.filter(function (l) { return l.g === g.id; }).map(function (l) {
        var options = TYPES.map(function (t) { return '<option value="' + t.id + '"' + (t.id === l.type ? ' selected' : '') + '>' + t.label + '</option>'; }).join('');
        return '<tr data-id="' + l.id + '"><td class="c-t"><select id="t' + l.id + '" data-c="type" aria-label="Moyen">' + options + '</select>' + (l.type === 'libre' ? '<input class="lib" data-c="libelle" aria-label="Intitulé" placeholder="Intitulé" value="' + echappe(l.libelle || '') + '"><input class="lib" data-c="description" aria-label="Description" placeholder="Description, facultative" value="' + echappe(l.description || '') + '">' : '') + '<span class="prevu" id="pt' + l.id + '"></span></td>' +
          '<td class="c-n"><input inputmode="decimal" class="n" id="n' + l.id + '" data-c="nombre" aria-label="Nombre" value="' + fr(l.nombre) + '"><span class="prevu" id="pn' + l.id + '"></span></td>' +
          '<td class="c-q"><div class="q"><input inputmode="decimal" class="n" id="q' + l.id + '" data-c="quantite" aria-label="Quantité" value="' + qteTexte(typeDe(l.type), l.quantite) + '"><span id="u' + l.id + '"></span></div><span class="prevu" id="pq' + l.id + '"></span></td>' +
          '<td class="num"><span id="pu' + l.id + '"></span><input inputmode="decimal" class="n" id="pl' + l.id + '" data-c="puLibre" aria-label="Prix unitaire HT de l\'item personnalisé" value="' + (l.puLibre ? fr(l.puLibre) : '') + '">' + (l.type === 'libre' ? '<select class="tv" data-c="tva" aria-label="TVA">' + TVA_ULYSS.map(function (v) { return '<option value="' + v[0] + '"' + (v[0] === (typeof l.tva === 'number' ? l.tva : 0.2) ? ' selected' : '') + '>TVA ' + v[1] + '</option>'; }).join('') + '</select>' : '') + '</td>' +
          '<td class="num"><span id="m' + l.id + '"></span></td><td><span class="p" id="o' + l.id + '"></span></td>' +
          '<td><button class="lien" data-retirer="' + l.id + '">retirer</button></td></tr>';
      }).join('');
      return tete + corps + '<tr class="pe"><td colspan="7"><button class="lien" data-ajout="' + g.id + '">+ ajouter un moyen à cette étape</button></td></tr>';
    }).join('');
  }
  // Détails des postes : le montant se modifie directement ; la colonne « Ajustement » dit de combien il s'écarte
  // du tarif de la saison normale, que l'écart vienne de la saison choisie ou d'une saisie à la main.
  function dessinerCases() {
    $('cases').innerHTML = CASES.map(function (c) {
      return '<tr><td>' + c[1] + '</td><td class="mt"><input inputmode="decimal" class="n" id="cf-' + c[0] + '" data-force="' + c[0] + '" aria-label="Montant HT, ' + echappe(c[1]) + '"></td>' +
        '<td class="num aj" id="ca-' + c[0] + '"></td></tr>';
    }).join('');
    $('pied').innerHTML = '<tr class="ht"><td>Total HT</td><td id="t-ht"></td><td class="aj" id="t-aj"></td></tr><tr><td>TVA</td><td id="t-tva"></td><td></td></tr><tr class="ttc"><td>Total TTC</td><td id="t-ttc"></td><td></td></tr>';
  }
  // Écart d'un poste par rapport au tarif de la saison normale ; « rétablir » n'apparaît que sur un montant saisi à la main.
  // Intitulé de la ligne de remise : « Remise commerciale 10 % », suivi de la raison ou de l'origine saisie.
  // État du report d'une phase : classe, libellé court pour la liste, phrase pour le bas du panneau.
  function etatReport(ph, res) {
    if (!ph.reporte) return ['afaire', 'à reporter', ''];
    var quand = new Date(ph.reporte.quand), date = quand.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    var change = Math.abs(ph.reporte.net - res.ht) > 0.005;
    return change ? ['modif', 'reportée, modifiée depuis', 'Phase reportée dans Ulyss le ' + date + ' pour ' + euros(ph.reporte.net) + ' HT. Le montant a changé depuis : ' + euros(res.ht) + ' HT.']
      : ['fait', 'reportée', 'Phase reportée dans Ulyss le ' + date + ' pour ' + euros(ph.reporte.net) + ' HT.'];
  }
  function libelleRemise(res) {
    var motif = (etat.remise.motif || '').trim();
    return 'Remise commerciale' + (etat.remise.mode === 'RX' && etat.remise.xType === 'val' ? '' : ' ' + fr(Math.round(res.remisePct * 1000) / 10) + ' %') + (motif ? ' ' + motif : '');
  }
  function ecartTexte(d, normal, cas) {
    if (Math.abs(d) < 0.005) return '';
    return '<span class="' + (d > 0 ? 'plus' : 'moins') + '">' + (d > 0 ? '▲ +' : '▼ −') + fr(Math.abs(d), 2) + '</span>' +
      (normal === undefined ? '' : '<span class="cal">normal ' + fr(normal, 2) + (cas ? ' <button class="lien" data-retour="' + cas + '">rétablir</button>' : '') + '</span>');
  }
  function calculer() {
    var g = grille(), s = etat.saison, modifs = 0;
    $('tiroir').style.setProperty('--soc', COULEURS[etat.grille]);
    etat.lignes.forEach(function (l) {
      var t = typeDe(l.type), libre = t.id === 'libre', pu = prixUnitaire(g, s, l), r = l.ref;
      var eh = enHeures(t), puv = eh ? pu / HEURES_PAR_JOUR : pu;
      $('u' + l.id).textContent = eh ? 'h = ' + fr(l.quantite) + ' j' : (t.unite === 'j' ? heuresTexte(l.quantite) : t.unite);
      $('pu' + l.id).hidden = libre; $('pl' + l.id).hidden = !libre;
      $('pu' + l.id).textContent = (t.id === 'gar' ? fr(pu * 100) + ' %' : fr(puv, puv < 1 ? 4 : 2) + ' €' + (eh ? '/h' : '')) + (t.coef && g.coef[s] !== 1 ? ' (× ' + fr(g.coef[s]) + ')' : '');
      $('m' + l.id).textContent = euros(montantLigne(g, s, l));
      var dt = r && r.type !== l.type, dn = r && r.nombre !== l.nombre, dq = r && r.quantite !== l.quantite;
      $('t' + l.id).classList.toggle('change', !!dt); $('n' + l.id).classList.toggle('change', !!dn); $('q' + l.id).classList.toggle('change', !!dq);
      $('pt' + l.id).textContent = dt ? 'prévu : ' + typeDe(r.type).label : (l.note || '');
      $('pn' + l.id).textContent = dn ? 'prévu : ' + fr(r.nombre) : '';
      $('pq' + l.id).textContent = dq ? 'prévu : ' + qteTexte(t, r.quantite) : '';
      var o = $('o' + l.id), change = dt || dn || dq;
      o.textContent = l.origine === 'ajout' ? 'ajoutée' : (change ? 'modifiée' : 'pré-planification');
      o.className = 'p' + (l.origine === 'ajout' || change ? ' m' : '');
      if (l.origine === 'ajout' || change) modifs++;
    });
    // Synthèse de la phase : un moyen par ligne, toutes étapes confondues, comparé à la pré-planification.
    var cumul = function (lignes) {
      var o = {}, ordre = [];
      lignes.forEach(function (l) {
        if (!o[l.type]) { o[l.type] = { q: 0, m: 0 }; ordre.push(l.type); }
        o[l.type].q += l.nombre * l.quantite; o[l.type].m += montantLigne(g, s, l);
      });
      return { o: o, ordre: ordre };
    };
    var actuel = cumul(etat.lignes), prevu = cumul(etat.depart.lignes);
    // Une ligne par moyen, sans retour à la ligne : unités abrégées, pas de « € » répété (il est dans l'en-tête).
    var court = function (t) { return enHeures(t) ? (t.id === 'homme' ? 'h-h' : 'h') : (t.id === 'homme' ? 'j-h' : (t.unite === 'u' ? '' : (t.unite === '€ déclarés' ? '€' : t.unite))); };
    var qt = function (t, q) { return enHeures(t) ? hm(q) : nb2(q); };
    [].slice.call($('unites').children).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-u') === (etat.unite))); });
    var nb2 = function (x) { return fr(Math.round(x * 100) / 100); };
    $('synthese').innerHTML = TYPES.filter(function (t) { return t.id !== 'libre' && (actuel.o[t.id] || prevu.o[t.id]); }).map(function (t) {
      var a = actuel.o[t.id] || { q: 0, m: 0 }, pr = prevu.o[t.id] || { q: 0, m: 0 }, ecart = Math.abs(a.q - pr.q) > 1e-6, u = court(t);
      var puT = enHeures(t) ? t.pu(g, s) / HEURES_PAR_JOUR : t.pu(g, s);
      var pu = t.id === 'gar' ? fr(t.pu(g, s) * 100) + ' %' : fr(puT, puT < 1 ? 4 : 2) + (t.coef && g.coef[s] !== 1 ? '<span class="pv"> ×' + fr(g.coef[s]) + '</span>' : '');
      return '<tr><td class="nom">' + t.label + '</td><td class="num">' + (ecart ? '<span class="pv">' + (pr.q ? 'prévu ' + qt(t, pr.q) : 'ajouté') + '</span> ' : '') + qt(t, a.q) + (u ? ' ' + u : '') +
        '</td><td class="num">' + pu + '</td><td class="num"><b>' + fr(a.m, 2) + '</b></td></tr>';
    }).join('') + etat.lignes.filter(function (l) { return l.type === 'libre'; }).map(function (l) {
      var taux = typeof l.tva === 'number' ? l.tva : 0.2;
      return '<tr><td class="nom" title="' + echappe(l.description || '') + '">' + echappe(l.libelle || 'Item personnalisé') + ' <span class="pv">perso' + (taux !== 0.2 ? ', TVA ' + fr(taux * 100) + ' %' : '') + '</span></td><td class="num">' + nb2(l.nombre * l.quantite) + '</td><td class="num">' + fr(l.puLibre || 0, 2) + '</td><td class="num"><b>' + fr(montantLigne(g, s, l), 2) + '</b></td></tr>';
    }).join('');
    etat.groupes.forEach(function (gr) {
      var t = 0; etat.lignes.forEach(function (l) { if (l.g === gr.id) t += montantLigne(g, s, l); });
      $('tg' + gr.id).textContent = euros(t);
    });
    var retirees = etat.depart.lignes.length - etat.lignes.filter(function (l) { return l.origine === 'prep'; }).length, forcees = Object.keys(etat.forces).length, m = [];
    if (modifs) m.push(modifs + ' ligne' + (modifs > 1 ? 's' : '') + ' ajustée' + (modifs > 1 ? 's' : ''));
    if (retirees) m.push(retirees + ' retirée' + (retirees > 1 ? 's' : ''));
    if (forcees) m.push(forcees + ' case' + (forcees > 1 ? 's' : '') + ' forcée' + (forcees > 1 ? 's' : ''));
    $('compte').textContent = m.join(', '); $('compte').hidden = !m.length;   // rien tant que la phase est conforme à la pré-planification
    var res = chiffrer(g, s, etat.lignes, etat.forces, etat.remise), resNormal = chiffrer(g, 1, etat.lignes, {}), ajustTotal = 0;
    CASES.forEach(function (c) {
      var k = res.cases[c[0]];
      var champ = $('cf-' + c[0]);
      if (racine.activeElement !== champ) champ.value = fr(k.affiche, 2);   // on ne réécrit pas un champ en cours de saisie
      champ.classList.toggle('change', k.force);
      var normal = resNormal.cases[c[0]].calcule;
      $('ca-' + c[0]).innerHTML = ecartTexte(k.affiche - normal, normal, k.force ? c[0] : '') || (k.force ? '<span class="cal"><button class="lien" data-retour="' + c[0] + '">rétablir</button></span>' : '');
      ajustTotal += k.affiche - normal;
    });
    // Une ligne par item, sous les sept postes : items personnalisés et items préconfigurés (manutention garde-meubles).
    $('items').innerHTML = etat.lignes.filter(function (l) { return typeDe(l.type).cas === 'libre'; }).map(function (l) {
      var t = typeDe(l.type), perso = t.id === 'libre', taux = typeof l.tva === 'number' ? l.tva : 0.2, q = l.nombre * l.quantite, pu = prixUnitaire(g, s, l);
      return '<tr><td>' + echappe(perso ? (l.libelle || 'Item personnalisé') : t.label) + (perso && l.description ? '<span class="de">' + echappe(l.description) + '</span>' : '') + '</td><td class="num mt">' + fr(montantLigne(g, s, l), 2) + '</td>' +
        '<td class="num aj"><span class="cal">' + (q !== 1 || !perso ? fr(arrondi(q)) + (perso ? '' : ' ' + t.unite) + ' × ' + fr(pu, 2) + ' · ' : '') + 'TVA ' + fr(taux * 100) + ' %</span></td></tr>';
    }).join('');
    $('t-aj').innerHTML = ecartTexte(ajustTotal - res.remise);   // l'ajustement total tient compte de la remise commerciale
    // Remise : R0 aucune, R10 dix pour cent, RX au choix, RN affichée mais neutralisée par la hausse des postes.
    var rm = etat.remise;
    [].slice.call($('remises').children).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-r') === rm.mode)); });
    [].slice.call($('rm-type').children).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-t') === rm.xType)); });
    $('rm-rx').hidden = rm.mode !== 'RX'; $('rm-rn').hidden = rm.mode !== 'RN'; $('rm-mo').hidden = rm.mode === 'R0';
    if (racine.activeElement !== $('rm-motif')) $('rm-motif').value = rm.motif || '';
    if (racine.activeElement !== $('rm-x')) $('rm-x').value = rm.x ? fr(rm.x) : '';
    if (racine.activeElement !== $('rm-n')) $('rm-n').value = fr(rm.rn);
    $('rm-ligne').hidden = !(res.remise > 0.004);
    $('rm-l').textContent = libelleRemise(res); $('rm-m').textContent = '−' + fr(res.remise, 2);
    $('avis-libre').hidden = !(res.libres > 0);
    // En tête du panneau : le tarif, visible avant tout choix.
    var totHT = 0, totTTC = 0, parPhase = etat.phases.map(function (ph) { var r = chiffrer(g, s, ph.lignes, ph.forces, ph.remise); totHT += r.ht; totTTC += r.ttc; return r; });
    $('prix').innerHTML = '<b>' + fr(totHT, 2) + '€HT</b> - ' + fr(totTTC, 2) + '€TTC'; $('sous').textContent = '';
    // Plusieurs phases : l'en-tête porte le total du dossier, et chaque phase a sa ligne. Un appui affiche ses moyens.
    $('phases').hidden = etat.phases.length < 2;
    $('phases').innerHTML = etat.phases.map(function (ph, i) {
      var st = etatReport(ph, parPhase[i]);
      return '<button data-phase="' + i + '" aria-pressed="' + (i === etat.phase) + '"><span>Phase ' + (i + 1) + ' · ' + echappe(ph.titre) + (ph.illisible ? ' <span class="pv">non lue</span>' : '') + '</span>' +
        '<span class="st ' + st[0] + '">' + st[1] + '</span><b>' + fr(parPhase[i].ht, 2) + '€HT</b></button>';
    }).join('');
    var stA = etatReport(etat.phases[etat.phase], res), reste = etat.phases.filter(function (ph) { return !ph.reporte; }).length;
    $('rp-etat').textContent = stA[2] + (etat.phases.length > 1 && reste && etat.phases[etat.phase].reporte ? ' Il reste ' + reste + ' phase' + (reste > 1 ? 's' : '') + ' à reporter.' : '');
    $('rp-etat').hidden = !$('rp-etat').textContent;
    $('avis-perime').hidden = !etat.phases[etat.phase].perime;
    var phaseUlyss = phaseOuverte();
    var autre = etat.phases.length > 1 && phaseUlyss && etat.phases[etat.phase].id !== phaseUlyss;
    $('reporter').disabled = !!autre; $('avis-phase').hidden = !autre;
    $('t-ht').textContent = euros(res.ht); $('t-tva').textContent = euros(res.tva); $('t-ttc').textContent = euros(res.ttc);
    sauver();
    return res;
  }

  // ---------- Report dans le formulaire « Estimation » d'Ulyss ----------
  function attendre(test, delai) {
    return new Promise(function (ok) {
      var debut = Date.now(), t = setInterval(function () {
        var r = test();
        if (r || Date.now() - debut > delai) { clearInterval(t); ok(r || null); }
      }, 150);
    });
  }
  function reporter() {
    var res = calculer(), g = grille(), saison = SAISONS[etat.saison], libres = res.libres, remiseTexte = libelleRemise(res), lien = document.querySelector('a#new_proposal-link'), phaseR = etat.phases[etat.phase], rang = etat.phase;
    if (!lien) { $('sous').textContent = 'Bouton « Estimation » introuvable dans cette page : report impossible.'; return; }
    // Ce que l'estimation d'Ulyss ne sait pas porter (elle n'a que sept cases) : la remise et les items ajoutés à la main.
    // Ils sont ajoutés au devis, en lignes libres, juste après « Valider » — la remise en montant négatif.
    var complements = [], dossierR = (location.pathname.match(CHEMIN) || [])[1], phaseIdR = phaseOuverte() || phaseR.id;
    etat.lignes.forEach(function (l) {
      var t = typeDe(l.type); if (t.cas !== 'libre') return;
      var pu = prixUnitaire(g, etat.saison, l), q = (l.nombre || 1) * (l.quantite || 0);
      if (Math.abs(pu * q) < 0.005) return;
      complements.push({ titre: (l.libelle || '').trim() || t.label, description: (l.description || '').trim(), pu: pu, quantite: q, tva: typeof l.tva === 'number' ? l.tva : 0.2 });
    });
    if (res.remise > 0.004) complements.push({ titre: remiseTexte, description: '', pu: -Math.round(res.remise * 100) / 100, quantite: 1, tva: 0.2 });
    var devisAvant = '';
    if (dossierR) lireDevis(dossierR).then(function (pid) { devisAvant = pid; });
    fermer();
    // Un formulaire d'estimation resté ouvert n'est pas celui que l'on attend.
    [].slice.call(document.querySelectorAll('#new_proposal_modal form')).forEach(function (f) { f.setAttribute('data-gc-ancien', '1'); });
    var averti = false;
    lien.click();
    attendre(function () {
      var m = document.querySelector('#new_proposal_modal'), f = m && m.querySelector('form[action*="/proposals"]:not([data-gc-ancien])');
      if (f) return f;
      // Dès qu'une phase a été validée, Ulyss demande « Une estimation a déjà été calculée, voulez-vous écraser celle-ci ? ».
      // Continuer n'enregistre rien : cela ouvre le formulaire. Vérifié le 22/11/2026 : à la validation, les phases déjà chiffrées sont conservées.
      var c = m && !averti && [].slice.call(m.querySelectorAll('a')).filter(function (a) { return /new_from_warning_modal/.test(a.getAttribute('href') || ''); })[0];
      if (c) { averti = true; c.click(); }
      return null;
    }, 15000).then(function (form) {
      if (!form) { bandeauPage(document.body, 'L\'estimation d\'Ulyss ne s\'est pas ouverte. Aucun montant n\'a été reporté.', true); return; }
      var avant = 0, apres = 0, manquants = [];
      [].slice.call(form.querySelectorAll('input[name*="[title]"]')).forEach(function (t) {
        var cas = TITRES_ULYSS[t.value.trim()];
        if (!cas) { manquants.push(t.value.trim()); return; }
        var nom = t.name.replace('[title]', '[unit_ht_in_float]'), v = res.cases[cas].affiche.toFixed(2), vu = false;
        [].slice.call(form.querySelectorAll('input')).forEach(function (i) {
          if (i.name !== nom) return;
          if (!vu) { avant += nombre(i.value); vu = true; }
          i.value = v;
          i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
        });
        apres += Number(v);
      });
      var texte = 'Montants de la grille ' + g.label + ' (' + saison.toLowerCase() + ') reportés : ' + euros(apres) + ' HT. Ulyss proposait ' + euros(avant) + ' HT. Vérifiez, puis cliquez sur Valider.';
      if (libres > 0) texte += ' Items hors des sept postes : ' + euros(libres) + ' HT, ajoutés au devis dès que vous aurez cliqué sur Valider.';
      if (res.remise > 0.004) texte += ' ' + remiseTexte + ' : −' + euros(res.remise) + ' HT, ajoutée au devis dès que vous aurez cliqué sur Valider.';
      if (manquants.length) texte += ' Cases d\'Ulyss non reconnues, laissées telles quelles : ' + manquants.join(', ') + '.';
      var suite = etat.phases.filter(function (ph, i) { return i !== rang && !ph.reporte; })[0];
      if (averti) texte += ' Ulyss signalait une estimation déjà calculée : les phases déjà validées sont conservées, seule celle-ci est remplacée.';
      if (suite) texte += ' Après « Valider », le passage à la phase « ' + suite.titre + ' » vous sera proposé.';
      bandeauPage(form, texte, false);
      form.addEventListener('submit', function () {
        phaseR.reporte = { quand: Date.now(), net: res.ht, postes: apres }; phaseR.perime = false; sauver();
        // « Valider » recharge la page d'Ulyss : ce qu'il reste à faire est noté dans l'onglet et repris à la page suivante.
        var reste = etat.phases.filter(function (ph) { return !ph.reporte; });
        ecrireAttente({ quand: Date.now(), dossier: dossierR, phase: phaseIdR, lignes: complements, avant: devisAvant, envoyees: 0, titre: phaseR.titre, nb: etat.phases.length, reste: reste.length, suite: reste[0] ? { id: reste[0].id, titre: reste[0].titre } : null });
        setTimeout(traiterAttente, 300);
      });
      // Ulyss recalcule ses totaux quand un montant change : on vérifie qu'il arrive au même total.
      setTimeout(function () {
        var total = form.querySelector('[name="proposal[total_ht]"]');
        if (total && Math.abs(nombre(total.value) - apres) > 0.01) bandeauPage(form, texte + ' Attention : Ulyss affiche un total de ' + euros(nombre(total.value)) + ' HT, différent du calcul.', true);
      }, 600);
    });
  }
  // Après « Valider » : on attend que la fenêtre d'estimation se referme, puis on propose la phase suivante.
  // ---------- Après « Valider » : remise et items ajoutés au devis, puis passage à la phase suivante ----------
  // Le formulaire d'estimation d'Ulyss se soumet en rechargeant la page (data-turbo="false") : tout ce qui suit la validation
  // est donc noté dans le stockage de l'onglet et repris par l'extension sur la page qui s'affiche ensuite.
  var CLE_ATTENTE = 'gc-apres-valider', CLE_MESSAGE = 'gc-message', CETTE_PAGE = String(Math.random());
  function lireAttente() { try { return JSON.parse(sessionStorage.getItem(CLE_ATTENTE) || 'null'); } catch (e) { return null; } }
  function ecrireAttente(o) { try { if (o) sessionStorage.setItem(CLE_ATTENTE, JSON.stringify(o)); else sessionStorage.removeItem(CLE_ATTENTE); } catch (e) {} }
  // Identifiant du devis en cours : lien « Valider le devis » de la fiche du dossier ; à défaut, liens du devis dans l'onglet Devis.
  function lireDevis(dossier) {
    var page = function (u) { return fetch(u, { credentials: 'same-origin', headers: { Accept: 'text/html' } }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); };
    return page('/contracts/' + dossier).then(function (t) {
      var pid = (t.match(/\/proposals\/(\d+)\/validate/) || [])[1];
      if (pid) return pid;
      return page('/contracts/' + dossier + '/proposals').then(function (t2) { return (t2.match(/\/proposals\/(\d+)\/(?:validate|edit)/) || [])[1] || ''; });
    });
  }
  // Ulyss crée un NOUVEAU devis à chaque estimation validée, et retire alors les lignes libres de la phase ré-estimée (celles des
  // autres phases sont conservées) : on attend donc le nouveau devis, puis on y remet la remise et les items de cette phase.
  function completerDevis(a) {
    var lignes = a.lignes || [];
    var echec = function (pourquoi) { return { erreur: true, texte: 'La remise et les items n\'ont pas été ajoutés au devis (' + pourquoi + ') : ajoutez-les dans l\'onglet Devis. ' + lignes.map(function (l) { return l.titre + ' ' + euros(l.pu * l.quantite); }).join(' ; ') + '.' }; };
    var TVA = function (t) { return Math.abs(t - 0.2) < 1e-6 ? '3' : Math.abs(t - 0.1) < 1e-6 ? '2' : Math.abs(t - 0.055) < 1e-6 ? '1' : '4'; };
    var jeton = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    return attendre(function () { return !document.querySelector('#new_proposal_modal form[action*="/proposals"]'); }, 12000).then(function (ferme) {
      if (!ferme) return { abandon: true };   // Ulyss a gardé l'estimation ouverte : rien n'a été validé
      if (!lignes.length) return null;
      if (!a.dossier || !a.phase) return echec('dossier ou phase introuvable');
      var essais = 0, chercher = function () {
        return lireDevis(a.dossier).then(function (pid) {
          if (pid && pid !== a.avant) return pid;
          if (++essais >= 15) return '';
          return new Promise(function (ok) { setTimeout(ok, 800); }).then(chercher);
        });
      };
      return chercher().then(function (pid) {
        if (!pid) return echec('le nouveau devis n\'a pas été trouvé');
        var suite = Promise.resolve();
        lignes.forEach(function (l, i) {
          if (i < (a.envoyees || 0)) return;   // déjà envoyée avant un rechargement de page
          suite = suite.then(function () {
            var b = new URLSearchParams();
            b.set('proposal_item[title]', l.titre); b.set('proposal_item[description]', l.description); b.set('proposal_item[unit_ht_in_float]', l.pu.toFixed(2)); b.set('proposal_item[quantity]', String(Math.round(l.quantite * 10000) / 10000)); b.set('proposal_item[vat_id]', TVA(l.tva));
            return fetch('/contracts/' + a.dossier + '/proposals/' + pid + '/proposal_items?phase_id=' + a.phase + '&scope=details', { method: 'POST', body: b, credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-CSRF-Token': jeton, Accept: 'text/vnd.turbo-stream.html, text/html' } });
          }).then(function () { a.envoyees = i + 1; ecrireAttente(a); });
        });
        // Relecture : la page d'édition du devis pour cette phase liste les lignes libres.
        return suite.then(function () { return fetch('/contracts/' + a.dossier + '/proposals/' + pid + '/edit?phase_id=' + a.phase, { credentials: 'same-origin', headers: { Accept: 'text/html' } }); }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
          var texte = (new DOMParser().parseFromString(t, 'text/html').body.textContent || '').replace(/\s+/g, ' ');
          var manquantes = lignes.filter(function (l) { return texte.indexOf(l.titre.replace(/\s+/g, ' ')) < 0; });
          if (manquantes.length) return echec('non retrouvés à la relecture : ' + manquantes.map(function (l) { return l.titre; }).join(', '));
          return { erreur: false, texte: 'Ajouté au devis et relu : ' + lignes.map(function (l) { return l.titre + ' ' + euros(l.pu * l.quantite) + ' HT'; }).join(' ; ') + '.' };
        });
      }).catch(function () { return echec('Ulyss n\'a pas répondu'); });
    });
  }
  function traiterAttente() {
    var a = lireAttente();
    if (!a) return;
    if (Date.now() - a.quand > 180000) { ecrireAttente(null); return; }
    if (a.page === CETTE_PAGE) return;   // déjà en cours dans cette page ; une autre valeur vient d'une page qui n'existe plus
    a.page = CETTE_PAGE; ecrireAttente(a);
    completerDevis(a).then(function (info) {
      ecrireAttente(null);
      if (info && info.abandon) return;
      var msg = { texte: 'Phase « ' + a.titre + ' » validée dans Ulyss. ' + (a.suite ? (a.reste > 1 ? 'Il reste ' + a.reste + ' phases à chiffrer.' : 'Il reste une phase à chiffrer.') : (a.nb > 1 ? 'Toutes les phases du dossier sont chiffrées.' : '')) + (info ? ' ' + info.texte : ''), erreur: !!(info && info.erreur), suite: a.suite, dossier: a.dossier };
      // Ulyss a déjà affiché le devis, sans les lignes que l'on vient d'ajouter : on le réaffiche à jour.
      if (info && !info.erreur && /^\/contracts\/\d+\/proposals\/?$/.test(location.pathname) && !window.__chiffrageApercu) {
        try { sessionStorage.setItem(CLE_MESSAGE, JSON.stringify(msg)); } catch (e) {}
        location.reload(); return;
      }
      afficherMessage(msg);
    });
  }
  function afficherMessage(msg) {
    var b = bandeauPage(document.body, msg.texte, msg.erreur);
    if (msg.suite && msg.dossier && msg.suite.id) {
      var a = document.createElement('a');
      a.href = '/contracts/' + msg.dossier + '/phases/' + msg.suite.id + '#chiffrage';
      a.textContent = 'Chiffrer la phase « ' + msg.suite.titre + ' »';
      a.setAttribute('data-turbo', 'false');
      a.style.cssText = 'display:block;margin-top:8px;padding:9px 12px;border-radius:6px;background:#0b4f5a;color:#fff;text-align:center;text-decoration:none;font-weight:600';
      b.appendChild(a);
    }
    var x = document.createElement('button');
    x.textContent = 'Fermer'; x.type = 'button';
    x.style.cssText = 'display:block;margin:8px auto 0;border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit';
    x.addEventListener('click', function () { b.remove(); });
    b.appendChild(x);
  }
  // À l'arrivée sur une page : reprendre ce qu'une validation a laissé en attente, ou afficher le compte rendu gardé pendant un rechargement.
  (function () {
    var m = null;
    try { m = JSON.parse(sessionStorage.getItem(CLE_MESSAGE) || 'null'); sessionStorage.removeItem(CLE_MESSAGE); } catch (e) {}
    var lancer = function () { if (m) afficherMessage(m); traiterAttente(); };
    if (document.body) lancer(); else document.addEventListener('DOMContentLoaded', lancer);
  })();
  // Arrivée par « Chiffrer la phase … » : le panneau s'ouvre de lui-même sur la phase de la page.
  if (location.hash === '#chiffrage') {
    attendre(function () { return document.getElementById('gc-bouton'); }, 10000).then(function (b) {
      if (!b) return;
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      ouvrir();
    });
  }
  function bandeauPage(parent, texte, erreur) {
    var b = document.getElementById('gc-bandeau') || document.createElement('div');
    b.id = 'gc-bandeau'; b.textContent = texte;
    b.style.cssText = 'margin:0 0 12px;padding:10px 14px;border-radius:6px;font:14px/1.4 system-ui,sans-serif;background:' + (erreur ? '#fde8e8;color:#8a1c1c' : '#e2f1f3;color:#0b4f5a') + (parent === document.body ? ';position:fixed;top:12px;right:12px;z-index:2147483000;max-width:420px' : '');
    parent.insertBefore(b, parent.firstChild);
    return b;
  }
})();
