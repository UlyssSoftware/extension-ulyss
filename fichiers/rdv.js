// Extension Ulyss — confirmation de rendez-vous (visite technique) par e-mail, depuis la fiche dossier.
// Le bouton lit le dossier, le client et le lieu dans Ulyss (lecture seule), laisse tout corriger, montre l'aperçu du mail,
// puis demande l'envoi au script hébergé sur ulyss-software.com (par le service worker, qui détient la clé).
// Rien n'est écrit dans Ulyss. Dossiers Fraisseix seulement (modèle de mail Fraisseix).
(function () {
  if (window.__extUlyssRdv) return;
  window.__extUlyssRdv = true;

  // Mise en service : staging d'abord (essais avec sa propre adresse), production quand Guillaume l'aura validé.
  // Ouvert en production le 25/11/2026 (Guillaume), après un envoi réel validé sur le staging.
  var EN_PRODUCTION = true;
  var HOTES = EN_PRODUCTION ? /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/ : /^fraisseix\.staging\.unova\.fr$/;
  // Agenda : le bouton « Valider » de la fenêtre « Nouveau rendez-vous » est remplacé par « Confirmer le RDV » (enregistre le
  // rendez-vous dans Ulyss, le relit, puis envoie le mail). Pour l'instant l'aperçu du mail est toujours montré ; à terme,
  // si tout va bien, Guillaume pourra le retirer (passer à false : envoi direct après enregistrement).
  var APERCU_AGENDA = true;
  var CHEMIN = /^\/contracts\/(\d+)\/?$/;
  var SOCIETES = ['F'];   // lettre après C ou D dans le numéro : F Fraisseix (B Bardon, L LDL quand leur modèle existera)
  var STAGING = location.hostname === 'fraisseix.staging.unova.fr';
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var CIVILITES = { male: 'Monsieur', female: 'Madame', both: 'Monsieur et Madame', other: '' };
  var EXT = (function () { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  var envoiEssai = window.__extUlyssRdvEssai;   // pages d'essai seulement

  function demander(msg) {
    if (envoiEssai) return envoiEssai(msg);
    return new Promise(function (ok) {
      try { EXT.sendMessage(msg, function (r) { void chrome.runtime.lastError; ok(r || { ok: false, motif: "l'extension ne répond pas (recharger la page)" }); }); }
      catch (e) { ok({ ok: false, motif: "l'extension a été mise à jour : recharger la page" }); }
    });
  }
  function texte(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function echapper(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sansAccents(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function page(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } }).then(function (r) {
      if (!r.ok) throw new Error(url + ' : ' + r.status);
      return r.text();
    }).then(function (t) { return new DOMParser().parseFromString(t, 'text/html'); });
  }
  function valeur(doc, nom) {
    var e = doc.querySelector('[name="' + nom + '"]');
    if (!e) return '';
    if (e.tagName === 'SELECT') return e.selectedOptions[0] ? e.selectedOptions[0].value : '';
    return texte(e.value);
  }
  // Blocs « titre / valeur » de la fiche dossier (« Commercial », « Date de RDV »…). « - » = vide.
  function bloc(doc, titre) {
    var t = Array.prototype.find.call(doc.querySelectorAll('.text-secondary-title'), function (x) { return texte(x.textContent) === titre; });
    if (!t || !t.parentElement) return '';
    var v = texte(t.parentElement.textContent.replace(t.textContent, ''));
    return v === '-' ? '' : v;
  }
  // Numéro lu d'abord dans l'en-tête du dossier : le corps peut citer avant lui un dossier lié (constaté en production le 25/11/2026).
  function reference(doc) {
    var zones = [doc.querySelector('#contract_header_banner #subtitle'), doc.querySelector('#contract_header_banner'), doc.querySelector('h2#subtitle'), doc.querySelector('main') || doc.body];
    for (var i = 0; i < zones.length; i++) { var m = zones[i] && texte(zones[i].textContent).match(/DGT[A-Z]{2}\d{4}-\d{3}(?:_\d+)?/); if (m) return m[0]; }
    return '';
  }
  // « Mardi 25 août 2026 à 09h00 » → { date: '2026-08-25', heure: '09:00' }
  function lireDateRdv(s) {
    var m = sansAccents(s).toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:\D+(\d{1,2})\s*h\s*(\d{2})?)?/);
    if (!m) return { date: '', heure: '' };
    var i = MOIS.map(function (x) { return sansAccents(x); }).indexOf(m[2]);
    if (i < 0) return { date: '', heure: '' };
    var deux = function (n) { return ('0' + n).slice(-2); };
    return { date: m[3] + '-' + deux(i + 1) + '-' + deux(m[1]), heure: m[4] ? deux(m[4]) + ':' + (m[5] || '00') : '' };
  }
  // « Prénom NOM » : le nom est la partie en majuscules. L'adresse ne sert qu'à retrouver la fiche du commercial côté script
  // (photo, fonction) ; elle n'apparaît pas dans le mail. Inconnue du script : il prend le prénom et le nom transmis.
  function lireCommercial(s) {
    var mots = texte(s).split(' ').filter(Boolean), nom = [], prenom = [];
    mots.forEach(function (w) { (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(sansAccents(w)) ? nom : prenom).push(w); });
    if (!nom.length && prenom.length > 1) nom.push(prenom.pop());
    var slug = function (a) { return sansAccents(a.join('-')).toLowerCase().replace(/[^a-z0-9-]/g, ''); };
    return { prenom: prenom.join(' '), nom: nom.join(' '), email: prenom.length && nom.length ? slug(prenom) + '.' + slug(nom) + '@fraisseix.fr' : '' };
  }
  function etage(s) {
    s = texte(s);
    if (s === '') return '';
    if (/^0$|^rdc$/i.test(s)) return 'Rez-de-chaussée';
    if (/^\d+$/.test(s)) return s === '1' ? '1er étage' : s + 'e étage';
    return 'Étage : ' + s;
  }

  // ---------- Bouton ----------
  var vu = null;
  function poserBouton() {
    if (!HOTES.test(location.hostname) && !envoiEssai) return;
    var m = location.pathname.match(CHEMIN);
    var existant = document.getElementById('gc-rdv-bouton');
    if (!m) { if (existant) existant.remove(); vu = null; return; }
    if (existant) return;
    if (vu === location.pathname) return;   // dossier déjà examiné (autre société, ou barre d'actions absente)
    var rdv = document.querySelector('a[href^="/agenda_items?contract_id="]');
    if (!rdv || !rdv.parentElement) return;
    var ref = reference(document);
    if (!ref) return;
    var lettre = (ref.match(/^DGT[CD]([A-Z])/) || [])[1];
    if (SOCIETES.indexOf(lettre) < 0) { vu = location.pathname; return; }   // sociétés dont le modèle de mail existe
    var b = document.createElement('a');
    b.id = 'gc-rdv-bouton';
    b.href = '#';
    b.className = rdv.className || 'btn btn-outline';
    b.title = 'Envoyer au client la confirmation de son rendez-vous de visite technique (Extension Ulyss)';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="margin-right:10px"><path d="M3 6.5h18v11H3z M3 7l9 6.5L21 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>Confirmer le RDV';
    b.addEventListener('click', function (e) { e.preventDefault(); ouvrir(m[1]); });
    rdv.insertAdjacentElement('afterend', b);
  }

  // ---------- Lecture du dossier ----------
  function lireDossier(id) {
    var d = { reference: reference(document), client: {}, lieux: [] };
    var r = lireDateRdv(bloc(document, 'Date de RDV'));
    d.rdv_date = r.date; d.rdv_heure = r.heure;
    d.commercial = lireCommercial(bloc(document, 'Commercial'));
    d.lieux = Array.prototype.filter.call(document.querySelectorAll('[id^="place_"]'), function (p) { return /^place_\d+$/.test(p.id); })
      .map(function (p) { var t = p.querySelector('.text-secondary-title, h2, h3, .font-bold'); return { id: p.id.slice(6), titre: texte(t && t.textContent) || 'Lieu ' + p.id.slice(6) }; });
    d.lieux.sort(function (a, b) { return (/^chargement/i.test(b.titre) ? 1 : 0) - (/^chargement/i.test(a.titre) ? 1 : 0); });
    var lien = Array.prototype.map.call(document.querySelectorAll('a[href]'), function (a) { return a.getAttribute('href'); })
      .filter(function (h) { return /^\/customers\/\d+(\/|$)/.test(h); })[0];
    var client = lien ? page('/customers/' + lien.match(/\d+/)[0] + '/edit').then(function (c) {
      d.client = {
        civilite: CIVILITES[valeur(c, 'customer[civility]')] || '',
        nom: valeur(c, 'customer[profile_attributes][lastname]'),
        email: valeur(c, 'customer[profile_attributes][account_attributes][email]') || valeur(c, 'customer[other_email]'),
        // Téléphones : jamais dans le mail ; transmis au script pour préparer l'espace client du dossier.
        telephones: [valeur(c, 'customer[phone]'), valeur(c, 'customer[other_phone]')].filter(Boolean)
      };
    }).catch(function () { d.avertissements = (d.avertissements || []).concat('fiche client illisible : nom et e-mail à saisir'); })
      : Promise.resolve(d.avertissements = ['client professionnel ou introuvable : nom et e-mail à saisir']);
    return client.then(function () { return d; });
  }
  function lireLieu(dossier, lieu) {
    return page('/contracts/' + dossier + '/places/' + lieu + '/edit?from=contract_details').then(function (p) {
      var a = 'place[address_attributes]';
      return {
        adresse: valeur(p, a + '[street]'), cp: valeur(p, a + '[zip_code]'), ville: valeur(p, a + '[city]'),
        complement: [etage(valeur(p, a + '[stage]')), valeur(p, a + '[complement]')].filter(Boolean).join(', ')
      };
    });
  }

  // ---------- Fenêtre ----------
  var STYLE = '#gc-rdv{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,30,.45);display:flex;align-items:center;justify-content:center;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#17212b}' +
    '#gc-rdv .f{background:#fff;border-radius:10px;width:620px;max-width:94vw;max-height:92vh;overflow:auto;box-shadow:0 12px 40px rgba(15,23,30,.3)}' +
    '#gc-rdv .t{padding:16px 22px 10px;font-weight:700;font-size:17px;display:flex;justify-content:space-between;align-items:center}' +
    '#gc-rdv .x{border:0;background:none;font-size:22px;cursor:pointer;color:#4a5866}' +
    '#gc-rdv .c{padding:0 22px 8px}' +
    '#gc-rdv .g{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}' +
    '#gc-rdv label{display:block;font-size:12px;color:#4a5866;margin-bottom:3px}' +
    '#gc-rdv input,#gc-rdv select{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #b9c2cc;border-radius:6px;font:inherit;color:inherit;background:#fff}' +
    '#gc-rdv .err input{border-color:#c0392b;background:#fdf0ee}' +
    '#gc-rdv .l2{grid-column:1/3}' +
    '#gc-rdv h4{margin:14px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#0b4f5a}' +
    '#gc-rdv .av{background:#fff6e0;border:1px solid #f0d58a;border-radius:6px;padding:8px 10px;margin:4px 0 6px}' +
    '#gc-rdv .msg{min-height:20px;margin:10px 0 0}#gc-rdv .msg.ko{color:#8a1c1c}#gc-rdv .msg.ok{color:#1d6b3a;font-weight:600}' +
    '#gc-rdv .b{display:flex;gap:10px;justify-content:flex-end;padding:12px 22px 18px;flex-wrap:wrap}' +
    '#gc-rdv button.s,#gc-rdv button.p{padding:9px 16px;border-radius:6px;font:inherit;cursor:pointer}' +
    '#gc-rdv button.s{border:1px solid #b9c2cc;background:#fff}#gc-rdv button.p{border:0;background:#0b4f5a;color:#fff;font-weight:600}' +
    '#gc-rdv button:disabled{opacity:.55;cursor:default}' +
    '#gc-rdv iframe{width:100%;height:520px;border:1px solid #dde3e8;border-radius:6px;background:#f4f6f8}';
  var CHAMPS = [
    ['client_civilite', 'Civilité', ''], ['client_nom', 'Nom du client', ''], ['client_email', 'E-mail du client', 'l2'],
    ['rdv_date', 'Date', '', 'date'], ['rdv_heure', 'Heure', '', 'time'],
    ['rdv_adresse', 'Adresse', 'l2'], ['rdv_cp', 'Code postal', ''], ['rdv_ville', 'Ville', ''], ['rdv_complement', 'Complément (étage, accès)', 'l2'],
    ['commercial_prenom', 'Prénom du commercial', ''], ['commercial_nom', 'Nom du commercial', '']
  ];
  var OBLIGATOIRES = ['client_nom', 'client_email', 'rdv_date', 'rdv_heure', 'rdv_adresse', 'rdv_cp', 'rdv_ville'];

  function ouvrir(dossier) {
    var ancien = document.getElementById('gc-rdv'); if (ancien) ancien.remove();
    if (!document.getElementById('gc-rdv-style')) { var st = document.createElement('style'); st.id = 'gc-rdv-style'; st.textContent = STYLE; document.head.appendChild(st); }
    var f = document.createElement('div');
    f.id = 'gc-rdv';
    f.innerHTML = '<div class="f" role="dialog" aria-label="Confirmation de rendez-vous"><div class="t"><span>Confirmation de rendez-vous</span><button class="x" type="button" aria-label="Fermer">×</button></div><div class="c"><div class="msg">Lecture du dossier…</div></div></div>';
    document.body.appendChild(f);
    var fermer = function () { f.remove(); };
    f.querySelector('.x').addEventListener('click', fermer);
    f.addEventListener('mousedown', function (e) { if (e.target === f) fermer(); });
    var corps = f.querySelector('.c');
    lireDossier(dossier).then(function (d) {
      var premier = d.lieux[0];
      return (premier ? lireLieu(dossier, premier.id) : Promise.resolve({})).then(function (l) { formulaire(f, dossier, d, l); });
    }).catch(function (e) { corps.innerHTML = '<div class="msg ko">Lecture impossible : ' + echapper(e && e.message || e) + '</div>'; });
  }

  function formulaire(f, dossier, d, lieu, opts) {
    opts = opts || {};
    var v = {
      client_civilite: d.client.civilite || '', client_nom: d.client.nom || '', client_email: d.client.email || '',
      rdv_date: d.rdv_date, rdv_heure: d.rdv_heure,
      rdv_adresse: lieu.adresse || '', rdv_cp: lieu.cp || '', rdv_ville: lieu.ville || '', rdv_complement: lieu.complement || '',
      commercial_prenom: d.commercial.prenom, commercial_nom: d.commercial.nom
    };
    var av = (d.avertissements || []).slice();
    if (!d.rdv_date) av.push('« Date de RDV » vide dans le dossier : date et heure à saisir');
    else if (!d.rdv_heure) av.push("l'heure du rendez-vous n'a pas été trouvée : à saisir");
    if (!d.commercial.nom) av.push('aucun commercial sur le dossier : prénom et nom à saisir');
    var h = '';
    if (STAGING) h += '<div class="av"><b>Staging</b> — pour un essai, mettez <b>votre propre adresse</b> dans « E-mail du client ».</div>';
    av.forEach(function (a) { h += '<div class="av">' + echapper(a.charAt(0).toUpperCase() + a.slice(1)) + '.</div>'; });
    h += '<div style="color:#4a5866">Dossier <b>' + echapper(d.reference) + '</b> — vérifiez et corrigez si besoin, rien n\'est modifié dans Ulyss.</div>';
    var groupe = function (titre, noms) {
      var s = '<h4>' + titre + '</h4><div class="g">';
      CHAMPS.filter(function (c) { return noms.indexOf(c[0]) >= 0; }).forEach(function (c) {
        var champ;
        if (c[0] === 'client_civilite') {
          champ = '<select name="client_civilite">' + ['', 'Madame', 'Monsieur', 'Monsieur et Madame', 'Maître'].map(function (o) { return '<option' + (o === v[c[0]] ? ' selected' : '') + ' value="' + echapper(o) + '">' + (o || '—') + '</option>'; }).join('') + '</select>';
        } else champ = '<input name="' + c[0] + '" type="' + (c[3] || (c[0] === 'client_email' ? 'email' : 'text')) + '" value="' + echapper(v[c[0]]) + '">';
        s += '<div class="' + c[2] + '" data-champ="' + c[0] + '"><label>' + c[1] + (OBLIGATOIRES.indexOf(c[0]) >= 0 ? ' *' : '') + '</label>' + champ + '</div>';
      });
      return s + '</div>';
    };
    h += groupe('Client', ['client_civilite', 'client_nom', 'client_email']);
    h += '<h4>Rendez-vous</h4>';
    if (d.lieux.length > 1) h += '<div class="lieu" style="margin-bottom:8px"><label>Lieu du rendez-vous</label><select name="lieu">' + d.lieux.map(function (l, i) { return '<option value="' + l.id + '"' + (i ? '' : ' selected') + '>' + echapper(l.titre) + '</option>'; }).join('') + '</select></div>';
    h += groupe('', ['rdv_date', 'rdv_heure', 'rdv_adresse', 'rdv_cp', 'rdv_ville', 'rdv_complement']).replace('<h4></h4>', '');
    if (opts.rdvFige) h += '<div style="color:#4a5866;font-size:12px;margin-top:4px">Date, heure et adresse viennent de la fenêtre de l\'agenda : pour les changer, fermez ici et modifiez-les dans Ulyss.</div>';
    h += groupe('Commercial', ['commercial_prenom', 'commercial_nom']);
    h += '<div class="msg"></div>';
    var corps = f.querySelector('.c');
    corps.innerHTML = h;
    if (opts.rdvFige) ['rdv_date', 'rdv_heure', 'rdv_adresse', 'rdv_cp', 'rdv_ville', 'rdv_complement'].forEach(function (k) { var e = corps.querySelector('[name=' + k + ']'); if (e) e.readOnly = true; });
    var boutons = document.createElement('div');
    boutons.className = 'b';
    f.querySelector('.f').appendChild(boutons);
    var msg = corps.querySelector('.msg');
    var dire = function (t, classe) { msg.className = 'msg ' + (classe || ''); msg.textContent = t; };
    var choixLieu = corps.querySelector('[name=lieu]');
    if (choixLieu) choixLieu.addEventListener('change', function () {
      dire('Lecture du lieu…');
      lireLieu(dossier, choixLieu.value).then(function (l) {
        ['adresse', 'cp', 'ville', 'complement'].forEach(function (k) { corps.querySelector('[name=rdv_' + k + ']').value = l[k] || ''; });
        dire('');
      }, function (e) { dire('Lieu illisible : ' + (e && e.message || e), 'ko'); });
    });
    var donnees = function () {
      var o = { dossier_reference: d.reference, telephones: d.client.telephones || [] };
      CHAMPS.forEach(function (c) { var e = corps.querySelector('[name=' + c[0] + ']'); o[c[0]] = texte(e && e.value); });
      o.client_nom = o.client_nom.toUpperCase();
      o.commercial_nom = o.commercial_nom.toUpperCase();
      var com = lireCommercial(o.commercial_prenom + ' ' + o.commercial_nom);
      o.commercial_email = com.email || 'commercial@fraisseix.fr';
      return o;
    };
    var marquer = function (champs) {
      corps.querySelectorAll('[data-champ]').forEach(function (x) { x.classList.toggle('err', (champs || []).indexOf(x.getAttribute('data-champ')) >= 0); });
    };
    var controler = function (o) {
      var manque = OBLIGATOIRES.filter(function (k) { return !o[k]; });
      if (o.client_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.client_email)) manque.push('client_email');
      if (!o.commercial_prenom && !o.commercial_nom) manque.push('commercial_prenom', 'commercial_nom');
      marquer(manque);
      if (manque.length) dire('À compléter : les champs en rouge.', 'ko');
      return !manque.length;
    };
    var bouton = function (libelle, classe, action) { var b = document.createElement('button'); b.type = 'button'; b.className = classe; b.textContent = libelle; b.addEventListener('click', action); boutons.appendChild(b); return b; };
    var occupe = function (oui) { boutons.querySelectorAll('button').forEach(function (b) { b.disabled = oui; }); };

    // Appel du script. Réponse : 200 envoyé (ou aperçu), 403 clé, 409 déjà envoyée, 422 champ, 429 plafond, 502 refus de la boîte.
    var appeler = function (o, ensuite) {
      occupe(true);
      demander({ type: 'gc-rdv', donnees: o }).then(function (r) {
        occupe(false);
        if (r && !r.ok && r.motif === 'code') {
          dire("Le code d'accès de l'extension est demandé une fois sur ce poste.");
          if (window.__gcDemanderCode) window.__gcDemanderCode(function () { appeler(o, ensuite); });
          return;
        }
        if (!r || !r.ok) { dire('Envoi impossible : ' + (r && r.motif || 'pas de réponse') + '.', 'ko'); return; }
        var j = r.corps || {};
        if (r.statut === 200 && j.ok) { ensuite(j); return; }
        if (r.statut === 409) {
          dire((j.erreur || 'Cette confirmation a déjà été envoyée.') + ' Renvoyer quand même ?', 'ko');
          boutons.innerHTML = '';
          bouton('Annuler', 's', function () { f.remove(); });
          bouton('Renvoyer quand même', 'p', function () { o.forcer = true; appeler(o, ensuite); });
          return;
        }
        if (r.statut === 422) { marquer(j.champs); retourFormulaire(); }
        var motifs = { 403: 'clé refusée par le script (réglages à revoir)', 429: 'plafond d\'envois de l\'heure atteint, réessayer plus tard', 502: 'la boîte contact@fraisseix.fr a refusé l\'envoi' };
        dire((j.erreur || motifs[r.statut] || ('réponse ' + r.statut + (r.brut ? ' : ' + r.brut : ''))), 'ko');
      });
    };
    var cadre = null;
    var retourFormulaire = function () {
      if (cadre) { cadre.remove(); cadre = null; }
      corps.querySelectorAll('h4,.g,.lieu').forEach(function (x) { x.style.display = ''; });
      boutons.innerHTML = '';
      bouton('Annuler', 's', function () { f.remove(); });
      bouton('Voir le mail', 'p', apercu);
    };
    var apercu = function () {
      var o = donnees();
      if (!controler(o)) return;
      dire('Préparation de l\'aperçu…');
      o.apercu = true;
      appeler(o, function (j) {
        delete o.apercu;
        corps.querySelectorAll('h4,.g,.lieu').forEach(function (x) { x.style.display = 'none'; });
        cadre = document.createElement('iframe');
        cadre.setAttribute('sandbox', '');
        cadre.srcdoc = j.html || '';
        msg.parentElement.insertBefore(cadre, msg);
        dire('Objet : ' + (j.objet || ''));
        boutons.innerHTML = '';
        bouton('Modifier', 's', function () { dire(''); retourFormulaire(); });
        bouton(opts.avantEnvoi ? 'Enregistrer et envoyer à ' + o.client_email : 'Envoyer à ' + o.client_email, 'p', function () {
          var envoyer = function () { dire('Envoi en cours…'); appeler(o, fin); };
          if (!opts.avantEnvoi) { envoyer(); return; }
          occupe(true);
          dire('Enregistrement du rendez-vous dans Ulyss…');
          opts.avantEnvoi().then(function () { occupe(false); envoyer(); }, function (e) { occupe(false); dire((e && e.message) || String(e), 'ko'); });
        });
        var fin = function (k) {
            boutons.innerHTML = '';
            bouton('Fermer', 'p', function () { f.remove(); });
            var esp = k.espace && k.espace.raison !== 'désactivé' ? (k.espace.fait ? ' Espace client préparé.' : ' Espace client non préparé (' + k.espace.raison + ').') : '';
            dire((opts.avantEnvoi ? 'Rendez-vous enregistré dans Ulyss. ' : '') + 'Confirmation envoyée à ' + (k.destinataire || o.client_email) + (k.copie_envoyes ? ' — copie rangée dans « ' + k.copie_envoyes + ' ».' : ' — pas de copie dans les « Envoyés ».') + esp, 'ok');
        };
        if (opts.envoiDirect) boutons.querySelector('button.p').click();
      });
    };
    retourFormulaire();
    if (opts.envoiDirect) apercu();   // sans aperçu à montrer : on enchaîne aperçu (contrôles du script) puis envoi
  }

  // ---------- Agenda : « Confirmer le RDV » à la place de « Valider » ----------
  // Fenêtre #modal_agenda_item-js, formulaire #form_agenda_item-js, bouton natif a#submit_agenda_item-js (le contrôleur
  // de l'agenda d'Ulyss l'écoute et enregistre en JSON). Notre bouton ne s'affiche que pour un rendez-vous (type 1) lié à un
  // dossier d'une société active ; sinon le « Valider » d'Ulyss reste tel quel. L'enregistrement passe par le bouton natif
  // (Ulyss fait exactement ce qu'il fait d'habitude), puis on relit l'agenda avant d'envoyer le mail.
  function champ(form, nom) { var e = form.querySelector('[name="' + nom + '"]'); return e ? (e.tagName === 'SELECT' ? (e.selectedOptions[0] || {}) : e) : {}; }
  function etatAgenda() {
    var modale = document.getElementById('modal_agenda_item-js'), form = document.getElementById('form_agenda_item-js'), natif = document.getElementById('submit_agenda_item-js');
    if (!modale || !form || !natif) return null;
    var type = champ(form, 'agenda_item[agenda_type_id]').value;
    var dossier = champ(form, 'agenda_item[contract_id]');
    var lettre = (texte(dossier.textContent).match(/^DGT[CD]([A-Z])/) || [])[1];
    return { modale: modale, form: form, natif: natif, actif: type === '1' && !!dossier.value && SOCIETES.indexOf(lettre) >= 0 };
  }
  function poserBoutonAgenda() {
    if (!HOTES.test(location.hostname) && !envoiEssai) return;
    var e = etatAgenda();
    if (!e) return;
    var notre = document.getElementById('gc-rdv-agenda');
    if (!notre) {
      notre = document.createElement('a');
      notre.id = 'gc-rdv-agenda';
      notre.href = '#';
      notre.className = e.natif.className;
      notre.textContent = 'Confirmer le RDV';
      notre.title = 'Enregistre le rendez-vous dans Ulyss et envoie la confirmation au client (Extension Ulyss)';
      notre.addEventListener('click', function (ev) { ev.preventDefault(); ouvrirDepuisAgenda(); });
      e.natif.insertAdjacentElement('afterend', notre);
      e.form.addEventListener('change', poserBoutonAgenda);
    }
    notre.style.display = e.actif ? '' : 'none';
    e.natif.style.display = e.actif ? 'none' : '';
  }
  function ouvrirDepuisAgenda() {
    var e = etatAgenda();
    if (!e || !e.actif) return;
    var form = e.form;
    var debut = String(champ(form, 'agenda_item[start_at]').value || '');          // 2026-12-03T10:00
    var dossierOpt = champ(form, 'agenda_item[contract_id]'), clientOpt = champ(form, 'agenda_item[customer_id]');
    var d = {
      reference: texte(dossierOpt.textContent), lieux: [], avertissements: [],
      rdv_date: debut.slice(0, 10), rdv_heure: debut.slice(11, 16),
      commercial: lireCommercial(texte(champ(form, 'agenda_item[collaborator_id]').textContent)),
      client: { telephones: String(champ(form, 'agenda_item[phone]').value || '').split(/[\n,;\/]+/).map(texte).filter(Boolean) }
    };
    var lieu = {
      adresse: texte(champ(form, 'agenda_item[address_attributes][street]').value),
      cp: texte(champ(form, 'agenda_item[address_attributes][zip_code]').value),
      ville: texte(champ(form, 'agenda_item[address_attributes][city]').value),
      complement: texte(champ(form, 'agenda_item[address_attributes][complement]').value)
    };
    var dossierId = dossierOpt.value;
    var ancien = document.getElementById('gc-rdv'); if (ancien) ancien.remove();
    if (!document.getElementById('gc-rdv-style')) { var st = document.createElement('style'); st.id = 'gc-rdv-style'; st.textContent = STYLE; document.head.appendChild(st); }
    var f = document.createElement('div');
    f.id = 'gc-rdv';
    f.innerHTML = '<div class="f" role="dialog" aria-label="Confirmation de rendez-vous"><div class="t"><span>Confirmer le rendez-vous</span><button class="x" type="button" aria-label="Fermer">×</button></div><div class="c"><div class="msg">Lecture du client…</div></div></div>';
    document.body.appendChild(f);
    f.querySelector('.x').addEventListener('click', function () { f.remove(); });
    var client = clientOpt.value ? page('/customers/' + clientOpt.value + '/edit').then(function (c) {
      d.client.civilite = CIVILITES[valeur(c, 'customer[civility]')] || '';
      d.client.nom = valeur(c, 'customer[profile_attributes][lastname]');
      d.client.email = valeur(c, 'customer[profile_attributes][account_attributes][email]') || valeur(c, 'customer[other_email]');
      [valeur(c, 'customer[phone]'), valeur(c, 'customer[other_phone]')].forEach(function (t) { if (t && d.client.telephones.indexOf(t) < 0) d.client.telephones.push(t); });
    }).catch(function () { d.avertissements.push('fiche client illisible : nom et e-mail à saisir'); })
      : Promise.resolve(d.avertissements.push('aucun client choisi dans l\'agenda : nom et e-mail à saisir'));
    client.then(function () {
      if (!d.client.nom) d.client.nom = texte(clientOpt.textContent).split(' ').filter(function (w) { return w.length > 1 && w === w.toUpperCase(); }).join(' ');
      formulaire(f, dossierId, d, lieu, {
        rdvFige: true,
        envoiDirect: !APERCU_AGENDA,
        avantEnvoi: function () { return enregistrerAgenda(dossierId, debut); }
      });
    });
  }
  // Enregistre par le bouton natif d'Ulyss, puis relit l'agenda de la semaine : le rendez-vous du dossier, à cette heure,
  // modifié il y a moins de deux minutes. Sans relecture, pas de mail (Ulyss peut refuser sans le dire).
  function enregistrerAgenda(dossierId, debut) {
    var e = etatAgenda();
    if (!e) return Promise.reject(new Error('La fenêtre de l\'agenda a été fermée : rendez-vous non enregistré, mail non envoyé.'));
    var depart = Date.now();
    e.natif.click();
    var essais = 0;
    return new Promise(function (ok, ko) {
      var relire = function () {
        essais++;
        page('/agenda_items?date=' + debut.slice(0, 10)).then(function (doc) {
          var cal = doc.querySelector('[data-controller~=calendar]'), evs = [];
          try { evs = JSON.parse(cal.getAttribute('data-events') || '[]'); } catch (x) {}
          var trouve = evs.filter(function (v) {
            return String(v.contract_id) === String(dossierId) && String(v.agenda_type_id) === '1' && String(v.start_at || '').slice(0, 16) === debut.slice(0, 16)
              && Date.parse(v.updated_at) >= depart - 120000;
          })[0];
          if (trouve) { ok(trouve); return; }
          if (essais >= 8) { ko(new Error('Le rendez-vous n\'apparaît pas dans l\'agenda d\'Ulyss : vérifiez la fenêtre de l\'agenda (champ manquant ?). Mail non envoyé.')); return; }
          setTimeout(relire, 1500);
        }, function () { if (essais >= 8) ko(new Error('Agenda illisible : mail non envoyé.')); else setTimeout(relire, 1500); });
      };
      setTimeout(relire, 1200);
    });
  }

  new MutationObserver(function () { poserBouton(); poserBoutonAgenda(); }).observe(document.documentElement, { childList: true, subtree: true });
  poserBouton();
  poserBoutonAgenda();
})();
