/*
 * Extension Ulyss — « Taux de charge » du Planning (26/11/2026, demande de Guillaume).
 * Bouton dans le Planning : calendrier des semaines à venir, une case par jour ouvré, avec le nombre de déménageurs
 * encore libres (compteur d'Ulyss, toutes sociétés du groupe confondues) et une couleur :
 *   rouge = peu chargé … vert = au plus près de zéro disponible ; violet = négatif, il manque du monde.
 * Rien ne tourne en fond : Ulyss n'est lu qu'à l'ouverture du calendrier, et seulement pour les jours jamais lus,
 * signalés « à relire » ou trop anciens. Les chiffres sont partagés entre les postes d'un même client par
 * ulyss-software.com/extension-ulyss/charge/ (compartiment déduit de la clé ; chiffres seuls, aucun nom).
 * Relevé staging 26/11/2026 :
 *  - /exploitation_requirements?date=X[&structures[]=N] : en-têtes [id^=exploitation_day_header_AAAA-MM-JJ], bloc de
 *    l'icône .icon-demenageur-print = « journée, matin, après-midi » restants ; identiques quelles que soient les structures ;
 *  - 6 colonnes par page : 2 jours avec les 3 sociétés (~2,6 s), 6 jours ouvrés avec une seule (~5-6 s) → une seule société ;
 *  - week-ends sautés par Ulyss ; rien n'est écrit dans Ulyss.
 */
(() => {
  'use strict';

  const ID_BOUTON = 'ext-ulyss-bouton-charge';
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const CHEMIN_PLANNING = /^\/exploitation_requirements(\/affectation)?\/?$/;
  const SEMAINES = 8, SEMAINES_EN_PLUS = 4;
  // Seuils sur les déménageurs libres la journée (réglables) : en dessous de 0 violet, puis vert, jaune, orange, rouge.
  const SEUILS = [
    { max: -1, nom: 'Il manque du monde', fond: '#7c3aed', texte: '#fff' },
    { max: 2, nom: 'Plein ou presque', fond: '#16a34a', texte: '#fff' },
    { max: 5, nom: 'Bien chargé', fond: '#facc15', texte: '#3b2f00' },
    { max: 9, nom: 'Moyennement chargé', fond: '#f97316', texte: '#fff' },
    { max: Infinity, nom: 'Peu chargé', fond: '#dc2626', texte: '#fff' },
  ];
  const seuil = (n) => SEUILS.find((s) => n <= s.max);
  // Relecture de sécurité (changements faits hors extension : absences, postes sans extension)
  const DELAI_PROCHE = 2 * 3600, DELAI_LOIN = 24 * 3600, JOURS_PROCHES = 15;

  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => {
      try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false, motif: "l'extension ne répond pas (recharger la page)" }); }); }
      catch (e) { ok({ ok: false, motif: "l'extension a été mise à jour : recharger la page" }); }
    });
  }
  /** Appel du serveur. silencieux = ne jamais demander le code d'accès (signalements faits en passant). */
  async function serveur(donnees, silencieux) {
    const r = await demander({ type: 'gc-rdv', cible: 'charge', donnees: { instance: location.hostname, ...donnees } });
    if (r && !r.ok && r.motif === 'code') {
      if (silencieux || !window.__gcDemanderCode) throw new Error('code');
      await new Promise((ok) => window.__gcDemanderCode(ok));
      return serveur(donnees, true);
    }
    if (!r || !r.ok) throw new Error((r && r.motif) || 'pas de réponse');
    if (!r.corps || !r.corps.ok) throw new Error((r.corps && r.corps.erreur) || 'réponse illisible (code ' + r.statut + ')');
    return r.corps;
  }

  // ---------------------------------------------------------------------------
  // Dates (tout en AAAA-MM-JJ, sans fuseau)
  // ---------------------------------------------------------------------------
  const iso = (d) => d.toISOString().slice(0, 10);
  const jour = (s) => new Date(s + 'T12:00:00Z');
  const plus = (s, n) => { const d = jour(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const ouvre = (s) => { const n = jour(s).getUTCDay(); return n >= 1 && n <= 5; };
  const lundi = (s) => plus(s, -((jour(s).getUTCDay() + 6) % 7));
  function aujourdhui() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function plage(debut, fin, plafond = 90) { const l = []; for (let d = debut, i = 0; d <= fin && i < plafond; d = plus(d, 1), i++) l.push(d); return l; }

  // ---------------------------------------------------------------------------
  // Lecture d'Ulyss
  // ---------------------------------------------------------------------------
  /** Compteurs « déménageurs » des en-têtes de jour d'une page du Planning : { 'AAAA-MM-JJ': {j, m, a} } */
  function compteurs(doc) {
    const r = {};
    doc.querySelectorAll('[id^="exploitation_day_header_"]').forEach((e) => {
      const date = e.id.slice(-10), icone = e.querySelector('.icon-demenageur-print');
      const n = icone && icone.parentElement ? (icone.parentElement.textContent.match(/-?\d+/g) || []).map(Number) : [];
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && n.length >= 3) r[date] = { j: n[0], m: n[1], a: n[2] };
    });
    return r;
  }
  /** Une société à afficher : la page montre alors 6 jours au lieu de 2 (les compteurs, eux, valent pour tout le groupe). */
  function uneStructure(doc) {
    const a = doc.querySelector('a[href*="/exploitation_requirements/new"][href*="structure_id="]');
    const m = a && (a.getAttribute('href').match(/structure_id=(\d+)/) || [])[1];
    return m || '';
  }
  async function lirePage(date, structure) {
    const html = await fetch(`/exploitation_requirements?date=${date}` + (structure ? `&structures%5B%5D=${structure}` : ''), { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('Planning : ' + r.status); return r.text(); });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return { jours: compteurs(doc), structure: uneStructure(doc) };
  }

  // ---------------------------------------------------------------------------
  // Fenêtre
  // ---------------------------------------------------------------------------
  const CSS = `
    :host{all:initial}
    .voile{position:fixed;inset:0;background:rgba(14,22,38,.45);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 12px;font-family:Arial,Helvetica,sans-serif}
    .fen{background:#fff;width:min(760px,100%);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.3);color:#1f2a44;font-size:13px;overflow:hidden}
    .tete{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e3e8f0}
    .tete b{font-size:16px} .x{background:none;border:0;font-size:20px;cursor:pointer;color:#64748b}
    .corps{padding:14px 18px;max-height:70vh;overflow:auto}
    .grille{display:grid;grid-template-columns:86px repeat(5,1fr);gap:6px;align-items:stretch}
    .ent{font-size:11px;color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:1px;padding-bottom:2px}
    .sem{font-size:11px;color:#64748b;display:flex;align-items:center}
    .case{border-radius:10px;padding:6px 8px;min-height:58px;display:flex;flex-direction:column;justify-content:space-between;background:#eef2f7;color:#94a3b8}
    .case .d{font-size:11px;opacity:.9} .case .n{font-size:22px;font-weight:bold;line-height:1;text-align:center}
    .case .s{font-size:10px;text-align:center;opacity:.95;min-height:12px}
    .case.passe{background:#f8fafc;color:#cbd5e1} .case.auj{outline:2px solid #1f2a44;outline-offset:1px}
    .case.attente .n{font-size:13px;font-weight:normal}
    .leg{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:12px;font-size:11px;color:#475569}
    .leg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:4px;vertical-align:-1px}
    .pied{display:flex;gap:10px;align-items:center;padding:10px 18px;border-top:1px solid #e3e8f0}
    .msg{flex:1;font-size:12px;color:#475569} .err{color:#b91c1c}
    .btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12px;color:#1f2a44}
    .btn:disabled{opacity:.5;cursor:default}
  `;
  function el(tag, attrs = {}, ...enfants) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) n.setAttribute(k, v);
    }
    enfants.flat().forEach((e) => n.append(e instanceof Node ? e : document.createTextNode(String(e))));
    return n;
  }
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const court = (s) => `${+s.slice(8)} ${MOIS[+s.slice(5, 7) - 1]}`;

  let ouverte = false;
  async function ouvrir() {
    if (ouverte) return;
    ouverte = true;
    const hote = el('div');
    document.body.append(hote);
    const racine = hote.attachShadow({ mode: 'open' });
    let vivant = true, enLecture = false, semaines = SEMAINES;
    const fermer = () => { vivant = false; ouverte = false; hote.remove(); };

    const auj = aujourdhui(), premierLundi = lundi(auj);
    let connus = {}, heureServeur = Math.floor(Date.now() / 1000), partage = true;
    const vides = new Set();        // jours qu'Ulyss n'affiche pas (non retentés dans cette fenêtre)
    const grille = el('div', { class: 'grille' });
    const msg = el('div', { class: 'msg' });
    const bPlus = el('button', { class: 'btn', onclick: () => { semaines += SEMAINES_EN_PLUS; dessiner(); mettreAJour(false); } }, `+ ${SEMAINES_EN_PLUS} semaines`);
    const bActu = el('button', { class: 'btn', title: 'Relire maintenant dans Ulyss tous les jours affichés', onclick: () => mettreAJour(true) }, 'Actualiser');
    const dire = (t, erreur) => { msg.textContent = t; msg.className = 'msg' + (erreur ? ' err' : ''); };

    const joursAffiches = () => plage(premierLundi, plus(premierLundi, semaines * 7 - 1), 400).filter((d) => ouvre(d) && d >= auj);
    function perime(d, tout) {
      const c = connus[d];
      if (vides.has(d)) return false;
      if (!c || c.sale || tout) return true;
      const age = heureServeur - (c.lu || 0);
      return age > (d <= plus(auj, JOURS_PROCHES) ? DELAI_PROCHE : DELAI_LOIN);
    }

    function dessiner(enAttente = new Set()) {
      grille.replaceChildren(el('div'), ...['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map((j) => el('div', { class: 'ent' }, j)));
      for (let s = 0; s < semaines; s++) {
        const l = plus(premierLundi, s * 7);
        grille.append(el('div', { class: 'sem' }, `${court(l)}`));
        for (let i = 0; i < 5; i++) {
          const d = plus(l, i), c = connus[d];
          if (d < auj) { grille.append(el('div', { class: 'case passe' }, el('div', { class: 'd' }, court(d)))); continue; }
          const k = el('div', { class: 'case' + (d === auj ? ' auj' : '') }, el('div', { class: 'd' }, court(d)));
          if (c) {
            const sl = seuil(c.j);
            k.style.background = sl.fond; k.style.color = sl.texte;
            const demi = [c.m ? `matin ${c.m > 0 ? '+' : ''}${c.m}` : '', c.a ? `ap.-midi ${c.a > 0 ? '+' : ''}${c.a}` : ''].filter(Boolean).join(' · ');
            k.title = `${sl.nom} — ${c.j} déménageur(s) libre(s) la journée` + (demi ? ` ; en plus : ${demi}` : '') + (c.lu ? ` — lu à ${new Date(c.lu * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '');
            k.append(el('div', { class: 'n' }, String(c.j)), el('div', { class: 's' }, (enAttente.has(d) ? '↻ ' : '') + demi));
          } else {
            k.classList.add('attente');
            k.append(el('div', { class: 'n' }, vides.has(d) ? '—' : enAttente.has(d) ? '…' : ''), el('div', { class: 's' }));
          }
          grille.append(k);
        }
      }
    }

    /** Relit dans Ulyss, page par page et jamais en parallèle, les seuls jours périmés. */
    async function mettreAJour(tout) {
      if (enLecture) return;
      enLecture = true; bActu.disabled = true; bPlus.disabled = true;
      try {
        let aLire = joursAffiches().filter((d) => perime(d, tout));
        const total = aLire.length;
        if (!total) { dire('À jour.'); return; }
        let structure = uneStructure(document);
        while (aLire.length && vivant) {
          dessiner(new Set(aLire));
          dire(`Lecture du Planning : ${total - aLire.length}/${total} jour(s)…`);
          const d = aLire[0];
          const page = await lirePage(d, structure);
          structure = structure || page.structure;
          const lus = Object.keys(page.jours).filter((x) => x >= auj);
          if (!page.jours[d]) vides.add(d);
          const maintenant = Math.floor(Date.now() / 1000);
          lus.forEach((x) => { connus[x] = { ...page.jours[x], lu: maintenant }; });
          heureServeur = Math.max(heureServeur, maintenant);
          aLire = aLire.filter((x) => x !== d && !lus.includes(x));
          if (lus.length && partage) {
            const envoi = {}; lus.forEach((x) => { envoi[x] = page.jours[x]; });
            serveur({ action: 'ecrire', jours: envoi }, true).catch(() => { partage = false; });
          }
        }
        if (vivant) { dessiner(); dire(partage ? 'À jour.' : 'À jour sur ce poste (partage entre postes indisponible).'); }
      } catch (e) {
        if (vivant) { dessiner(); dire('Lecture interrompue : ' + e.message, true); }
      } finally {
        enLecture = false; bActu.disabled = false; bPlus.disabled = false;
      }
    }

    racine.append(el('style', {}, CSS), el('div', { class: 'voile', onclick: (e) => { if (e.target === e.currentTarget) fermer(); } },
      el('div', { class: 'fen' },
        el('div', { class: 'tete' }, el('b', {}, 'Taux de charge — déménageurs libres par jour'), el('button', { class: 'x', title: 'Fermer', onclick: fermer }, '✕')),
        el('div', { class: 'corps' }, grille,
          el('div', { class: 'leg' }, SEUILS.slice().reverse().map((s) => el('span', {}, el('i', { style: 'background:' + s.fond }), s.nom)),
            el('span', {}, 'Chiffre = déménageurs encore libres la journée, tout le groupe. Dessous : libres en plus sur une demi-journée.'))),
        el('div', { class: 'pied' }, msg, bPlus, bActu))));
    dessiner();
    dire('Chargement…');
    try {
      const r = await serveur({ action: 'lire' });
      connus = r.jours || {}; heureServeur = r.maintenant || heureServeur;
    } catch (e) {
      partage = false;
      if (e.message === 'code') { dire("Code d'accès de l'extension nécessaire.", true); return; }
    }
    if (!vivant) return;
    dessiner();
    mettreAJour(false);
  }

  // ---------------------------------------------------------------------------
  // Signaler les jours modifiés (pour que les autres postes les relisent)
  // ---------------------------------------------------------------------------
  function salir(dates) {
    const auj = aujourdhui();
    const l = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= auj).slice(0, 200);
    if (l.length) serveur({ action: 'salir', dates: l }, true).catch(() => {});
  }
  const MOIS_ULYSS = { janv: 1, jan: 1, févr: 2, fevr: 2, fév: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dec: 12 };
  function datesEnTetePhase() {
    const titre = document.getElementById('phase-title');
    const bloc = titre && titre.parentElement ? titre.parentElement.querySelector('.ml-2') : null;
    const l = bloc ? [...bloc.textContent.toLowerCase().matchAll(/(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{4})/g)] : [];
    const d = l.map((m) => (MOIS_ULYSS[m[2]] ? `${m[3]}-${String(MOIS_ULYSS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : '')).filter(Boolean);
    return d.length >= 2 ? plage(d[0], d[1]) : [];
  }
  function nbJoursPhase() {
    try { const ev = JSON.parse(document.querySelector('[data-events]').getAttribute('data-events') || '[]'); return Math.max(1, new Set(ev.map((e) => String(e.start).slice(0, 10))).size); } catch (e) { return 1; }
  }
  document.addEventListener('submit', (e) => {
    try {
      const f = e.target; if (!f || !f.getAttribute) return;
      const chemin = new URL(f.getAttribute('action') || '', location.href).pathname;
      const valeurs = [...new FormData(f).values()].filter((v) => typeof v === 'string');
      const dates = valeurs.map((v) => (v.match(/^\d{4}-\d{2}-\d{2}/) || [])[0]).filter(Boolean);
      if (/\/phases\/\d+\/exploitation_requirements(\/validate)?\/?$/.test(chemin)) {
        // Mise au planning ou déplacement d'un chantier : nouveaux jours (week-ends sautés → marge) et anciens jours.
        const n = nbJoursPhase();
        salir(dates.flatMap((d) => plage(d, plus(d, Math.ceil(n * 1.5) + 3))).concat(datesEnTetePhase()));
      } else if (/^\/exploitation_requirements(\/|$)/.test(chemin) && (f.method || '').toLowerCase() !== 'get') {
        const vue = new URLSearchParams(location.search).get('date') || aujourdhui();
        salir(dates.length ? dates : plage(vue, plus(vue, 8)));
      }
    } catch (err) { /* un signalement manqué est rattrapé par la relecture de sécurité */ }
  }, true);
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[data-turbo-method="delete"][href*="/exploitation_requirements/"]') : null;
    if (!a) return;
    const vue = new URLSearchParams(location.search).get('date') || aujourdhui();
    salir(plage(vue, plus(vue, 8)));
  }, true);

  // ---------------------------------------------------------------------------
  // Bouton dans le Planning
  // ---------------------------------------------------------------------------
  function insererBouton() {
    if (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai) return;
    const b = document.getElementById(ID_BOUTON);
    if (!CHEMIN_PLANNING.test(location.pathname)) { if (b) b.remove(); return; }
    if (b) return;
    const voisin = [...document.querySelectorAll('a.btn')].find((x) => ['ressources', 'visualisation', 'affectation'].includes(x.textContent.trim().toLowerCase()));
    if (!voisin) return;
    const bouton = document.createElement('a');
    bouton.id = ID_BOUTON; bouton.href = '#';
    bouton.className = 'btn btn-outline mr-3.5';
    bouton.textContent = 'Taux de charge';
    bouton.title = 'Déménageurs libres par jour sur les semaines à venir (Extension Ulyss)';
    bouton.addEventListener('click', (e) => { e.preventDefault(); ouvrir(); });
    voisin.insertAdjacentElement('beforebegin', bouton);
  }
  document.addEventListener('turbo:load', insererBouton);
  new MutationObserver(() => insererBouton()).observe(document.documentElement, { childList: true, subtree: true });
  insererBouton();
})();
