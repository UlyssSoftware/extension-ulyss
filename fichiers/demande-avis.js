/*
 * Extension Ulyss — bouton « Demander un avis » (26/11/2026, demande de Guillaume ; modèle de mail fourni par lui).
 * 28/11/2026 (Guillaume) : le bouton quitte l'écran Pré-planification pour l'écran DEVIS du dossier (/contracts/<id>/proposals),
 * à la suite de « Télécharger » et « Envoyer ». Il n'apparaît que si le déménagement est terminé : état « Réalisé » ou
 * « Clôturé », ou bien « LV Ok » / « Planning Ok » une fois le dernier jour passé. Sociétés dont le modèle existe (Fraisseix).
 * L'état est lu sur le badge d'état de l'en-tête (.badge.embed / contract-…) et lui seul : les jalons de l'en-tête sont aussi
 * des .badge, et « Clôturé » y figure toujours (défaut de la 1.8.22 : le bouton s'affichait sur tous les dossiers Fraisseix).
 * Reprend le fonctionnement du rappel du déménagement (rappel.js) : client lu dans sa fiche, dates lues dans l'en-tête de
 * la phase, équipe et photos lues au Planning (jour 1), aperçu obligatoire avant l'envoi, envoi par le serveur
 * ulyss-software.com/extension-ulyss/demande-avis/avis.php (message gc-rdv, cible « demande-avis »). Ulyss n'est que lu.
 */
(() => {
  'use strict';
  const ID_BOUTON = 'limodem-bouton-avis';
  const ROLES = ["Chef d'équipe", 'Déménageur', 'Conducteur'];
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const CHEMIN = /^\/contracts\/(\d+)\/proposals\/?$/;   // écran Devis du dossier
  const SOCIETES = ['F'];   // ajouter B, L quand leur modèle de demande d'avis existera
  const CIVILITES = { male: 'Monsieur', female: 'Madame', both: 'Madame et Monsieur', other: '' };
  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => {
      try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false, motif: "l'extension ne répond pas (recharger la page)" }); }); }
      catch (e) { ok({ ok: false, motif: "l'extension a été mise à jour : recharger la page" }); }
    });
  }
  const aujourdhui = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const MOIS_ULYSS = { janv: 1, jan: 1, févr: 2, fevr: 2, fév: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dec: 12 };
  function dateUlyss(s) {
    const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{4})$/);
    const mois = m && MOIS_ULYSS[m[2]];
    return mois ? `${m[3]}-${String(mois).padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }
  /** Dates de la phase du dossier, lues sur sa page Pré-planification (une lecture par dossier, gardée le temps de la page). */
  const datesLues = new Map();
  function datesDuDossier(id) {
    if (!datesLues.has(id)) {
      datesLues.set(id, fetch(`/contracts/${id}/phases`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''))
        .then((h) => datesDePhase(new DOMParser().parseFromString(h, 'text/html'))).catch(() => null));
    }
    return datesLues.get(id);
  }
  function datesDePhase(doc) {
    const titre = (doc || document).getElementById('phase-title');
    const bloc = titre && titre.parentElement ? titre.parentElement.querySelector('.ml-2') : null;
    const m = bloc ? bloc.textContent.replace(/\s+/g, ' ').match(/(\d{1,2} [^\d-]+? \d{4})\s*-\s*(\d{1,2} [^\d-]+? \d{4})/) : null;
    if (!m) return null;
    const debut = dateUlyss(m[1]), fin = dateUlyss(m[2]);
    return debut && fin ? { debut, fin } : null;
  }
  function numeroDossier() {
    const zones = [document.querySelector('#contract_header_banner #subtitle'), document.querySelector('#contract_header_banner'), document.querySelector('h2#subtitle'), document.querySelector('main') || document.body];
    for (const z of zones) {
      const m = z && z.textContent.match(/DGT[CD][A-Z]\d{4}-\d{3}(?:_\d+)?/);
      if (m) return m[0];
    }
    return '';
  }
  /** État du dossier : le badge d'état de l'en-tête, pas les jalons (eux aussi des .badge). En minuscules, '' si illisible. */
  function etatDossier() {
    const bandeau = document.querySelector('#contract_header_banner');
    const b = bandeau && (bandeau.querySelector('.badge.embed') || bandeau.querySelector('.badge[class*="contract-"]'));
    return b ? b.textContent.replace(/\s+/g, ' ').trim().toLowerCase() : '';
  }
  /** Le déménagement est-il terminé ? Promesse de vrai / faux. */
  async function demenagementTermine(id) {
    if (!document.querySelector('#contract_header_banner')) return !!window.__extUlyssRdvEssai;   // page d'essai sans en-tête
    const etat = etatDossier();
    if (/^(réalisé|clôturé)$/.test(etat)) return true;
    if (!/^(lv ok|planning ok)$/.test(etat)) return false;
    const p = await datesDuDossier(id);
    return !!p && p.fin < aujourdhui();
  }
  async function lireClient() {
    const reference = numeroDossier();
    const r = { nom: '', email: '', civilite: '', reference };
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
  async function chercherCollaborateur(texte) {
    const url = `/collaborators/filter?scope=default&filter_collaborator%5Bsearch%5D=${encodeURIComponent(texte)}&filter_collaborator%5Bactive_status%5D=active`;
    const doc = new DOMParser().parseFromString(await fetch(url, { credentials: 'same-origin' }).then((r) => r.text()), 'text/html');
    for (const tr of doc.querySelectorAll('tbody tr')) {
      const a = [...tr.querySelectorAll('a')].find((x) => /^\/collaborators\/\d+$/.test(x.getAttribute('href') || ''));
      if (!a) continue;
      const nomComplet = a.textContent.trim().replace(/\s+/g, ' ');
      return { id: a.getAttribute('href').split('/').pop(), nomComplet, prenom: nomComplet.split(' ').filter((m) => m !== m.toUpperCase()).join(' ') || nomComplet.split(' ')[0] };
    }
    return null;
  }
  /** Équipe du jour 1 au Planning : voir rappel.js (même méthode, lectures en série). */
  async function equipeDuPlanning(jour1, nomClient, dossierId, phaseId, suivre) {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const nom = norm(nomClient);
    if (!jour1 || !nom || !dossierId) return null;
    suivre('Lecture du Planning du ' + jour1.split('-').reverse().join('/') + '…');
    const html = await fetch(`/exploitation_requirements/affectation?date=${jour1}&structures%5B%5D=1&structures%5B%5D=2&structures%5B%5D=3&view=compact`, { credentials: 'same-origin' }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cartes = [...doc.querySelectorAll('[id^="card_exploitation_requirement"]')].filter((c) => norm(c.querySelector('.text-bold')?.textContent).startsWith(nom)).map((c) => c.id.replace(/\D/g, '')).slice(0, 4);
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
  async function photoCollaborateur(id, fiche) {
    try {
      const doc = new DOMParser().parseFromString(await fetch(`/collaborators/${id}`, { credentials: 'same-origin' }).then((r) => r.text()), 'text/html');
      if (fiche) { const t = (doc.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').replace(/^.*?-\s*/, '').trim(); fiche.prenom = t.split(' ').filter((m) => m !== m.toUpperCase()).join(' '); }
      const img = [...doc.querySelectorAll('img')].find((i) => /active_storage/.test(i.getAttribute('src') || '') && !/logotype|logo/i.test(decodeURIComponent(i.getAttribute('src'))));
      if (!img) return '';
      const blob = await fetch(img.getAttribute('src'), { credentials: 'same-origin' }).then((r) => (r.ok ? r.blob() : null));
      if (!blob) return '';
      const bmp = await createImageBitmap(blob);
      const cote = Math.min(bmp.width, bmp.height), sx = (bmp.width - cote) / 2, sy = bmp.height > bmp.width ? (bmp.height - cote) * 0.12 : 0;
      const c = document.createElement('canvas');
      c.width = c.height = 300;
      c.getContext('2d').drawImage(bmp, sx, sy, cote, cote, 0, 0, 300, 300);
      return c.toDataURL('image/jpeg', 0.88);
    } catch (e) { return ''; }
  }

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
    .l-client{grid-template-columns:130px 1fr} .l-membre{grid-template-columns:44px 1fr 130px 1fr 70px 24px}
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
    const client = await lireClient();
    const [, dossierId] = location.pathname.match(CHEMIN) || [];
    const periode = await datesDuDossier(dossierId);
    const phaseId = '';   // écran Devis : la carte du Planning est reconnue par le dossier
    const hote = el('div');
    document.body.append(hote);
    const racine = hote.attachShadow({ mode: 'open' });
    racine.append(el('style', {}, CSS));
    const fermer = () => hote.remove();
    let membres = [];

    const fCiv = el('select', {}, ['', 'Madame', 'Monsieur', 'Madame et Monsieur', 'Maître'].map((c) => el('option', { value: c }, c || '—')));
    fCiv.value = client.civilite;
    const fNom = el('input', { value: client.nom });
    const fMail = el('input', { type: 'email', value: client.email });
    const fRef = el('input', { value: client.reference });
    const fDate = el('input', { type: 'date', value: periode ? periode.fin : '', max: aujourdhui() });
    const zoneEquipe = el('div'), noteEquipe = el('div', { class: 'note' }), msg = el('div', { class: 'msg' });
    const cadre = el('iframe', { title: 'Aperçu du mail' });

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
          if (c) { m.id = c.id; m.prenom = m.prenom || c.prenom; m.vignette = await photoCollaborateur(c.id); dessinerEquipe(); }
          else { bLier.disabled = false; bLier.textContent = 'Lier'; fCherche.style.borderColor = '#b33'; }
        } }, m.id ? '✓' : 'Lier');
        if (m.id) fCherche.value = `Fiche n° ${m.id}`;
        zoneEquipe.append(el('div', { class: 'ligne l-membre' }, vign, fPrenom, fRole, fCherche, bLier,
          el('button', { class: 'suppr', title: 'Retirer', onclick: () => { membres.splice(im, 1); dessinerEquipe(); bEnvoyer.disabled = true; } }, '✕')));
      });
      zoneEquipe.append(el('button', { class: 'mini', onclick: () => { membres.push({ prenom: '', role: ROLES[1], id: '', vignette: '' }); dessinerEquipe(); } }, '+ personne'));
    }
    function donnees(extra = {}) {
      return {
        client_civilite: fCiv.value, client_nom: fNom.value.trim(), client_email: fMail.value.trim(), dossier_reference: fRef.value.trim(), dem_date: fDate.value,
        equipe: membres.filter((m) => m.prenom.trim()).map((m) => ({ prenom: m.prenom.trim(), role: m.role, collaborateur_id: m.id, photo_base64: m.vignette })),
        ...extra,
      };
    }
    function controle() {
      const d = donnees();
      if (!d.client_nom || !d.client_email || !d.dossier_reference) return 'Complétez le nom, l\'e-mail du client et le numéro de dossier.';
      if (!d.dem_date) return 'Indiquez le dernier jour du déménagement.';
      if (d.dem_date > aujourdhui()) return 'Le déménagement n\'est pas terminé.';
      return '';
    }
    async function appel(extra) {
      const r = await demander({ type: 'gc-rdv', cible: 'demande-avis', donnees: donnees(extra) });
      if (r && !r.ok && r.motif === 'code') {
        if (window.__gcDemanderCode) await new Promise((ok) => window.__gcDemanderCode(ok));
        return appel(extra);
      }
      if (!r || !r.ok) throw new Error('Envoi impossible : ' + ((r && r.motif) || 'pas de réponse') + '.');
      const j = r.corps || { ok: false, erreur: 'Réponse illisible (code ' + r.statut + ') : le dossier « demande-avis » est-il déposé sur le serveur ?' };
      return { code: r.statut, ...j };
    }
    function afficher(t, erreur = false, succes = false) { msg.textContent = t; msg.className = 'msg' + (erreur ? ' err' : succes ? ' ok' : ''); }

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
          afficher(`Demande d'avis envoyée à ${r.destinataire}.` + (r.copie_envoyes ? ` Copie dans « ${r.copie_envoyes} ».` : ''), false, true);
          bApercu.disabled = true;
          setTimeout(fermer, 1800);
          return;
        }
        afficher(r.erreur || 'Erreur.', true);
        if (r.doublon) bForcer.style.display = '';
      } catch (e) { afficher(e.message, true); }
      bEnvoyer.disabled = false;
    }

    // Toute modification oblige à refaire l'aperçu avant d'envoyer
    racine.append(el('div', { class: 'voile', onclick: (e) => { if (e.target === e.currentTarget) fermer(); } },
      el('div', { class: 'fen', oninput: () => { bEnvoyer.disabled = true; }, onchange: () => { bEnvoyer.disabled = true; } },
        el('div', { class: 'tete' }, el('b', {}, 'DEMANDE D\'AVIS'), el('button', { class: 'x', onclick: fermer, title: 'Fermer' }, '✕')),
        el('div', { class: 'corps' },
          el('div', { class: 'col' },
            el('h4', {}, 'Client'),
            el('div', { class: 'ligne l-client' }, el('div', {}, el('label', {}, 'Civilité'), fCiv), el('div', {}, el('label', {}, 'Nom'), fNom)),
            el('label', {}, 'E-mail'), fMail,
            el('label', {}, 'N° de dossier'), fRef,
            el('h4', {}, 'Déménagement'),
            el('label', {}, 'Dernier jour du déménagement (écrit dans le mail)'), fDate,
            el('div', { class: 'note' }, periode ? `Date reprise de l'organisation validée dans Ulyss (${periode.debut.split('-').reverse().join('/')} → ${periode.fin.split('-').reverse().join('/')}).` : 'Dates non lues dans Ulyss : à saisir.'),
            el('h4', {}, 'Équipe'),
            el('div', { class: 'note' }, 'Reprise automatique du Planning (jour 1). Prénom seul dans le mail, modifiable. Sans équipe, le bloc « Votre équipe » est retiré du mail.'),
            noteEquipe, zoneEquipe),
          el('div', { class: 'col' }, el('h4', {}, 'Aperçu'), cadre)),
        el('div', { class: 'pied' }, msg, bForcer, bApercu, bEnvoyer))));
    dessinerEquipe();

    (async () => {
      if (!periode) { noteEquipe.textContent = 'Dates non lues : équipe à saisir.'; return; }
      let equipe = null;
      try { equipe = await equipeDuPlanning(periode.debut, client.nom, dossierId, phaseId, (t) => { noteEquipe.textContent = t; }); } catch (e) { equipe = null; }
      if (!hote.isConnected) return;
      if (!equipe) { noteEquipe.textContent = 'Aucune personne retrouvée au Planning du jour 1 : équipe à saisir, ou envoi sans équipe.'; return; }
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
      noteEquipe.textContent = 'Équipe reprise du Planning (jour 1, la 1re position est chef d\'équipe)' + (sansPhoto ? ` — ${sansPhoto} sans photo, silhouette affichée.` : '.');
      bEnvoyer.disabled = true;
    })();
  }

  /** Bouton de l'écran Devis, à la suite de « Télécharger » et « Envoyer » (rangée div.flex.flex-row.gap-4 de #tab-content). */
  const verdicts = new Map();   // dossier → promesse « déménagement terminé » (une seule lecture des dates par dossier)
  const voisinDevis = () => document.querySelector('#tab-content a[href*="address_send_by_mail"]') || document.querySelector('#tab-content a[href*="/download"]');
  function insererBouton() {
    if (window.__extUlyssActif && !window.__extUlyssActif('demande-avis')) return;
    if (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai) return;
    const m = location.pathname.match(CHEMIN);
    const deja = document.getElementById(ID_BOUTON);
    if (!m) { if (deja) deja.remove(); return; }
    if (deja || !voisinDevis()) return;   // déjà posé, ou pas encore de devis affiché
    if (SOCIETES.indexOf((numeroDossier().match(/^DGT[CD]([A-Z])/) || [])[1]) < 0) return;
    if (!verdicts.has(m[1])) verdicts.set(m[1], demenagementTermine(m[1]).catch(() => false));
    verdicts.get(m[1]).then((oui) => {
      const voisin = voisinDevis();
      if (!oui || !voisin || document.getElementById(ID_BOUTON) || (location.pathname.match(CHEMIN) || [])[1] !== m[1]) return;
      const bouton = document.createElement('button');
      bouton.id = ID_BOUTON; bouton.type = 'button'; bouton.textContent = 'Demander un avis';
      bouton.title = 'Envoyer au client la demande d\'avis Google, avec son équipe (Extension Ulyss)';
      bouton.className = 'btn';
      voisin.parentElement.append(bouton);
      bouton.addEventListener('click', (e) => { e.preventDefault(); ouvrirFenetre(); });
    });
  }
  document.addEventListener('turbo:load', insererBouton);
  document.addEventListener('turbo:frame-load', insererBouton);
  new MutationObserver(() => insererBouton()).observe(document.documentElement, { childList: true, subtree: true });
  insererBouton();
})();
