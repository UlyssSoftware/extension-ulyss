/*
 * Extension Ulyss — module « Avis clients » (26/11/2026, demande de Guillaume).
 *  1. Relevé du matin : le premier poste connecté à Ulyss dans la journée fait relever par l'extension les avis Google de
 *     moins de 7 jours des sociétés suivies (Fraisseix seule depuis le 27/11/2026) (onglet Google Maps ouvert puis refermé par l'extension, voir
 *     maps-avis.js et fond.js), puis rapproche chaque nouvel avis d'un dossier d'Ulyss et retrouve l'équipe au Planning.
 *  2. Module : entrée « Avis clients » de la barre latérale. Liste des avis, niveau du rapprochement, et modération :
 *     masquer / réafficher, rattacher à un dossier (l'équipe est relue au Planning), corriger l'équipe.
 * Mémoire commune aux postes : ulyss-software.com/extension-ulyss/avis/ (compartiment déduit de la clé, purge à 30 jours).
 * Ulyss n'est que LU (liste des dossiers, phases, Planning, fiches collaborateur) : aucune écriture dans Ulyss.
 * Règles (Guillaume, 26/11) : un rapprochement « probable » est affiché avec son équipe ; un avis non rapproché est affiché
 * sans équipe ; un avis n'est affiché que 7 jours ; une correction manuelle n'est jamais écrasée par le relevé suivant.
 */
(() => {
  'use strict';
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const ID_RACCOURCI = 'ext-ulyss-raccourci-avis';
  const JOURS_AFFICHES = 7;
  const FENETRE_JOURS = 75;          // le déménagement s'est terminé au plus 75 jours avant l'avis
  // Fiches Google (identifiants relevés sur Google Maps le 26/11/2026). FLS n'est pas suivi.
  // 27/11/2026 (Guillaume) : Fraisseix seulement pour le moment. LDL et Bardon sont prêtes : les remettre dans SUIVIES.
  const SUIVIES = ['F'];
  const TOUTES = [
    { s: 'F', nom: 'Fraisseix Déménagements', couleur: '#1A2D4B', url: 'https://www.google.com/maps/place/Fraisseix+D%C3%A9m%C3%A9nagements/data=!4m2!3m1!1s0x47f9337a6af5a6bf:0xfe734386eca4b58a' },
    { s: 'L', nom: 'Les Déménageurs Limousins', couleur: '#2E7D5B', url: 'https://www.google.com/maps/place/Les+D%C3%A9m%C3%A9nageurs+Limousins/data=!4m2!3m1!1s0x47fecb819b7398b1:0x420bee76346672b7' },
    { s: 'B', nom: 'Bardon Déménagements', couleur: '#B4532A', url: 'https://www.google.com/maps/place/Bardon+D%C3%A9m%C3%A9nagements/data=!4m2!3m1!1s0x47f9358a7a91f44f:0xebc79946619759ca' },
  ];
  const FICHES = TOUTES.filter((f) => SUIVIES.includes(f.s));
  const ETATS_FAITS = /^(réalisé|lv ok|planning ok|clôturé)$/i;
  const NIVEAUX = { certain: 'Certain', probable: 'Probable', manuel: 'Rattaché à la main', non: 'Non trouvé', '': 'À rapprocher' };

  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => {
      try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false, motif: "l'extension ne répond pas (recharger la page)" }); }); }
      catch (e) { ok({ ok: false, motif: "l'extension a été mise à jour : recharger la page" }); }
    });
  }
  async function serveur(donnees, silencieux) {
    const r = await demander({ type: 'gc-rdv', cible: 'avis', donnees: { instance: location.hostname, ...donnees } });
    if (r && !r.ok && r.motif === 'code') {
      if (silencieux || !window.__gcDemanderCode) throw new Error('code');
      await new Promise((ok) => window.__gcDemanderCode(ok));
      return serveur(donnees, true);
    }
    if (!r || !r.ok) throw new Error((r && r.motif) || 'pas de réponse');
    if (!r.corps || !r.corps.ok) throw new Error((r.corps && r.corps.erreur) || 'réponse illisible du serveur (code ' + r.statut + ') : le dossier « avis » est-il déposé ?');
    return r.corps;
  }
  function idPoste() {
    try { let p = localStorage.getItem('ext-ulyss-poste'); if (!p) { p = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('ext-ulyss-poste', p); } return p; } catch (e) { return ''; }
  }
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const plus = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return iso(x); };
  const fr = (d) => (d ? d.split('-').reverse().join('/') : '');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const page = (url) => fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : '')).then((h) => new DOMParser().parseFromString(h, 'text/html'));

  // ---------------------------------------------------------------------------
  // Lecture d'Ulyss (relevés production 25 et 26/11/2026)
  // ---------------------------------------------------------------------------
  /** Liste des dossiers pour un mot : [{id, ref, s, client, etat}] (colonnes : Ste, Numéro, Nom du client, …, État). */
  async function chercherDossiers(mot) {
    const doc = await page('/contracts/filter?filter_contract%5Bsearch%5D=' + encodeURIComponent(mot));
    return [...doc.querySelectorAll('tbody tr')].map((tr) => {
      const ref = (tr.textContent.match(/DGT[CD][A-Z]\d{4}-\d{3}(?:_\d+)?/) || [''])[0];
      const lien = [...tr.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '').find((h) => /^\/contracts\/\d+$/.test(h));
      const c = tr.cells;
      return { id: lien ? lien.split('/').pop() : '', ref, s: (ref.match(/^DGT[CD]([A-Z])/) || [])[1] || '', client: c[2] ? c[2].textContent.replace(/\s+/g, ' ').trim() : '', etat: c[9] ? c[9].textContent.replace(/\s+/g, ' ').trim() : '' };
    }).filter((d) => d.id && d.ref);
  }
  const MOIS_ULYSS = { janv: 1, jan: 1, févr: 2, fevr: 2, fév: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dec: 12 };
  function dateUlyss(s) {
    const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{4})$/);
    const mois = m && MOIS_ULYSS[m[2]];
    return mois ? `${m[3]}-${String(mois).padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }
  /** Dates réelles du chantier : en-tête de la phase (« 08 Oct. 2026 - 09 Oct. 2026 »), présent quand l'organisation est validée. */
  async function datesDuDossier(id) {
    const doc = await page(`/contracts/${id}/phases`);
    const titre = doc.getElementById('phase-title');
    const bloc = titre && titre.parentElement ? titre.parentElement.querySelector('.ml-2') : null;
    const m = bloc ? bloc.textContent.replace(/\s+/g, ' ').match(/(\d{1,2} [^\d-]+? \d{4})\s*-\s*(\d{1,2} [^\d-]+? \d{4})/) : null;
    const debut = m ? dateUlyss(m[1]) : '', fin = m ? dateUlyss(m[2]) : '';
    return debut && fin ? { debut, fin } : null;
  }
  /** Équipe du jour 1 au Planning (même méthode que le rappel du déménagement) : [{id, prenom}] ; prénom lu sur la fiche. */
  async function equipeDuDossier(dossier, jour1) {
    const nom = norm((dossier.client.split(' ').filter((m) => m === m.toUpperCase() && /[A-ZÀ-Ý]/.test(m)).join(' ')) || dossier.client);
    if (!jour1 || !nom) return [];
    const doc = await page(`/exploitation_requirements/affectation?date=${jour1}&structures%5B%5D=1&structures%5B%5D=2&structures%5B%5D=3&view=compact`);
    const cartes = [...doc.querySelectorAll('[id^="card_exploitation_requirement"]')]
      .filter((c) => norm((c.querySelector('.text-bold') || {}).textContent).startsWith(nom.split(' ')[0]))
      .map((c) => c.id.replace(/\D/g, '')).slice(0, 4);
    const equipe = [];
    for (const er of cartes) {
      const h = await fetch(`/exploitation_requirements/${er}/edit`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''));
      if (!h.includes(`contracts/${dossier.id}/`)) continue;
      const d = new DOMParser().parseFromString(h, 'text/html');
      const form = d.querySelector('form[action*="simple_collaborator_affectation"]') || d;
      for (const sel of form.querySelectorAll('select[name*="[collaborator_id]"]')) {
        const o = sel.selectedOptions[0];
        if (o && o.value && !equipe.some((m) => m.id === o.value)) equipe.push({ id: o.value, prenom: o.textContent.trim() });
      }
    }
    for (const m of equipe) {
      try {
        const f = await page(`/collaborators/${m.id}`);
        const t = ((f.querySelector('h1') || {}).textContent || '').replace(/\s+/g, ' ').replace(/^.*?-\s*/, '').trim();
        const p = t.split(' ').filter((x) => x !== x.toUpperCase()).join(' ');
        if (p) m.prenom = p;
      } catch (e) { /* nom court du Planning gardé */ }
    }
    return equipe;
  }
  async function chercherCollaborateur(texte) {
    const doc = await page(`/collaborators/filter?scope=default&filter_collaborator%5Bsearch%5D=${encodeURIComponent(texte)}&filter_collaborator%5Bactive_status%5D=active`);
    for (const tr of doc.querySelectorAll('tbody tr')) {
      const a = [...tr.querySelectorAll('a')].find((x) => /^\/collaborators\/\d+$/.test(x.getAttribute('href') || ''));
      if (!a) continue;
      const nomComplet = a.textContent.trim().replace(/\s+/g, ' ');
      return { id: a.getAttribute('href').split('/').pop(), prenom: nomComplet.split(' ').filter((m) => m !== m.toUpperCase()).join(' ') || nomComplet.split(' ')[0] };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Rapprochement d'un avis avec un dossier
  // ---------------------------------------------------------------------------
  /**
   * Nom de l'auteur → dossiers de la même société, réalisés (ou planifiés), terminés dans les 75 jours avant l'avis.
   * « certain » : un seul dossier, prénom et nom communs ; « probable » : le nom de famille seul, ou plusieurs dossiers
   * possibles (on garde le plus récent) ; « non » sinon. Jamais de correspondance forcée.
   */
  async function rapprocher(a) {
    const mots = norm(a.auteur).split(' ').filter((m) => m.length >= 3).slice(0, 3);
    if (!mots.length) return { niveau: 'non' };
    const vus = new Map();
    for (const m of mots) for (const d of await chercherDossiers(m)) vus.set(d.id, d);
    const candidats = [];
    for (const d of vus.values()) {
      if (d.s !== a.s || !ETATS_FAITS.test(d.etat)) continue;
      const client = norm(d.client).split(' ');
      const famille = d.client.split(' ').filter((m) => m === m.toUpperCase() && /[A-ZÀ-Ý]/.test(m)).map(norm);
      const communs = mots.filter((m) => client.includes(m)).length;
      const fort = communs >= 2, faible = famille.some((f) => mots.includes(f));
      if (fort || faible) candidats.push({ ...d, fort });
    }
    candidats.sort((x, y) => (y.fort - x.fort) || y.ref.localeCompare(x.ref));
    const retenus = [];
    for (const d of candidats.slice(0, 6)) {
      const dates = await datesDuDossier(d.id).catch(() => null);
      if (!dates || dates.fin > a.date || dates.fin < plus(a.date, -FENETRE_JOURS)) continue;
      retenus.push({ ...d, dates });
    }
    if (!retenus.length) return { niveau: 'non' };
    retenus.sort((x, y) => (y.fort - x.fort) || y.dates.fin.localeCompare(x.dates.fin));
    const choix = retenus[0];
    const equipe = await equipeDuDossier(choix, choix.dates.debut).catch(() => []);
    return { niveau: choix.fort && retenus.length === 1 ? 'certain' : 'probable', dossier: { id: choix.id, ref: choix.ref }, dem: choix.dates.fin, equipe };
  }
  /** Rattachement demandé par une personne : numéro de dossier → dossier, dates, équipe. */
  async function rattacher(ref) {
    const n = String(ref || '').trim().toUpperCase();
    if (!/^DGT[CD][A-Z]\d{4}-\d{3}(?:_\d+)?$/.test(n)) throw new Error('Numéro de dossier attendu, par exemple DGTDF2611-087.');
    const d = (await chercherDossiers(n)).find((x) => x.ref === n);
    if (!d) throw new Error('Dossier ' + n + ' introuvable dans Ulyss.');
    const dates = await datesDuDossier(d.id).catch(() => null);
    const equipe = dates ? await equipeDuDossier(d, dates.debut).catch(() => []) : [];
    return { dossier: { id: d.id, ref: d.ref }, dem: dates ? dates.fin : '', equipe, sansDates: !dates };
  }

  // ---------------------------------------------------------------------------
  // Relevé (matin, ou bouton du module)
  // ---------------------------------------------------------------------------
  const CLE_MEMO = 'ext-ulyss-avis-releve';
  const memo = (v) => { try { if (v) localStorage.setItem(CLE_MEMO, JSON.stringify(v)); return JSON.parse(localStorage.getItem(CLE_MEMO) || '{}'); } catch (e) { return {}; } };
  let releveEnCours = null;
  /** suivre(texte) reçoit l'avancement. Renvoie l'état du serveur après le relevé, ou null si un autre poste s'en charge. */
  function relever(forcer, suivre) {
    if (releveEnCours) return releveEnCours;
    suivre = suivre || (() => {});
    releveEnCours = (async () => {
      const poste = idPoste();
      let etat = await serveur({ action: 'reserver', poste, forcer: !!forcer }, !forcer);
      if (!etat.accorde) return etat.releve && etat.releve.fait && !forcer ? etat : null;
      suivre('Lecture des avis sur Google…');
      const lu = await demander({ type: 'gc-avis-releve', fiches: FICHES.map((f) => ({ s: f.s, url: f.url })) });
      if (!lu || !lu.ok) throw new Error((lu && lu.motif) || 'relevé Google impossible (extension à mettre à jour ?)');
      const fiches = {}, avis = [];
      for (const r of lu.fiches || []) {
        fiches[r.s] = { ok: !!r.ok, motif: r.motif || '', nb: r.nb || 0 };
        for (const a of r.avis || []) avis.push({ s: r.s, auteur: a.auteur, note: a.note, texte: a.texte, jours: a.jours });
      }
      etat = await serveur({ action: 'relever', poste, fiches, avis }, true);
      const aFaire = Object.entries(etat.avis || {}).filter(([, a]) => !a.niveau && !a.manuel);
      for (const [i, [id, a]] of aFaire.entries()) {
        suivre(`Rapprochement avec les dossiers (${i + 1}/${aFaire.length})…`);
        const r = await rapprocher(a).catch(() => null);
        if (r) etat = await serveur({ action: 'rapprocher', poste, id, ...r }, true);   // lecture d'Ulyss en échec : on réessaiera au prochain relevé
      }
      // Tout n'est « fait » pour la journée que si les trois fiches ont été lues.
      if (FICHES.every((f) => fiches[f.s] && fiches[f.s].ok)) etat = await serveur({ action: 'terminer', poste }, true);
      return etat;
    })().finally(() => { releveEnCours = null; });
    return releveEnCours;
  }
  async function releveDuMatin() {
    if (window.__extUlyssActif && !window.__extUlyssActif('avis')) return;
    if (window.top !== window || (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai)) return;
    if (!document.getElementById('global-sidebar')) return;                     // pas connecté à Ulyss
    const auj = iso(new Date()), m = memo();
    if (m.jour === auj && (m.fait || m.attendre > Date.now())) return;
    try {
      const etat = await relever(false);
      // null : un autre poste relève, ou le relevé automatique n'est pas encore amorcé (premier relevé à faire depuis le module)
      memo(etat && etat.releve && etat.releve.fait ? { jour: auj, fait: true } : { jour: auj, attendre: Date.now() + 30 * 60000 });
    } catch (e) {
      memo({ jour: auj, attendre: Date.now() + 10 * 60000, erreur: String((e && e.message) || e).slice(0, 160) });
    }
  }

  // ---------------------------------------------------------------------------
  // Module
  // ---------------------------------------------------------------------------
  const CSS = `
    :host{all:initial}
    .voile{position:fixed;inset:0;background:rgba(15,23,42,.38);backdrop-filter:blur(2px);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 12px;font-family:Inter,'Segoe UI',system-ui,-apple-system,Arial,sans-serif}
    .fen{background:#fff;width:min(1040px,100%);border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.28);color:#1f2a44;font-size:13px;overflow:hidden}
    .tete{padding:20px 26px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
    .tete b{font-size:19px;font-weight:650;letter-spacing:-.2px;display:block} .tete small{display:block;color:#6b7689;font-size:12.5px;margin-top:3px}
    .x{background:#f1f3f7;border:0;border-radius:10px;width:32px;height:32px;color:#4a5568;font-size:15px;cursor:pointer}
    .barre{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:0 26px 14px;color:#6b7689;font-size:12px}
    .fiche{display:inline-flex;align-items:center;gap:6px;background:#f5f7fa;border-radius:999px;padding:4px 10px}
    .pt{width:8px;height:8px;border-radius:50%;background:#c3cad6} .pt.ok{background:#39a56b} .pt.ko{background:#d9534f}
    .btn{border:0;border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer;font-size:12.5px;background:#1f2a44;color:#fff} .btn:disabled{opacity:.5;cursor:default}
    .lien{background:none;border:0;color:#2d6f8a;cursor:pointer;font-size:12px;padding:0;text-decoration:underline}
    .msg{flex:1;min-width:200px} .err{color:#c0392b}
    .liste{padding:0 26px 24px;max-height:70vh;overflow:auto}
    .vide{padding:40px 0;text-align:center;color:#8a94a6}
    .avis{border:1px solid #e6e9ef;border-radius:14px;padding:14px 16px;margin-bottom:12px;display:grid;grid-template-columns:1fr 330px;gap:18px}
    .avis.masque{opacity:.55;background:#fafbfc} .avis.vieux{background:#fafbfc}
    .l1{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
    .soc{color:#fff;border-radius:7px;padding:2px 8px;font-weight:650;font-size:11.5px}
    .et{color:#e0a62a;letter-spacing:1px;font-size:14px} .et i{color:#d5dae3;font-style:normal}
    .aut{font-weight:650} .date{color:#8a94a6;font-size:12px}
    .txt{margin:8px 0 0;color:#3d4759;line-height:1.5}
    .pastille{border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;background:#eef1f5;color:#566074}
    .pastille.certain{background:#e3f4ea;color:#23774a} .pastille.probable{background:#fdf2d6;color:#8a6410} .pastille.manuel{background:#e4eefb;color:#2a5a9c} .pastille.non{background:#fbe6e4;color:#a3362c} .pastille.hors{background:#eef1f5;color:#8a94a6}
    .cote{font-size:12px;color:#566074} .cote a{color:#2d6f8a;font-weight:600}
    .puces{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
    .puce{background:#f1f3f7;border-radius:999px;padding:3px 4px 3px 10px;display:inline-flex;align-items:center;gap:4px}
    .puce button{background:none;border:0;color:#8a94a6;cursor:pointer;font-size:12px;padding:0 4px}
    .rang{display:flex;gap:6px;margin-top:6px} .rang input{flex:1;min-width:0;border:1px solid #d5dae3;border-radius:8px;padding:6px 8px;font-size:12px;color:#1f2a44}
    .mini{border:1px solid #d5dae3;background:#fff;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;color:#1f2a44;white-space:nowrap} .mini:disabled{opacity:.5}
    .info{font-size:11.5px;color:#8a94a6;margin-top:6px;min-height:14px} .info.err{color:#c0392b}
    @media(max-width:900px){.avis{grid-template-columns:1fr}}
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

  let ouvert = null;
  function ouvrir() {
    if (ouvert && ouvert.isConnected) return;
    const hote = el('div'); ouvert = hote;
    document.body.append(hote);
    const racine = hote.attachShadow({ mode: 'open' });
    racine.append(el('style', {}, CSS));
    const fermer = () => hote.remove();
    let etat = null, tout = false;
    const zoneFiches = el('span', {}), msg = el('span', { class: 'msg' }), liste = el('div', { class: 'liste' });
    const bRelever = el('button', { class: 'btn', onclick: async () => {
      bRelever.disabled = true; dire('Relevé en cours…');
      try {
        const r = await relever(true, dire);
        if (!r) dire('Un autre poste est en train de relever les avis : réessayer dans quelques minutes.');
        else { etat = r; dire(''); dessiner(); }
      } catch (e) { dire(e.message, true); }
      bRelever.disabled = false;
    } }, 'Relever maintenant');
    const bTout = el('button', { class: 'lien', onclick: () => { tout = !tout; dessiner(); } }, '');
    const bDepot = el('button', { class: 'mini', title: 'La bande verticale prévue pour l\'écran du dépôt, avec les avis et les équipes du moment', onclick: () => { if (etat) apercuDepot(etat); } }, 'Aperçu écran dépôt');
    function dire(t, erreur) { msg.textContent = t || ''; msg.className = 'msg' + (erreur ? ' err' : ''); }

    function dessiner() {
      const fiches = (etat.releve && etat.releve.fiches) || {};
      zoneFiches.replaceChildren(...FICHES.map((f) => {
        const e = fiches[f.s];
        return el('span', { class: 'fiche', title: e ? (e.ok ? 'Lu le ' + new Date(e.quand * 1000).toLocaleString('fr-FR') : 'Échec : ' + e.motif) : 'Jamais relevé' }, el('span', { class: 'pt' + (e ? (e.ok ? ' ok' : ' ko') : '') }), f.nom);
      }));
      const limite = plus(etat.aujourdhui, -(JOURS_AFFICHES - 1));
      const lignes = Object.entries(etat.avis || {}).filter(([, a]) => SUIVIES.includes(a.s));
      const recents = lignes.filter(([, a]) => a.date >= limite), anciens = lignes.length - recents.length;
      bTout.textContent = anciens ? (tout ? 'Masquer les avis de plus de 7 jours' : `Voir aussi les ${anciens} avis de plus de 7 jours (sortis de l'affichage)`) : '';
      const montres = tout ? lignes : recents;
      liste.replaceChildren(...(montres.length ? montres.map(([id, a]) => carte(id, a, a.date < limite)) : [el('div', { class: 'vide' }, lignes.length ? 'Aucun avis de moins de 7 jours : la bande du dépôt est vide.' : 'Aucun avis relevé pour le moment.')]));
    }

    function carte(id, a, vieux) {
      const f = FICHES.find((x) => x.s === a.s) || { nom: a.s, couleur: '#566074' };
      const info = el('div', { class: 'info' });
      const noter = (t, erreur) => { info.textContent = t || ''; info.className = 'info' + (erreur ? ' err' : ''); };
      const envoyer = async (donnees, texte) => {
        noter(texte || 'Enregistrement…');
        try { etat = await serveur({ action: 'moderer', id, ...donnees }); dessiner(); }
        catch (e) { noter(e.message, true); }
      };
      const fRef = el('input', { placeholder: 'N° de dossier (DGTDF2611-087)', value: '' });
      const bRef = el('button', { class: 'mini', onclick: async () => {
        bRef.disabled = true; noter('Lecture du dossier et du Planning…');
        try {
          const r = await rattacher(fRef.value);
          await envoyer({ dossier: r.dossier, dem: r.dem, equipe: r.equipe }, 'Enregistrement…');
        } catch (e) { noter(e.message, true); bRef.disabled = false; }
      } }, 'Rattacher');
      const fNom = el('input', { placeholder: 'Ajouter une personne (nom dans Ulyss)' });
      const bNom = el('button', { class: 'mini', onclick: async () => {
        if (!fNom.value.trim()) return;
        bNom.disabled = true; noter('Recherche…');
        const c = await chercherCollaborateur(fNom.value.trim()).catch(() => null);
        if (!c) { noter('Personne introuvable dans les collaborateurs actifs.', true); bNom.disabled = false; return; }
        if ((a.equipe || []).some((m) => m.id === c.id)) { noter('Déjà dans l\'équipe.'); bNom.disabled = false; return; }
        envoyer({ equipe: [...(a.equipe || []), c] });
      } }, 'Ajouter');
      const etoiles = el('span', { class: 'et' }, '★'.repeat(a.note), el('i', {}, '★'.repeat(5 - a.note)));
      return el('div', { class: 'avis' + (a.masque ? ' masque' : '') + (vieux ? ' vieux' : '') },
        el('div', {},
          el('div', { class: 'l1' }, el('span', { class: 'soc', style: 'background:' + f.couleur }, f.nom), etoiles, el('span', { class: 'aut' }, a.auteur), el('span', { class: 'date' }, 'avis du ' + fr(a.date)),
            vieux ? el('span', { class: 'pastille hors' }, 'Plus de 7 jours') : (a.masque ? el('span', { class: 'pastille hors' }, 'Retiré de l\'affichage') : '')),
          el('p', { class: 'txt' }, a.texte || '(note sans commentaire)')),
        el('div', { class: 'cote' },
          el('div', { class: 'l1' }, el('span', { class: 'pastille ' + (a.niveau || '') }, NIVEAUX[a.niveau || '']),
            a.dossier ? el('a', { href: '/contracts/' + a.dossier.id, target: '_blank' }, a.dossier.ref) : '',
            a.dem ? el('span', {}, 'déménagement du ' + fr(a.dem)) : ''),
          el('div', { class: 'puces' }, (a.equipe || []).length
            ? a.equipe.map((m, i) => el('span', { class: 'puce' }, m.prenom, el('button', { title: 'Retirer de l\'équipe', onclick: () => envoyer({ equipe: a.equipe.filter((_, j) => j !== i) }) }, '✕')))
            : el('span', {}, a.dossier ? 'Aucune personne trouvée au Planning.' : 'Sans équipe : affiché sans photos.')),
          el('div', { class: 'rang' }, fRef, bRef),
          el('div', { class: 'rang' }, fNom, bNom),
          el('div', { class: 'rang' }, el('button', { class: 'mini', onclick: () => envoyer({ masque: !a.masque }) }, a.masque ? 'Remettre à l\'affichage' : 'Retirer de l\'affichage')),
          info));
    }

    racine.append(el('div', { class: 'voile', onclick: (e) => { if (e.target === e.currentTarget) fermer(); } },
      el('div', { class: 'fen' },
        el('div', { class: 'tete' }, el('div', {}, el('b', {}, 'Avis clients'), el('small', {}, 'Avis Google de la semaine, rapprochés des dossiers et des équipes. Un avis reste affiché 7 jours.')), el('button', { class: 'x', title: 'Fermer', onclick: fermer }, '✕')),
        el('div', { class: 'barre' }, zoneFiches, msg, bTout, bDepot, bRelever),
        liste)));
    liste.append(el('div', { class: 'vide' }, 'Chargement…'));
    serveur({ action: 'lire', poste: idPoste() }).then((r) => { etat = r; dessiner(); if (r.releve && r.releve.en_cours && !r.releve.a_moi) dire('Un poste relève les avis en ce moment.'); })
      .catch((e) => { liste.replaceChildren(el('div', { class: 'vide err' }, 'Avis indisponibles : ' + e.message)); });
  }

  // ---------------------------------------------------------------------------
  // Aperçu de l'écran du dépôt (27/11/2026) : la bande verticale 480 × 1080 (un quart d'écran), rendue avec les avis
  // affichables du moment — moins de 7 jours, non retirés, 6 au plus — et les photos des fiches collaborateur d'Ulyss.
  // Règles de Guillaume (26/11) : titre neutre, avis négatifs comme les autres, « probable » avec son équipe, avis non
  // rapproché sans équipe, bande vide s'il n'y a pas d'avis récent. Rien n'est enregistré : c'est un aperçu.
  // ---------------------------------------------------------------------------
  const SILHOUETTE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#24395C"/><circle cx="40" cy="31" r="14" fill="#7C8BA6"/><path d="M12 80c2-18 14-27 28-27s26 9 28 27z" fill="#7C8BA6"/></svg>');
  const photos = new Map();   // id de fiche → adresse de la photo (gardée le temps de la page)
  async function photoFiche(id) {
    if (!id) return '';
    if (photos.has(id)) return photos.get(id);
    let src = '';
    try {
      const doc = await page(`/collaborators/${id}`);
      const img = [...doc.querySelectorAll('img')].find((i) => /active_storage/.test(i.getAttribute('src') || '') && !/logotype|logo/i.test(decodeURIComponent(i.getAttribute('src'))));
      src = img ? img.getAttribute('src') : '';
    } catch (e) { src = ''; }
    photos.set(id, src);
    return src;
  }
  const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  /** « Sandrine Pantaleao » → « Sandrine P. » ; le nom complet de l'auteur n'est pas affiché au dépôt. */
  function nomCourt(auteur) {
    const m = String(auteur || '').trim().split(/\s+/).filter(Boolean);
    if (!m.length) return 'Client';
    if (m[0].length <= 2) return m.map((x) => x.charAt(0).toUpperCase() + '.').join(' ');
    return m[0] + (m.length > 1 ? ' ' + m[m.length - 1].charAt(0).toUpperCase() + '.' : '');
  }
  const CSS_DEPOT = `
    :host{all:initial}
    .voile{position:fixed;inset:0;background:rgba(10,16,30,.82);z-index:2147483002;display:flex;align-items:center;justify-content:center;font-family:Montserrat,'Segoe UI',Arial,sans-serif}
    .cadre{position:relative}
    .bande{width:480px;height:1080px;box-sizing:border-box;display:flex;flex-direction:column;background:#FAF7EE;color:#1A2D4B;transform-origin:top left;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden}
    header{background:#1A2D4B;padding:14px 22px 13px;border-bottom:3px solid #CAAE47}
    header small{display:block;font-size:11px;font-weight:600;letter-spacing:3px;color:#CAAE47}
    header b{display:block;font-family:'Cormorant Garamond','Cormorant Infant',Georgia,serif;font-size:27px;line-height:30px;font-weight:600;color:#fff;margin-top:2px}
    article{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;border-top:1px solid #E4DDC8}
    .haut{display:flex;align-items:center;justify-content:space-between}
    .logo{background:#1A2D4B;color:#CAAE47;font-family:'Cormorant Garamond','Cormorant Infant',Georgia,serif;letter-spacing:3px;border-radius:3px;border-bottom:2px solid #CAAE47;text-align:center}
    .logo i{display:block;font-style:normal;font-family:Montserrat,'Segoe UI',Arial,sans-serif;color:#fff;font-weight:400;letter-spacing:2px}
    .droite{display:flex;flex-direction:column;align-items:flex-end}
    .et{color:#B8901C} .et i{color:#DDD6C2;font-style:normal}
    .qui{color:#4A5568} .qui strong{color:#1A2D4B}
    p{margin:0;font-family:'Cormorant Garamond','Cormorant Infant',Georgia,serif;font-weight:500;color:#1A2D4B;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
    .equipe{display:flex} .m{display:flex;flex-direction:column;align-items:center} .m img{border-radius:50%;object-fit:cover;border-style:solid;border-color:#CAAE47;background:#24395C} .m span{font-weight:600}
    .sans{align-self:flex-start;border:1px dashed #CAAE47;border-radius:8px;color:#4A5568} .sans strong{color:#1A2D4B}
    .vide{flex:1}
    /* jusqu'à 3 avis : grand ; 4 à 6 : compact (6 avis tiennent dans la hauteur) */
    .grand article{padding:18px 24px;gap:14px} .grand .logo{font-size:19px;padding:6px 12px 5px} .grand .logo i{font-size:7px}
    .grand .et{font-size:23px;line-height:24px;letter-spacing:3px} .grand .qui{font-size:13.5px;line-height:17px} .grand .droite{gap:3px}
    .grand p{font-size:23px;line-height:28px;-webkit-line-clamp:5} .grand .equipe{gap:6px} .grand .m{width:92px;gap:6px} .grand .m img{width:66px;height:66px;border-width:3px} .grand .m span{font-size:15px;line-height:18px}
    .grand .sans{padding:9px 14px;font-size:13px;line-height:18px}
    .compact article{padding:8px 22px;gap:5px} .compact .logo{font-size:14px;padding:4px 9px 3px} .compact .logo i{font-size:5.5px}
    .compact .et{font-size:17px;line-height:18px;letter-spacing:2px} .compact .qui{font-size:11.5px;line-height:14px} .compact .droite{gap:2px}
    .compact p{font-size:17px;line-height:20px;-webkit-line-clamp:2} .compact .equipe{gap:4px} .compact .m{width:62px;gap:3px} .compact .m img{width:38px;height:38px;border-width:2px} .compact .m span{font-size:11px;line-height:13px}
    .compact .sans{padding:5px 10px;font-size:10.5px;line-height:14px}
    .fermer{position:fixed;top:18px;right:22px;background:#fff;border:0;border-radius:10px;padding:9px 14px;font-weight:600;font-size:13px;cursor:pointer;color:#1A2D4B;font-family:inherit}
    .legende{position:fixed;left:22px;bottom:18px;color:#C9D0DC;font-size:12px;max-width:340px;line-height:17px}
  `;
  function apercuDepot(etat) {
    try {   // polices de la charte ; si Ulyss les refuse, Georgia prend le relais
      if (!document.getElementById('ext-ulyss-polices-avis')) { const l = document.createElement('link'); l.id = 'ext-ulyss-polices-avis'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Montserrat:wght@400;500;600&display=swap'; document.head.append(l); }
    } catch (e) {}
    const hote = el('div');
    document.body.append(hote);
    const racine = hote.attachShadow({ mode: 'open' });
    racine.append(el('style', {}, CSS_DEPOT));
    const limite = plus(etat.aujourdhui, -(JOURS_AFFICHES - 1));
    const montres = Object.values(etat.avis || {}).filter((a) => SUIVIES.includes(a.s) && !a.masque && a.date >= limite).slice(0, 6);
    const bande = el('div', { class: 'bande ' + (montres.length <= 3 ? 'grand' : 'compact') },
      el('header', {}, el('small', {}, 'AVIS CLIENTS GOOGLE'), el('b', {}, 'Les avis de la semaine')));
    const images = [];
    montres.forEach((a) => {
      const f = TOUTES.find((x) => x.s === a.s) || { nom: a.s };
      const mots = f.nom.replace(/\s*Déménagements?\s*/i, '').trim().toUpperCase() || f.nom.toUpperCase();
      const d = a.dem ? new Date(a.dem + 'T12:00:00') : null;
      const equipe = a.equipe || [];
      bande.append(el('article', {},
        el('div', { class: 'haut' },
          el('div', { class: 'logo', title: f.nom }, el('i', {}, 'DÉMÉNAGEMENTS'), mots),
          el('div', { class: 'droite' },
            el('div', { class: 'et' }, '★'.repeat(a.note), el('i', {}, '★'.repeat(5 - a.note))),
            el('div', { class: 'qui' }, el('strong', {}, nomCourt(a.auteur)), d ? ` · déménagement du ${d.getDate()} ${MOIS_COURTS[d.getMonth()]}` : ''))),
        a.texte ? el('p', {}, '« ' + a.texte + ' »') : '',
        equipe.length
          ? el('div', { class: 'equipe' }, equipe.slice(0, 5).map((m) => { const img = el('img', { alt: '', src: SILHOUETTE }); images.push([img, m.id]); return el('div', { class: 'm' }, img, el('span', {}, m.prenom)); }))
          : el('div', { class: 'sans' }, 'Équipe non identifiée.', el('br'), el('strong', {}, 'Vous reconnaissez ce déménagement ? Dites-le au bureau.'))));
    });
    if (!montres.length) bande.append(el('div', { class: 'vide' }));
    const cadre = el('div', { class: 'cadre' }, bande);
    const ajuster = () => { const k = Math.min(1, (window.innerHeight - 40) / 1080); bande.style.transform = `scale(${k})`; cadre.style.width = 480 * k + 'px'; cadre.style.height = 1080 * k + 'px'; };
    const fermer = () => { window.removeEventListener('resize', ajuster); hote.remove(); };
    const legende = el('div', { class: 'legende' }, montres.length ? `${montres.length} avis affiché${montres.length > 1 ? 's' : ''} sur la bande (480 × 1080, un quart d'écran). Photos : fiches collaborateur d'Ulyss.` : 'Aucun avis de moins de 7 jours : la bande reste vide.');
    racine.append(el('div', { class: 'voile', onclick: (e) => { if (e.target === e.currentTarget) fermer(); } }, cadre, legende, el('button', { class: 'fermer', onclick: fermer }, 'Fermer ✕')));
    ajuster(); window.addEventListener('resize', ajuster);
    // photos lues une à une, après l'affichage
    (async () => { for (const [img, id] of images) { if (!hote.isConnected) return; const src = await photoFiche(id); if (src) img.src = src; } })();
  }

  /** Entrée de la barre latérale, bâtie comme les modules d'Ulyss, sous « Taux de charge » (ou sous le premier module). */
  function insererRaccourci() {
    if (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai) return;
    if (document.getElementById(ID_RACCOURCI)) return;
    const zone = document.querySelector('#global-sidebar .discret-scroll') || document.getElementById('global-sidebar');
    const liens = zone ? [...zone.querySelectorAll(':scope > a.sidebar-link')] : [];
    if (!liens.length) return;
    const r = document.createElement('a');
    r.id = ID_RACCOURCI; r.href = '#'; r.className = 'sidebar-link';
    r.title = 'Avis clients : avis Google de la semaine et équipes (Extension Ulyss)';
    r.innerHTML = '<div class="text-3xl mr-3.75"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" style="display:block;margin:3px 0"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg></div><div class="reductible">Avis clients</div>';
    r.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ouvrir(); });
    (document.getElementById('ext-ulyss-raccourci-charge') || liens[0]).insertAdjacentElement('afterend', r);
  }
  if (window.__extUlyssAvisEssai) Object.assign(window.__extUlyssAvisEssai, { rapprocher, rattacher, chercherDossiers, datesDuDossier, relever });
  const poser = () => { if (window.__extUlyssActif && !window.__extUlyssActif('avis')) return; insererRaccourci(); };
  document.addEventListener('turbo:load', poser);
  new MutationObserver(poser).observe(document.documentElement, { childList: true, subtree: true });
  poser();
  setTimeout(releveDuMatin, 20000);   // après le préchargement du taux de charge, sans gêner l'ouverture de la page
})();
