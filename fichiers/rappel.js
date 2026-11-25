/*
 * Extension Ulyss — bouton « Envoyer rappel déménagement » (onglet Pré-planification d'Ulyss).
 * Repris le 25/11/2026 du cadrage fait dans un autre projet (bouton-rappel-demenagement.js), et intégré à l'extension :
 *   - l'appel passe par le service worker (message gc-rdv, cible « rappel ») : adresse et clé dans le fichier chiffré ;
 *   - bouton seulement sur ulyss.fr et le staging, pour les sociétés dont le modèle existe (Fraisseix) ;
 *   - client lu dans le formulaire de la fiche client (comme la confirmation de rendez-vous) ;
 *   - date du jour 1 lue dans l'en-tête de la phase (« 08 Oct. 2026 - 08 Oct. 2026 », présent quand l'organisation est
 *     validée), jours suivants en sautant les week-ends comme Ulyss ; sinon, saisie de la date du jour 1.
 * Relevé sur le staging le 25/11/2026 : data-events en dates relatives (1970-01-01 = jour 1), bouton « Affichage » =
 * a.btn.btn-outline dans div.dropdown.ml-5, en-tête de phase = #phase-title puis div.ml-2 avec les dates.
 */
(() => {
  'use strict';

  const ID_BOUTON = 'limodem-bouton-rappel';
  const LIBELLE = 'Envoyer rappel déménagement';
  const ROLES = ["Chef d'équipe", 'Déménageur', 'Conducteur'];
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const CHEMIN = /^\/contracts\/(\d+)\/phases(?:\/(\d+))?/;
  const SOCIETES = ['F'];   // lettre après C ou D dans le numéro ; ajouter B, L… quand leur modèle de rappel existera
  const CIVILITES = { male: 'Monsieur', female: 'Madame', both: 'Madame et Monsieur', other: '' };
  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => {
      try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false, motif: "l'extension ne répond pas (recharger la page)" }); }); }
      catch (e) { ok({ ok: false, motif: "l'extension a été mise à jour : recharger la page" }); }
    });
  }
  const MOIS_ULYSS = { janv: 1, jan: 1, févr: 2, fevr: 2, fév: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dec: 12 };
  /** « 08 Oct. 2026 » → « 2026-10-08 » */
  function dateUlyss(s) {
    const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{4})$/);
    const mois = m && MOIS_ULYSS[m[2]];
    return mois ? `${m[3]}-${String(mois).padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }
  /** Dates de la phase lues dans son en-tête : { debut, fin } ou null (organisation pas encore validée). */
  function datesDePhase() {
    const titre = document.getElementById('phase-title');
    const bloc = titre && titre.parentElement ? titre.parentElement.querySelector('.ml-2') : null;
    const m = bloc ? bloc.textContent.replace(/\s+/g, ' ').match(/(\d{1,2} [^\d-]+? \d{4})\s*-\s*(\d{1,2} [^\d-]+? \d{4})/) : null;
    if (!m) return null;
    const debut = dateUlyss(m[1]), fin = dateUlyss(m[2]);
    return debut && fin ? { debut, fin } : null;
  }

  // ---------------------------------------------------------------------------
  // Lecture d'Ulyss
  // ---------------------------------------------------------------------------

  /** Phase affichée : un seul [data-events] sur la page ; numéro de phase lu dans l'adresse ou dans les évènements. */
  function lirePhases() {
    const el = document.querySelector('[data-events]');
    if (!el) return [];
    let evts = [];
    try { evts = JSON.parse(el.getAttribute('data-events') || '[]'); } catch (e) { evts = []; }
    const idAdresse = (location.pathname.match(CHEMIN) || [])[2];
    const idEvt = evts.map((ev) => (String(ev.url || '').match(/phases\/(\d+)/) || [])[1]).find(Boolean);
    const titre = (document.getElementById('phase-title')?.textContent || '').trim();
    return evts.length ? [{ id: idAdresse || idEvt || '', libelle: titre || 'Phase', evenements: evts }] : [];
  }

  /** « 1970-01-03T08:30:00 » → { relatif: true, jour: 3, date: null, heure: '08:30' } */
  function lireMoment(valeur) {
    const m = String(valeur || '').match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return null;
    const heure = `${m[4]}:${m[5]}`;
    if (m[1] === '1970') {
      const jour = Math.round((Date.UTC(1970, +m[2] - 1, +m[3]) - Date.UTC(1970, 0, 1)) / 86400000) + 1;
      return { relatif: true, jour, date: null, heure };
    }
    return { relatif: false, jour: null, date: `${m[1]}-${m[2]}-${m[3]}`, heure };
  }

  /** Libellé client d'une étape, d'après le nom ou le type de l'évènement. Les pauses ne sont pas montrées. */
  function typeEtape(ev) {
    const t = `${ev.activity || ''} ${ev.name || ''}`.toLowerCase();
    if (/break|pause/.test(t)) return null;
    if (/loading|charg/.test(t)) return 'Chargement';
    if (/delivery|livr/.test(t)) return 'Livraison';
    if (/packing|pr[ée]par|emball/.test(t)) return 'Emballage';
    if (/moving|d[ée]plac|trajet|>/.test(t)) return 'Trajet';
    return (ev.name || 'Intervention').trim();
  }

  function nettoyerLieu(l) {
    return String(l || '').replace(/^\s*(chargement|livraison)\s*[-–:]\s*/i, '').trim();
  }

  /** Jours de la phase : [{ jour, date, etapes: [{type, debut, fin, lieu}] }] */
  function joursDePhase(phase) {
    const parJour = new Map();
    for (const ev of phase.evenements) {
      const type = typeEtape(ev);
      const d = lireMoment(ev.start);
      const f = lireMoment(ev.end);
      if (!type || !d) continue;
      const cle = d.relatif ? `J${d.jour}` : d.date;
      if (!parJour.has(cle)) parJour.set(cle, { jour: d.jour, date: d.date, etapes: [] });
      parJour.get(cle).etapes.push({ type, debut: d.heure, fin: f ? f.heure : '', lieu: nettoyerLieu(ev.location) });
    }
    const jours = [...parJour.values()];
    jours.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : (a.jour || 0) - (b.jour || 0)));
    jours.forEach((j) => j.etapes.sort((a, b) => a.debut.localeCompare(b.debut)));
    return jours;
  }

  /** Nombre de déménageurs prévus (le plus grand nbEmp de la phase). */
  function effectifPrevu(phase) {
    return Math.max(0, ...phase.evenements.map((ev) => parseInt(ev.nbEmp, 10) || 0));
  }

  /**
   * Numéro du dossier affiché : en-tête #contract_header_banner (h2#subtitle). Le corps de la page peut contenir avant lui
   * le numéro d'un dossier lié (constaté en production le 25/11/2026 : DGTDL… avant DGTDF2611-087) : ne pas le prendre.
   */
  function numeroDossier() {
    const zones = [document.querySelector('#contract_header_banner #subtitle'), document.querySelector('#contract_header_banner'), document.querySelector('h2#subtitle'), document.querySelector('main') || document.body];
    for (const z of zones) {
      const m = z && z.textContent.match(/DGT[CD][A-Z]\d{4}-\d{3}(?:_\d+)?/);
      if (m) return m[0];
    }
    return '';
  }

  /** Client et dossier : numéro sur la page, client lu dans le formulaire de sa fiche (comme la confirmation de RDV). */
  async function lireClient() {
    const reference = numeroDossier();
    const r = { nom: '', email: '', civilite: '', reference, societe: (reference.match(/^DGT[CD]([A-Z])/) || [])[1] || '' };
    const lien = [...document.querySelectorAll('#contract_header_banner a[href]'), ...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => /^\/customers\/\d+(\/|$)/.test(h));
    if (!lien) return r;
    try {
      const html = await fetch('/customers/' + lien.match(/\d+/)[0] + '/edit', { credentials: 'same-origin' }).then((x) => x.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const val = (n) => { const e = doc.querySelector(`[name="${n}"]`); return e ? String(e.tagName === 'SELECT' ? (e.selectedOptions[0] || {}).value || '' : e.value).trim() : ''; };
      r.civilite = CIVILITES[val('customer[civility]')] || '';
      r.nom = val('customer[profile_attributes][lastname]').toUpperCase();
      r.email = val('customer[profile_attributes][account_attributes][email]') || val('customer[other_email]');
    } catch (e) { /* champs laissés vides, à compléter dans la fenêtre */ }
    return r;
  }

  /** Recherche d'un collaborateur par nom dans Ulyss : renvoie {id, nomComplet, prenom} ou null. */
  async function chercherCollaborateur(texte) {
    const url = `/collaborators/filter?scope=default&filter_collaborator%5Bsearch%5D=${encodeURIComponent(texte)}&filter_collaborator%5Bactive_status%5D=active`;
    const html = await fetch(url, { credentials: 'same-origin' }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const tr of doc.querySelectorAll('tbody tr')) {
      const a = [...tr.querySelectorAll('a')].find((x) => /^\/collaborators\/\d+$/.test(x.getAttribute('href') || ''));
      if (!a) continue;
      const nomComplet = a.textContent.trim().replace(/\s+/g, ' ');
      const prenom = nomComplet.split(' ').filter((m) => m !== m.toUpperCase()).join(' ') || nomComplet.split(' ')[0];
      return { id: a.getAttribute('href').split('/').pop(), nomComplet, prenom };
    }
    return null;
  }

  /**
   * Équipe affectée dans le Planning au jour 1 de la phase (relevé sur le staging le 25/11/2026) :
   *  1. vue compacte du jour (/exploitation_requirements/affectation?…&view=compact, ~3-4 s) : une carte
   *     [id^=card_exploitation_requirement_<er>] par chantier, titre .text-bold = « NOM I. » du client ;
   *  2. /exploitation_requirements/<er>/edit (~5 s) des cartes dont le titre commence par le nom du client :
   *     on garde celles qui pointent vers contracts/<dossier>/phases/<phase> (contrôle sans faux positif) ;
   *  3. selects [collaborator_id] du formulaire simple_collaborator_affectation, dans l'ordre : position 1 = chef d'équipe.
   * Lectures en série, jamais en parallèle (le Planning ralentit de moitié sinon). Renvoie [{id, court}] ou null.
   */
  async function equipeDuPlanning(jour1, nomClient, dossierId, phaseId, suivre) {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const nom = norm(nomClient);
    if (!jour1 || !nom || !dossierId) return null;
    suivre('Lecture du Planning du ' + jour1.split('-').reverse().join('/') + '…');
    const s = '&structures%5B%5D=1&structures%5B%5D=2&structures%5B%5D=3';
    const html = await fetch(`/exploitation_requirements/affectation?date=${jour1}${s}&view=compact`, { credentials: 'same-origin' }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cartes = [...doc.querySelectorAll('[id^="card_exploitation_requirement"]')]
      .filter((c) => norm(c.querySelector('.text-bold')?.textContent).startsWith(nom))
      .map((c) => c.id.replace(/\D/g, ''))
      .slice(0, 4);
    if (!cartes.length) return null;
    const cible = phaseId ? `contracts/${dossierId}/phases/${phaseId}` : `contracts/${dossierId}/`;
    const equipe = [];
    for (const [i, er] of cartes.entries()) {
      suivre(`Lecture de l'affectation (${i + 1}/${cartes.length})…`);
      const h = await fetch(`/exploitation_requirements/${er}/edit`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''));
      if (!h.includes(cible)) continue;
      const d = new DOMParser().parseFromString(h, 'text/html');
      const form = d.querySelector('form[action*="simple_collaborator_affectation"]') || d;
      for (const sel of form.querySelectorAll('select[name*="[collaborator_id]"]')) {
        const o = sel.selectedOptions[0];
        if (o && o.value && !equipe.some((m) => m.id === o.value)) equipe.push({ id: o.value, court: o.textContent.trim() });
      }
    }
    return equipe.length ? equipe : null;
  }

  /** Prénom de la fiche collaborateur : titre « Collaborateurs - Prénom NOM ». */
  function prenomFiche(doc) {
    const t = (doc.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').replace(/^.*?-\s*/, '').trim();
    return t.split(' ').filter((m) => m !== m.toUpperCase()).join(' ');
  }

  /** Photo de la fiche collaborateur, recadrée en carré 300 × 300, en JPEG base64 (ou '' si absente). */
  async function photoCollaborateur(id, fiche) {
    try {
      const html = await fetch(`/collaborators/${id}`, { credentials: 'same-origin' }).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (fiche) fiche.prenom = prenomFiche(doc);
      const img = [...doc.querySelectorAll('img')].find((i) => /active_storage/.test(i.getAttribute('src') || '') && !/logotype|logo/i.test(decodeURIComponent(i.getAttribute('src'))));
      if (!img) return '';
      const blob = await fetch(img.getAttribute('src'), { credentials: 'same-origin' }).then((r) => (r.ok ? r.blob() : null));
      if (!blob) return '';
      const bmp = await createImageBitmap(blob);
      const cote = Math.min(bmp.width, bmp.height);
      const sx = (bmp.width - cote) / 2;
      const sy = bmp.height > bmp.width ? (bmp.height - cote) * 0.12 : 0;
      const c = document.createElement('canvas');
      c.width = c.height = 300;
      c.getContext('2d').drawImage(bmp, sx, sy, cote, cote, 0, 0, 300, 300);
      return c.toDataURL('image/jpeg', 0.88);
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------
  /** Ulyss saute les week-ends pour un déménagement sur plusieurs jours. */
  function ajouterJoursOuvres(iso, n) {
    let d = iso;
    for (let i = 0; i < n; i++) { do { d = ajouterJours(d, 1); } while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())); }
    return d;
  }
  function ajouterJours(iso, n) {
    const [a, m, j] = iso.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1, j + n));
    return d.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Fenêtre
  // ---------------------------------------------------------------------------
  const CSS = `
    :host{all:initial}
    .voile{position:fixed;inset:0;background:rgba(14,22,38,.55);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px;font-family:Arial,Helvetica,sans-serif}
    .fen{background:#fff;width:min(980px,100%);border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.35);color:#1A2D4B;font-size:13px}
    .tete{background:#1A2D4B;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #CAAE47;border-radius:6px 6px 0 0}
    .tete b{letter-spacing:1px} .x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}
    .corps{display:grid;grid-template-columns:1fr 1fr;gap:0}
    .col{padding:16px 20px;max-height:72vh;overflow:auto} .col+.col{border-left:1px solid #E4DDC8;background:#FAF7EE}
    h4{margin:16px 0 8px;font-size:11px;letter-spacing:2px;color:#A9812F;text-transform:uppercase} h4:first-child{margin-top:0}
    label{display:block;font-size:11px;color:#6B7382;margin:6px 0 2px}
    input,select{box-sizing:border-box;width:100%;padding:6px 7px;border:1px solid #cfc8b4;border-radius:3px;font-size:13px;color:#1A2D4B;background:#fff}
    .ligne{display:grid;gap:6px;align-items:end;margin-bottom:6px}
    .l-client{grid-template-columns:130px 1fr} .l-etape{grid-template-columns:110px 96px 96px 1fr 24px} .l-membre{grid-template-columns:44px 1fr 130px 1fr 70px 24px}
    .jour{border:1px solid #E4DDC8;border-radius:4px;padding:8px 10px;margin-bottom:10px}
    .jour .titre{display:flex;gap:8px;align-items:center;margin-bottom:6px;font-weight:bold}
    .jour .titre input{width:150px}
    .mini{background:none;border:1px solid #cfc8b4;border-radius:3px;cursor:pointer;color:#1A2D4B;padding:5px 8px;font-size:12px}
    .suppr{background:none;border:0;color:#b33;cursor:pointer;font-size:15px;padding:4px}
    .vign{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid #CAAE47;background:#24395C}
    .pied{display:flex;gap:10px;justify-content:flex-end;align-items:center;padding:12px 20px;border-top:1px solid #E4DDC8}
    .btn{border:0;border-radius:3px;padding:9px 16px;font-weight:bold;letter-spacing:1px;cursor:pointer;font-size:12px}
    .prim{background:#1A2D4B;color:#fff} .sec{background:#fff;color:#1A2D4B;border:1px solid #1A2D4B} .or{background:#CAAE47;color:#1A2D4B}
    .btn:disabled{opacity:.5;cursor:default}
    .msg{flex:1;font-size:12px} .err{color:#b33} .ok{color:#2e7d32}
    iframe{width:100%;height:68vh;border:0;background:#EEEAE0}
    .note{font-size:11px;color:#6B7382;margin:4px 0 8px}
  `;

  function el(tag, attrs = {}, ...enfants) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) n.setAttribute(k, v);
    }
    enfants.flat().forEach((e) => n.append(e instanceof Node ? e : document.createTextNode(String(e))));
    return n;
  }

  async function ouvrirFenetre() {
    const phases = lirePhases();
    if (!phases.length) {
      alerteSimple("Aucune pré-planification lisible sur cette page (attribut data-events introuvable).");
      return;
    }
    const client = await lireClient();

    const hote = el('div');
    document.body.append(hote);
    const racine = hote.attachShadow({ mode: 'open' });
    racine.append(el('style', {}, CSS));
    const fermer = () => hote.remove();

    // --- état ---
    let phase = phases[0];
    let jours = joursDePhase(phase);
    let membres = [];
    const initMembres = () => {
      const n = Math.max(1, effectifPrevu(phase));
      membres = Array.from({ length: n }, (_, i) => ({ prenom: '', role: i === 0 ? ROLES[0] : ROLES[1], id: '', vignette: '' }));
    };
    initMembres();

    // --- champs client ---
    const fCiv = el('select', {}, ['', 'Madame', 'Monsieur', 'Madame et Monsieur', 'Maître'].map((c) => el('option', { value: c }, c || '—')));
    fCiv.value = client.civilite;
    const fNom = el('input', { value: client.nom });
    const fMail = el('input', { type: 'email', value: client.email });
    const fRef = el('input', { value: client.reference });
    const fPhase = el('select', { onchange: () => { phase = phases[+fPhase.value]; jours = joursDePhase(phase); initMembres(); dessinerJours(); dessinerEquipe(); remplirDepuisPlanning(); } },
      phases.map((p, i) => el('option', { value: i }, p.libelle)));
    const relatif = () => jours.some((j) => !j.date || j.relatif);
    const fJour1 = el('input', { type: 'date', onchange: () => { appliquerJour1(); dessinerJours(); } });

    function appliquerJour1() {
      if (!fJour1.value) return;
      const base = jours[0]?.jour || 1;
      jours.forEach((j) => { if (j.jour) { j.date = ajouterJoursOuvres(fJour1.value, j.jour - base); j.relatif = true; } });
    }
    // Organisation validée : l'en-tête de la phase donne les dates réelles ; on en déduit le jour 1.
    const periode = datesDePhase();
    if (periode && relatif()) { fJour1.value = periode.debut; appliquerJour1(); }

    const zoneJours = el('div');
    const zoneEquipe = el('div');
    const noteEquipe = el('div', { class: 'note' });
    const msg = el('div', { class: 'msg' });
    const cadre = el('iframe', { title: 'Aperçu du mail' });

    function dessinerJours() {
      zoneJours.replaceChildren();
      jours.forEach((j, ij) => {
        const fDate = el('input', { type: 'date', value: j.date || '', onchange: () => { j.date = fDate.value; } });
        const bloc = el('div', { class: 'jour' },
          el('div', { class: 'titre' }, `Jour ${j.jour || ij + 1}`, fDate,
            el('button', { class: 'suppr', title: 'Retirer ce jour', onclick: () => { jours.splice(ij, 1); dessinerJours(); } }, '✕')));
        j.etapes.forEach((et, ie) => {
          const fType = el('input', { value: et.type, list: 'types-etape', onchange: () => { et.type = fType.value; } });
          const fDeb = el('input', { type: 'time', value: et.debut, onchange: () => { et.debut = fDeb.value; } });
          const fFin = el('input', { type: 'time', value: et.fin, onchange: () => { et.fin = fFin.value; } });
          const fLieu = el('input', { value: et.lieu, placeholder: 'Adresse affichée au client', onchange: () => { et.lieu = fLieu.value; } });
          bloc.append(el('div', { class: 'ligne l-etape' }, fType, fDeb, fFin, fLieu,
            el('button', { class: 'suppr', title: 'Retirer cette étape', onclick: () => { j.etapes.splice(ie, 1); dessinerJours(); } }, '✕')));
        });
        bloc.append(el('button', { class: 'mini', onclick: () => { j.etapes.push({ type: '', debut: '08:00', fin: '12:00', lieu: '' }); dessinerJours(); } }, '+ étape'));
        zoneJours.append(bloc);
      });
      zoneJours.append(el('button', { class: 'mini', onclick: () => {
        const der = jours[jours.length - 1];
        jours.push({ jour: (der?.jour || jours.length) + 1, date: der?.date ? ajouterJours(der.date, 1) : '', etapes: [{ type: 'Livraison', debut: '08:00', fin: '12:00', lieu: '' }] });
        dessinerJours();
      } }, '+ jour'));
    }

    function dessinerEquipe() {
      zoneEquipe.replaceChildren();
      membres.forEach((m, im) => {
        const vign = el('img', { class: 'vign', alt: '', src: m.vignette || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>' });
        const fPrenom = el('input', { value: m.prenom, placeholder: 'Prénom', onchange: () => { m.prenom = fPrenom.value; } });
        const fRole = el('select', { onchange: () => { m.role = fRole.value; } }, ROLES.map((r) => el('option', { value: r }, r)));
        fRole.value = m.role;
        const fCherche = el('input', { placeholder: 'Nom dans Ulyss' });
        const bLier = el('button', { class: 'mini', onclick: async () => {
          if (!fCherche.value.trim()) return;
          bLier.disabled = true; bLier.textContent = '…';
          const c = await chercherCollaborateur(fCherche.value.trim()).catch(() => null);
          if (c) {
            m.id = c.id; m.prenom = m.prenom || c.prenom; fCherche.value = c.nomComplet;
            m.vignette = await photoCollaborateur(c.id);
            dessinerEquipe();
          } else {
            bLier.disabled = false; bLier.textContent = 'Lier'; fCherche.style.borderColor = '#b33';
          }
        } }, m.id ? '✓' : 'Lier');
        if (m.id) fCherche.value = `Fiche n° ${m.id}`;
        zoneEquipe.append(el('div', { class: 'ligne l-membre' }, vign, fPrenom, fRole, fCherche, bLier,
          el('button', { class: 'suppr', title: 'Retirer', onclick: () => { membres.splice(im, 1); dessinerEquipe(); } }, '✕')));
      });
      zoneEquipe.append(el('button', { class: 'mini', onclick: () => { membres.push({ prenom: '', role: ROLES[1], id: '', vignette: '' }); dessinerEquipe(); } }, '+ personne'));
    }

    function donnees(extra = {}) {
      return {
        client_civilite: fCiv.value,
        client_nom: fNom.value.trim(),
        client_email: fMail.value.trim(),
        dossier_reference: fRef.value.trim(),
        phase_id: phase.id,
        jours: jours.map((j) => ({ date: j.date, etapes: j.etapes.filter((e) => e.type.trim()) })),
        equipe: membres.filter((m) => m.prenom.trim()).map((m) => ({ prenom: m.prenom.trim(), role: m.role, collaborateur_id: m.id, photo_base64: m.vignette })),
        ...extra,
      };
    }

    function controle() {
      const d = donnees();
      if (!d.client_nom || !d.client_email || !d.dossier_reference) return 'Complétez le nom, l\'e-mail du client et le numéro de dossier.';
      if (!d.jours.length) return 'Aucun jour dans la phase.';
      if (d.jours.some((j) => !j.date)) return relatif() ? 'Indiquez la date du jour 1 (ou la date de chaque jour).' : 'Une date de jour est manquante.';
      if (d.jours.some((j) => !j.etapes.length || j.etapes.some((e) => !e.debut || !e.fin))) return 'Chaque jour doit avoir au moins une étape, avec heure de début et de fin.';
      return '';
    }

    async function appel(extra) {
      const r = await demander({ type: 'gc-rdv', cible: 'rappel', donnees: donnees(extra) });
      if (r && !r.ok && r.motif === 'code') {
        if (window.__gcDemanderCode) await new Promise((ok) => window.__gcDemanderCode(ok));
        return appel(extra);
      }
      if (!r || !r.ok) throw new Error('Envoi impossible : ' + ((r && r.motif) || 'pas de réponse') + '.');
      const j = r.corps || { ok: false, erreur: 'Réponse illisible (code ' + r.statut + ').' };
      return { code: r.statut, ...j };
    }

    const bApercu = el('button', { class: 'btn sec', onclick: async () => {
      const pb = controle(); if (pb) { afficher(pb, true); return; }
      bApercu.disabled = true; afficher('Préparation de l\'aperçu…');
      try {
        const r = await appel({ apercu: true });
        if (r.ok) { cadre.srcdoc = r.html; afficher(`Objet : ${r.objet} — à : ${r.destinataire}`); bEnvoyer.disabled = false; }
        else afficher(r.erreur || 'Erreur.', true);
      } catch (e) { afficher(e.message, true); }
      bApercu.disabled = false;
    } }, 'APERÇU');

    const bForcer = el('button', { class: 'btn or', style: 'display:none', onclick: () => envoyer(true) }, 'RENVOYER QUAND MÊME');
    const bEnvoyer = el('button', { class: 'btn prim', disabled: '', onclick: () => envoyer(false) }, 'ENVOYER AU CLIENT');

    async function envoyer(forcer) {
      const pb = controle(); if (pb) { afficher(pb, true); return; }
      bEnvoyer.disabled = true; bForcer.style.display = 'none'; afficher('Envoi en cours…');
      try {
        const r = await appel(forcer ? { forcer: true } : {});
        if (r.ok) {
          afficher(`Rappel envoyé à ${r.destinataire}.` + (r.copie_envoyes ? ` Copie dans « ${r.copie_envoyes} ».` : ''), false, true);
          return;
        }
        afficher(r.erreur || 'Erreur.', true);
        if (r.doublon) bForcer.style.display = '';
      } catch (e) { afficher(e.message, true); }
      bEnvoyer.disabled = false;
    }

    function afficher(t, erreur = false, succes = false) {
      msg.textContent = t;
      msg.className = 'msg' + (erreur ? ' err' : succes ? ' ok' : '');
    }

    // Toute modification oblige à refaire l'aperçu avant d'envoyer
    const fenetre = el('div', { class: 'fen', oninput: () => { bEnvoyer.disabled = true; }, onchange: () => { bEnvoyer.disabled = true; } },
      el('div', { class: 'tete' }, el('b', {}, 'RAPPEL DU DÉMÉNAGEMENT'), el('button', { class: 'x', onclick: fermer, title: 'Fermer' }, '✕')),
      el('div', { class: 'corps' },
        el('div', { class: 'col' },
          periode ? el('div', { class: 'note' }, `Dates reprises de l'organisation validée dans Ulyss (${periode.debut.split('-').reverse().join('/')} → ${periode.fin.split('-').reverse().join('/')}).`) : '',
          el('h4', {}, 'Client'),
          el('div', { class: 'ligne l-client' }, el('div', {}, el('label', {}, 'Civilité'), fCiv), el('div', {}, el('label', {}, 'Nom'), fNom)),
          el('label', {}, 'E-mail'), fMail,
          el('label', {}, 'N° de dossier'), fRef,
          el('h4', {}, 'Phase et dates'),
          phases.length > 1 ? [el('label', {}, 'Phase'), fPhase] : '',
          relatif() ? [el('label', {}, 'Date du jour 1 (les jours suivants se calculent seuls)'), fJour1] : '',
          el('div', { class: 'note' }, 'Étapes reprises de la pré-planification (pauses masquées). Le lieu est ce que le client lira.'),
          zoneJours,
          el('datalist', { id: 'types-etape' }, ['Chargement', 'Livraison', 'Emballage', 'Trajet'].map((t) => el('option', { value: t }))),
          el('h4', {}, 'Équipe'),
          el('div', { class: 'note' }, 'Reprise automatique du Planning (jour 1). Prénom seul dans le mail, modifiable. « Lier » va chercher une autre fiche Ulyss et sa photo.'),
          noteEquipe,
          zoneEquipe),
        el('div', { class: 'col' }, el('h4', {}, 'Aperçu'), cadre)),
      el('div', { class: 'pied' }, msg, bForcer, bApercu, bEnvoyer));

    racine.append(el('div', { class: 'voile', onclick: (e) => { if (e.target === e.currentTarget) fermer(); } }, fenetre));
    dessinerJours();
    dessinerEquipe();
    remplirDepuisPlanning();

    /** Équipe reprise du Planning (jour 1), sans écraser ce qui a déjà été saisi à la main. */
    async function remplirDepuisPlanning() {
      const jour1 = (jours[0] && jours[0].date) || (periode && periode.debut) || '';
      const dossierId = (location.pathname.match(CHEMIN) || [])[1];
      if (!jour1) { noteEquipe.textContent = 'Organisation non validée : équipe à saisir.'; return; }
      const phaseVisee = phase;
      let equipe = null;
      try {
        equipe = await equipeDuPlanning(jour1, client.nom, dossierId, phase.id, (t) => { noteEquipe.textContent = t; });
      } catch (e) { equipe = null; }
      if (phase !== phaseVisee || !hote.isConnected) return;
      if (!equipe) { noteEquipe.textContent = 'Aucune personne affectée dans le Planning au jour 1 : équipe à saisir.'; return; }
      if (membres.some((m) => m.prenom.trim() || m.id)) { noteEquipe.textContent = 'Saisie manuelle en cours : équipe du Planning non reprise.'; return; }
      membres = equipe.map((p, i) => ({ prenom: p.court, role: i === 0 ? ROLES[0] : ROLES[1], id: p.id, vignette: '' }));
      dessinerEquipe();
      for (const [i, m] of membres.entries()) {
        noteEquipe.textContent = `Photos de l'équipe (${i + 1}/${membres.length})…`;
        const fiche = {};
        m.vignette = await photoCollaborateur(m.id, fiche);
        if (fiche.prenom) m.prenom = fiche.prenom;
        if (!hote.isConnected) return;
        dessinerEquipe();
      }
      const sansPhoto = membres.filter((m) => !m.vignette).length;
      noteEquipe.textContent = `Équipe reprise du Planning (jour 1, ordre des positions : la 1re est chef d'équipe)` +
        (sansPhoto ? ` — ${sansPhoto} sans photo, silhouette affichée.` : '.');
      bEnvoyer.disabled = true;
    }
  }

  function alerteSimple(texte) {
    const b = document.getElementById(ID_BOUTON);
    if (b) { b.title = texte; b.style.outline = '2px solid #b33'; }
    console.warn('[Rappel déménagement]', texte);
  }

  // ---------------------------------------------------------------------------
  // Insertion du bouton à côté de « Affichage »
  // ---------------------------------------------------------------------------
  function insererBouton() {
    if (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai) return;
    if (!CHEMIN.test(location.pathname)) return;
    if (document.getElementById(ID_BOUTON)) return;
    if (!document.querySelector('[data-events]')) return; // pas sur l'onglet Pré-planification
    const reference = (numeroDossier().match(/^DGT[CD]([A-Z])/) || [])[1];
    if (SOCIETES.indexOf(reference) < 0) return;
    const affichage = [...document.querySelectorAll('a.btn, button')].find((b) => b.textContent.trim().toLowerCase() === 'affichage');
    const bouton = document.createElement('button');
    bouton.id = ID_BOUTON;
    bouton.type = 'button';
    bouton.textContent = LIBELLE;
    bouton.title = 'Envoyer au client le rappel de son déménagement (Extension Ulyss)';
    if (affichage) {
      bouton.className = affichage.className;
      bouton.style.marginLeft = '8px';
      const ancre = affichage.closest('.dropdown') || affichage;   // à côté du menu « Affichage », pas dedans
      ancre.insertAdjacentElement('afterend', bouton);
    } else {
      bouton.style.cssText = 'margin:8px 0;padding:8px 14px;background:#1A2D4B;color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600';
      document.querySelector('[data-events]').insertAdjacentElement('beforebegin', bouton);
    }
    bouton.addEventListener('click', (e) => { e.preventDefault(); ouvrirFenetre(); });
  }

  // Ulyss navigue avec Turbo : on réinsère après chaque changement de page.
  document.addEventListener('turbo:load', insererBouton);
  document.addEventListener('turbo:frame-load', insererBouton);
  new MutationObserver(() => insererBouton()).observe(document.documentElement, { childList: true, subtree: true });
  insererBouton();
})();
