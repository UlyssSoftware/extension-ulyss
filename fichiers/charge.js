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
    // Rendu adouci le 26/11/2026 (« trop flashy ») : fond pastel, chiffre dans la teinte foncée, liseré de couleur.
    { max: -1, nom: 'Il manque du monde', fond: '#f3e8ff', texte: '#6b21a8', trait: '#9333ea' },
    { max: 2, nom: 'Plein ou presque', fond: '#e3f6ea', texte: '#166534', trait: '#22a35a' },
    { max: 5, nom: 'Bien chargé', fond: '#fdf6d3', texte: '#7a5a05', trait: '#e2b100' },
    { max: 9, nom: 'Moyennement chargé', fond: '#ffeede', texte: '#9a4a12', trait: '#f08a3c' },
    { max: Infinity, nom: 'Peu chargé', fond: '#fdecec', texte: '#a12a2a', trait: '#e25c5c' },
  ];
  const seuil = (n) => SEUILS.find((s) => n <= s.max);
  // Alerte d'équilibrage (demande du 26/11/2026) : 6 déménageurs ou plus libres sur une seule demi-journée → petit panneau
  // sur la case, pour inviter à répartir la charge entre le matin et l'après-midi.
  const ALERTE_DEMI = 6;
  const PANNEAU = '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 22 20.5H2z" fill="#f59e0b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9.5v5.2" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.25" fill="#fff"/></svg>';
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
    .voile{position:fixed;inset:0;background:rgba(15,23,42,.38);backdrop-filter:blur(2px);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 12px;font-family:Inter,'Segoe UI',system-ui,-apple-system,Arial,sans-serif}
    .fen{background:#fff;width:min(720px,100%);border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.22);color:#1f2a44;font-size:13px;overflow:hidden}
    .tete{display:flex;justify-content:space-between;align-items:center;padding:18px 22px 6px}
    .tete b{font-size:17px;font-weight:600;letter-spacing:-.2px} .tete small{display:block;font-size:12px;color:#64748b;font-weight:400;margin-top:2px}
    .x{background:none;border:0;font-size:18px;cursor:pointer;color:#94a3b8;border-radius:8px;width:32px;height:32px} .x:hover{background:#f1f5f9;color:#475569}
    .corps{padding:12px 22px 16px;max-height:70vh;overflow:auto}
    .grille{display:grid;grid-template-columns:64px repeat(5,1fr);gap:8px;align-items:stretch}
    .ent{font-size:11px;color:#94a3b8;text-align:center;font-weight:600;letter-spacing:.6px;text-transform:uppercase;padding-bottom:2px}
    .sem{font-size:11px;color:#94a3b8;display:flex;align-items:center;font-variant-numeric:tabular-nums}
    .case{border-radius:12px;padding:8px 10px 7px 12px;min-height:60px;display:flex;flex-direction:column;justify-content:space-between;background:#f6f8fb;color:#94a3b8;transition:transform .12s,box-shadow .12s}
    .case .d{font-size:11px;font-weight:500;display:flex;justify-content:space-between;align-items:center;min-height:16px}
    .case .d>span:first-child{opacity:.75}
    .alerte{display:inline-flex;filter:drop-shadow(0 1px 1.5px rgba(120,70,0,.35))}
    .leg .alerte{vertical-align:-3px;margin-right:5px}
    .case .n{font-size:22px;font-weight:650;line-height:1.05;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
    .case .s{font-size:10.5px;opacity:.8;min-height:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .case.passe{background:transparent;color:#cbd5e1} .case.passe .d{opacity:.6}
    .case.auj{outline:2px solid #1f2a44;outline-offset:2px}
    .case.attente .n{font-size:13px;font-weight:400}
    .leg{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:16px;padding-top:12px;border-top:1px solid #eef2f7;font-size:11.5px;color:#64748b}
    .leg i{display:inline-block;width:14px;height:12px;border-radius:4px;margin-right:6px;vertical-align:-2px}
    .leg .note{flex-basis:100%;color:#94a3b8}
    .pied{display:flex;gap:10px;align-items:center;padding:12px 22px;border-top:1px solid #eef2f7;background:#fbfcfe}
    .msg{flex:1;font-size:12px;color:#64748b} .err{color:#b91c1c}
    .btn{border:1px solid #dbe2ec;background:#fff;border-radius:10px;padding:8px 14px;cursor:pointer;font-size:12.5px;color:#1f2a44;font-family:inherit} .btn:hover{border-color:#b8c4d6}
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
          const k = el('div', { class: 'case' + (d === auj ? ' auj' : '') }, el('div', { class: 'd' }, el('span', {}, court(d))));
          if (c) {
            const sl = seuil(c.j);
            k.style.background = sl.fond; k.style.color = sl.texte; k.style.boxShadow = 'inset 3px 0 0 ' + sl.trait;
            const demi = [c.m ? `matin ${c.m > 0 ? '+' : ''}${c.m}` : '', c.a ? `ap.-midi ${c.a > 0 ? '+' : ''}${c.a}` : ''].filter(Boolean).join(' · ');
            k.title = `${sl.nom} — ${c.j} déménageur(s) libre(s) la journée` + (demi ? ` ; en plus : ${demi}` : '') + (c.lu ? ` — lu à ${new Date(c.lu * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '');
            k.append(el('div', { class: 'n' }, String(c.j)), el('div', { class: 's' }, (enAttente.has(d) ? '↻ ' : '') + demi));
            const desequilibre = [c.m >= ALERTE_DEMI ? `${c.m} libres le matin` : '', c.a >= ALERTE_DEMI ? `${c.a} libres l'après-midi` : ''].filter(Boolean);
            if (desequilibre.length) {
              const al = el('span', { class: 'alerte' }); al.innerHTML = PANNEAU;
              k.firstChild.append(al);
              k.title = `⚠ Charge à équilibrer : ${desequilibre.join(' et ')}.\n` + k.title;
            }
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
        if (vivant) { dessiner(); dire(partage ? 'À jour.' : 'À jour sur ce poste — partage entre postes pas encore en service.'); }
      } catch (e) {
        if (vivant) { dessiner(); dire('Lecture interrompue : ' + e.message, true); }
      } finally {
        enLecture = false; bActu.disabled = false; bPlus.disabled = false;
      }
    }

    racine.append(el('style', {}, CSS), el('div', { class: 'voile', onclick: (e) => { if (e.target === e.currentTarget) fermer(); } },
      el('div', { class: 'fen' },
        el('div', { class: 'tete' }, el('b', {}, 'Taux de charge', el('small', {}, 'Déménageurs encore libres par jour, tout le groupe')), el('button', { class: 'x', title: 'Fermer', onclick: fermer }, '✕')),
        el('div', { class: 'corps' }, grille,
          el('div', { class: 'leg' }, SEUILS.slice().reverse().map((s) => el('span', {}, el('i', { style: 'background:' + s.fond + ';box-shadow:inset 3px 0 0 ' + s.trait }), s.nom)),
            (() => { const a = el('span', {}); a.innerHTML = '<span class="alerte">' + PANNEAU + '</span>' + ALERTE_DEMI + ' libres ou plus sur une demi-journée : charge à équilibrer'; return a; })(),
            el('span', { class: 'note' }, 'Le chiffre : libres la journée entière. Dessous : libres en plus sur une demi-journée.'))),
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
    // Place (demande du 26/11/2026) : à gauche, juste après le choix de date et de semaine du Planning
    // (div.flex.ml-6 : flèches, form avec input#date[name=date], « Semaine-NN », flèches). À défaut, avant « Ressources ».
    const champDate = document.querySelector('form input[type="date"][name="date"]');
    const groupeDate = champDate && champDate.form && champDate.form.parentElement && champDate.form.parentElement.querySelector(':scope > a.btn') ? champDate.form.parentElement : null;
    const voisin = groupeDate || [...document.querySelectorAll('a.btn')].find((x) => ['ressources', 'visualisation', 'affectation'].includes(x.textContent.trim().toLowerCase()));
    if (!voisin) return;
    const bouton = document.createElement('a');
    bouton.id = ID_BOUTON; bouton.href = '#';
    bouton.className = groupeDate ? 'btn btn-outline ml-4' : 'btn btn-outline mr-3.5';
    if (groupeDate) bouton.style.cssText = 'align-self:flex-start;white-space:nowrap';
    bouton.textContent = 'Taux de charge';
    bouton.title = 'Déménageurs libres par jour sur les semaines à venir (Extension Ulyss)';
    bouton.addEventListener('click', (e) => { e.preventDefault(); ouvrir(); });
    voisin.insertAdjacentElement(groupeDate ? 'afterend' : 'beforebegin', bouton);
  }
  /**
   * Raccourci sur tous les écrans d'Ulyss (demande du 26/11/2026) : une entrée de la barre latérale, entre « Dashboard »
   * et « Collaborateurs », bâtie comme les modules d'Ulyss (a.sidebar-link > div icône .text-3xl.mr-3.75 + div.reductible
   * pour le nom, que la barre masque d'elle-même quand elle est repliée). Même fenêtre que le bouton du Planning.
   */
  const ID_RACCOURCI = 'ext-ulyss-raccourci-charge';
  function insererRaccourci() {
    if (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai) return;
    if (document.getElementById(ID_RACCOURCI)) return;
    const zone = document.querySelector('#global-sidebar .discret-scroll') || document.getElementById('global-sidebar');
    const liens = zone ? [...zone.querySelectorAll(':scope > a.sidebar-link')] : [];
    if (!liens.length) return;
    const r = document.createElement('a');
    r.id = ID_RACCOURCI; r.href = '#'; r.className = 'sidebar-link';
    r.title = 'Taux de charge : déménageurs libres par jour (Extension Ulyss)';
    r.innerHTML = '<div class="text-3xl mr-3.75"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="display:block;margin:3px 0"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 16.5v-2.5M12 16.5v-4M16 16.5v-1.5" stroke-width="1.9"/></svg></div><div class="reductible">Taux de charge</div>';
    r.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ouvrir(); });
    liens[0].insertAdjacentElement('afterend', r);   // juste après le premier module (Dashboard)
  }
  const poser = () => { insererBouton(); insererRaccourci(); };
  document.addEventListener('turbo:load', poser);
  new MutationObserver(poser).observe(document.documentElement, { childList: true, subtree: true });
  poser();
})();
