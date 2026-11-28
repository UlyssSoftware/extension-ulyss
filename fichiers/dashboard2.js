/*
 * Extension Ulyss — « Dashboard V2 » (28/11/2026, demande de Guillaume). Module RÉSERVÉ pour le moment : il s'allume poste par
 * poste, avec le code d'accès (réglages de l'extension, colonne « Sur ce poste »).
 *  - Une entrée « Dashboard V2 » dans la barre latérale ouvre un ÉCRAN dans la zone de contenu (adresse « …#dashboard-v2 »).
 *    Le tableau de bord d'Ulyss n'est ni modifié ni remplacé : son entrée « Dashboard » reste telle quelle.
 *  - EXACTEMENT les mêmes informations que le tableau de bord d'Ulyss : l'écran lit la page /dashboard de la session ouverte,
 *    y relève les blocs proposés à CE profil (turbo-frame + adresse), puis lit chaque bloc tel qu'Ulyss le sert. Rien n'est
 *    recalculé, rien n'est écrit, rien ne quitte le poste. Un bloc inconnu (autre profil) est affiché quand même, rangé « Autres ».
 *  - Mise en forme : blocs regroupés par thème, compteurs en tête, badge de société sur chaque ligne. Quand Ulyss ne donne pas
 *    la société dans le bloc, elle est déduite du numéro (lettre F, L, B) ou, à défaut, lue une fois sur le dossier et gardée
 *    sur le poste (même mémoire que l'essai du 28/11 : « ext-ulyss-ste »).
 *  - Profil « assistante » relevé en production le 28/11/2026 : 9 blocs (échanges client, SAV, demandes d'autorisation, arrêtés
 *    en attente, besoins externes, dossiers validés en attente, règlements en retard, devis à mettre au planning, factures non envoyées).
 */
(() => {
  'use strict';
  if (window.__extUlyssActif && !window.__extUlyssActif('dashboard2')) return;
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const essai = () => !!window.__extUlyssRdvEssai;
  if (window.top !== window || (!HOTES.test(location.hostname) && !essai())) return;
  const ID_ENTREE = 'ext-ulyss-raccourci-dashboard2', ID_ECRAN = 'ext-ulyss-ecran-dashboard2', ANCRE = '#dashboard-v2', CLE_STE = 'ext-ulyss-ste';
  const STES = { FRA: '#0039b3', LDL: '#9e1f1f', BD: '#f67904' }, LETTRES = { F: 'FRA', L: 'LDL', B: 'BD' };
  // Thèmes : [titre, couleur, identifiants des blocs d'Ulyss dans l'ordre d'affichage]
  const THEMES = [
    ['Relation client', '#1d4fd7', ['communication-requests', 'after_sales-requests']],
    ['Stationnement', '#7c3aed', ['waiting_authorizations-parking_decrees', 'authorizations_needed-parking_decrees']],
    ['Exploitation', '#0f766e', ['need_planning-contracts', 'external-needs', 'validated_waiting-contracts']],
    ['Facturation', '#b45309', ['late_payment-contracts', 'manual-invoices']],
  ];
  const COURTS = { 'communication-requests': 'Échanges client', 'after_sales-requests': 'SAV', 'waiting_authorizations-parking_decrees': 'Autorisations à demander', 'authorizations_needed-parking_decrees': 'Arrêtés attendus', 'need_planning-contracts': 'Devis à planifier', 'external-needs': 'Besoins externes', 'validated_waiting-contracts': 'Validés en attente', 'late_payment-contracts': 'Règlements en retard', 'manual-invoices': 'Factures à envoyer' };
  const ICONES = {
    'communication-requests': '<path d="M4 5h16v11H9l-5 4z"/>', 'after_sales-requests': '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16v4h4l5.5-5.5a4 4 0 0 0 5-5L16 12l-3-3z"/>',
    'waiting_authorizations-parking_decrees': '<path d="M9 3h6l1 2h3v15H5V5h3z"/><path d="M9 13l2 2 4-4"/>', 'authorizations_needed-parking_decrees': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    'need_planning-contracts': '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', 'external-needs': '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.7-5 5.500-5s4.900 1.800 5.500 5M17 8v6M14 11h6"/>',
    'validated_waiting-contracts': '<path d="M5 12.500l4.500 4.500L19 7.500"/>', 'late_payment-contracts': '<circle cx="12" cy="12" r="8.5"/><path d="M15 9.500c-.500-1-1.600-1.500-3-1.500-1.700 0-3 .800-3 2s1.300 1.800 3 2 3 .800 3 2-1.300 2-3 2c-1.400 0-2.500-.500-3-1.500M12 6.500v11"/>',
    'manual-invoices': '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>', '': '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  };
  const propre = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const lireJson = (cle) => { try { return JSON.parse(localStorage.getItem(cle) || '{}') || {}; } catch (e) { return {}; } };
  const societes = lireJson(CLE_STE);
  const garderStes = () => { try { localStorage.setItem(CLE_STE, JSON.stringify(societes)); } catch (e) {} };

  // ---------------------------------------------------------------------------
  // Lecture du tableau de bord d'Ulyss (lecture seule)
  // ---------------------------------------------------------------------------
  async function html(url, cadre) {
    const r = await fetch(url, { credentials: 'same-origin', headers: cadre ? { Accept: 'text/html', 'Turbo-Frame': cadre } : { Accept: 'text/html' } });
    if (r.redirected && /sign_in|login/.test(r.url)) throw new Error('session Ulyss expirée');
    if (!r.ok) throw new Error('Ulyss a répondu ' + r.status);
    return new DOMParser().parseFromString((await r.text()).replace(/<script[\s\S]*?<\/script>/gi, ''), 'text/html');
  }
  /** Blocs proposés à ce profil : [{ id, src }] lus dans la page /dashboard. */
  async function blocsDuProfil() {
    const ici = location.pathname === '/dashboard' ? document : await html('/dashboard');
    let cadres = [...ici.querySelectorAll('turbo-frame[id][src]')];
    if (!cadres.length && ici === document) cadres = [...(await html('/dashboard')).querySelectorAll('turbo-frame[id][src]')];
    return cadres.filter((f) => /\/dashboards\//.test(f.getAttribute('src'))).map((f) => { const u = new URL(f.getAttribute('src'), location.origin); return { id: f.id, src: u.pathname + u.search }; });
  }
  /** Un bloc tel qu'Ulyss le sert → { id, titre, total, colonnes: [{nom, genre}], lignes: [{ste, couleur, href, dossier, cellules}] } */
  function lireBloc(id, doc) {
    const f = doc.querySelector('turbo-frame#' + CSS.escape(id)) || doc;
    const h = f.querySelector('h3, .text-sub-title, h2'), brut = propre(h ? h.textContent : id), m = brut.match(/^(.*?)\s*\((\d+)\)\s*$/);
    const table = f.querySelector('table'), noms = table ? [...table.querySelectorAll('thead th')].map((th) => propre(th.textContent)) : [];
    const genre = (n) => { const x = n.toLowerCase(); return /^(structure|strc\.?|ste)$/.test(x) ? 'ste' : /montant|prix|tarif/.test(x) ? 'montant' : /volume/.test(x) ? 'nombre' : /état/.test(x) ? 'etat' : /collaborateurs/.test(x) ? 'suivi' : /^type$/.test(x) ? 'type' : /numéro/.test(x) ? 'numero' : /date/.test(x) ? 'date' : /client/.test(x) ? 'client' : x === '' ? 'lien' : 'texte'; };
    const colonnes = noms.map((n) => ({ nom: n, genre: genre(n) }));
    const lignes = table ? [...table.querySelectorAll('tbody tr')].map((tr) => {
      const a = [...tr.querySelectorAll('a[href]')].pop(), href = a ? a.getAttribute('href') : '', l = { ste: '', couleur: '', href, dossier: (href.match(/\/contracts\/(\d+)/) || [])[1] || '', cellules: [] };
      [...tr.cells].forEach((td, i) => {
        const g = (colonnes[i] || {}).genre || 'texte';
        if (g === 'ste') { const b = td.querySelector('.badge') || td; l.ste = propre(b.textContent).toUpperCase(); l.couleur = (b.getAttribute && (b.getAttribute('style') || '').match(/background(?:-color)?:\s*([^;]+)/) || [])[1] || ''; l.cellules.push(null); return; }
        if (g === 'lien') { l.cellules.push(null); return; }
        if (g === 'suivi') { l.cellules.push({ puces: [...td.querySelectorAll('.tooltip')].map((d) => { const t = d.querySelector('.tooltiptext'); return [propre([...d.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')), t ? propre(t.textContent) : '']; }).filter((p) => p[0]) }); return; }
        if (g === 'etat') { const b = td.querySelector('.badge'); l.cellules.push({ t: propre(td.textContent), ton: b && /new/.test(b.className) ? 'neuf' : b && /pending|waiting/.test(b.className) ? 'attente' : b && /done|closed|ended/.test(b.className) ? 'fini' : '' }); return; }
        l.cellules.push({ t: propre(td.textContent) });
        if (g === 'numero' && !l.ste) { const n = propre(td.textContent).match(/^[A-Z]{2,5}?([FLB])\d{4}-\d{3}/); if (n) l.ste = LETTRES[n[1]]; }
      });
      if (!l.ste && l.dossier && STES[societes[l.dossier]]) l.ste = societes[l.dossier];
      return l;
    }) : [];
    return { id, titre: m ? m[1] : brut, total: m ? +m[2] : lignes.length, colonnes, lignes };
  }
  /** Société des lignes qui n'en ont pas : une lecture par dossier, 2 à la fois, gardée sur le poste. */
  let recherche = null;
  function chercherSocietes(blocs, redessiner) {
    const manquants = () => [...new Set(blocs.flatMap((b) => b.lignes).filter((l) => !l.ste && l.dossier && !societes[l.dossier]).map((l) => l.dossier))];
    if (recherche || !manquants().length) return;
    const poser = () => { blocs.forEach((b) => b.lignes.forEach((l) => { if (!l.ste && STES[societes[l.dossier]]) l.ste = societes[l.dossier]; })); garderStes(); redessiner(); };
    recherche = (async () => {
      if (manquants().length >= 5 && blocs.some((b) => /parking_decrees/.test(b.id))) {
        try { (await html('/parking_decrees')).querySelectorAll('tbody tr').forEach((tr) => { const s = tr.cells[1] ? propre(tr.cells[1].textContent).toUpperCase() : '', id = (tr.innerHTML.match(/contracts\/(\d+)/) || [])[1]; if (id && STES[s]) societes[id] = s; }); poser(); } catch (e) { /* on passera par les dossiers */ }
      }
      const file = manquants().slice(0, 150); let n = 0;
      const ouvrier = async () => { while (file.length && ecran) { const id = file.shift(); try { const r = await fetch('/contracts/' + id + '/documents', { credentials: 'same-origin' }); const t = r.ok ? await r.text() : ''; societes[id] = LETTRES[(t.match(/DGT[CD]([A-Z])\d{4}-\d{3}/) || [])[1]] || '?'; } catch (e) { return; } if (++n % 6 === 0) poser(); } };
      await Promise.all([ouvrier(), ouvrier()]); poser();
    })().finally(() => { recherche = null; });
  }

  // ---------------------------------------------------------------------------
  // Écran
  // ---------------------------------------------------------------------------
  const CSS_ECRAN = `
    :host{all:initial} *{box-sizing:border-box}
    .page{position:fixed;top:0;right:0;bottom:0;background:#eef1fa;overflow:auto;z-index:900;font-family:Manrope,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1f2a44;font-size:13px;padding:26px 32px 48px;scroll-behavior:smooth}
    .haut{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:18px}
    h1{margin:0;font-size:24px;font-weight:800;color:#111a66;letter-spacing:-.01em} .sous{color:#6b7392;margin-top:4px}
    .outils{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .seg{display:inline-flex;background:#fff;border-radius:12px;padding:3px;box-shadow:0 1px 2px rgba(17,26,102,.06)}
    .seg button{border:0;background:none;font:700 12.5px Manrope,system-ui,sans-serif;color:#4a5578;padding:7px 12px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
    .seg button i{width:8px;height:8px;border-radius:50%} .seg button[aria-pressed=true]{background:#111a66;color:#fff}
    .btn{border:0;background:#fff;color:#111a66;font:700 12.5px Manrope,system-ui,sans-serif;border-radius:12px;padding:10px 14px;cursor:pointer;box-shadow:0 1px 2px rgba(17,26,102,.06)} .btn[disabled]{opacity:.5;cursor:default}
    .tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:12px;margin-bottom:8px}
    .tuile{background:#fff;border:0;border-radius:14px;padding:13px 14px;text-align:left;cursor:pointer;box-shadow:0 1px 3px rgba(17,26,102,.06);font-family:inherit;border-top:3px solid var(--c);display:flex;flex-direction:column;gap:2px;min-width:0}
    .tuile b{font-size:24px;font-weight:800;color:#111a66;letter-spacing:-.02em;line-height:1.1} .tuile span{font-size:12px;font-weight:600;color:#56608a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .tuile:hover{box-shadow:0 4px 14px rgba(17,26,102,.12)} .tuile.zero b{color:#b3bad2}
    .theme{display:flex;align-items:center;gap:10px;margin:26px 0 12px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#56608a} .theme i{width:22px;height:3px;border-radius:2px;background:var(--c)} .theme::after{content:'';flex:1;height:1px;background:#dfe4f3}
    .blocs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:14px;align-items:start}
    .carte{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(17,26,102,.06);min-width:0;overflow:hidden;scroll-margin-top:16px}
    .tete{display:flex;align-items:center;gap:12px;padding:16px 20px 12px}
    .ico{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;flex:none;color:var(--c);background:color-mix(in srgb,var(--c) 12%,#fff)}
    h2{margin:0;font-size:15px;font-weight:800;color:#111a66;flex:1;min-width:0;line-height:1.3}
    .nb{font-size:13px;font-weight:800;color:var(--c);background:color-mix(in srgb,var(--c) 12%,#fff);border-radius:999px;padding:4px 11px;white-space:nowrap}
    .liste{max-height:372px;overflow:auto;padding:0 8px 8px}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th{position:sticky;top:0;background:#fff;text-align:left;font-size:10.5px;font-weight:800;color:#8088a8;text-transform:uppercase;letter-spacing:.05em;padding:6px 10px 8px;white-space:nowrap;z-index:1}
    td{padding:9px 10px;border-top:1px solid #eef1fa;vertical-align:middle;line-height:1.35}
    tbody tr{cursor:pointer} tbody tr:hover td{background:#f6f8fe} tbody tr:hover td:first-child{border-radius:10px 0 0 10px} tbody tr:hover td:last-child{border-radius:0 10px 10px 0}
    .d{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums} th.d{text-align:right} .date,.numero{white-space:nowrap} .client{font-weight:700;color:#111a66} .numero{font-weight:700;font-variant-numeric:tabular-nums}
    .neg{color:#b42318;font-weight:700} .montant{font-weight:700}
    .ste{display:inline-block;min-width:38px;text-align:center;font-size:10.5px;font-weight:800;color:#fff;border-radius:999px;padding:3px 8px;letter-spacing:.03em} .ste.vide{background:#eef1fa;color:#b3bad2}
    .pil{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;padding:3px 10px;background:#f1f3f8;color:#4a5578;white-space:nowrap} .pil.neuf{background:#e6eeff;color:#1d4fd7} .pil.attente{background:#fff1dc;color:#b45309} .pil.fini{background:#eaf5ec;color:#22693a}
    .puces{display:flex;gap:4px;flex-wrap:wrap} .puces span{font-size:10.5px;font-weight:800;color:#111a66;background:#e9edfb;border-radius:999px;padding:3px 7px;white-space:nowrap}
    .va{width:28px;text-align:right;color:#b3bad2;font-size:16px} tbody tr:hover .va{color:#111a66} .va a{color:inherit;text-decoration:none}
    .rien{padding:26px 20px 30px;text-align:center;color:#8088a8} .rien b{display:block;color:#22693a;font-size:14px;margin-bottom:2px}
    .pied{padding:8px 20px 12px;font-size:11.5px;color:#8088a8;border-top:1px solid #eef1fa}
    .msg{background:#fff;border-radius:16px;padding:40px 20px;text-align:center;color:#6b7392;line-height:1.7} .err{color:#b42318}
  `;
  function el(nom, attrs = {}, ...enfants) {
    const n = document.createElement(nom);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) n.setAttribute(k, v); }
    enfants.flat().forEach((e) => { if (e !== null && e !== undefined && e !== false) n.append(e instanceof Node ? e : document.createTextNode(String(e))); });
    return n;
  }
  const icone = (id) => { const d = document.createElement('div'); d.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONES[id] || ICONES['']}</svg>`; return d.firstChild; };

  let ecran = null, blocs = null, filtre = '', message = '', quand = null, enCharge = false;
  const themeDe = (id) => THEMES.find((t) => t[2].indexOf(id) >= 0) || ['Autres', '#56608a', []];
  function carte(b) {
    const c = themeDe(b.id)[1], vues = b.lignes.filter((l) => !filtre || l.ste === filtre), avecSte = b.lignes.some((l) => l.ste) || b.lignes.some((l) => l.dossier);
    const cols = b.colonnes.map((col, i) => ({ ...col, i })).filter((col) => col.genre !== 'ste' && col.genre !== 'lien');
    const droite = (g) => g === 'montant' || g === 'nombre';
    const cellule = (col, x) => {
      if (!x) return el('td', {});
      if (col.genre === 'suivi') return el('td', {}, el('div', { class: 'puces' }, x.puces.map((p) => el('span', { title: p[1] || null }, p[0]))));
      if (col.genre === 'etat') return el('td', {}, x.t ? el('span', { class: 'pil ' + x.ton }, x.t) : '');
      if (col.genre === 'type') return el('td', {}, x.t ? el('span', { class: 'pil' }, x.t) : '');
      return el('td', { class: (droite(col.genre) ? 'd ' : '') + col.genre + (col.genre === 'montant' && /^\s*[-−]/.test(x.t) ? ' neg' : '') }, x.t);
    };
    const aller = (l) => (e) => { if (!l.href || (e.target.closest && e.target.closest('a'))) return; if (e.ctrlKey || e.metaKey) window.open(l.href, '_blank'); else location.href = l.href; };
    return el('section', { class: 'carte', id: 'bloc-' + b.id, style: '--c:' + c },
      el('div', { class: 'tete' }, el('div', { class: 'ico' }, icone(b.id)), el('h2', {}, b.titre), el('span', { class: 'nb', title: filtre ? vues.length + ' pour ' + filtre + ' sur ' + b.total : null }, filtre ? vues.length + ' / ' + b.total : b.total)),
      b.erreur ? el('div', { class: 'rien err' }, 'Bloc illisible : ' + b.erreur + '.') : !vues.length ? el('div', { class: 'rien' }, el('b', {}, filtre && b.lignes.length ? 'Rien pour ' + filtre : 'Rien à traiter'), filtre && b.lignes.length ? b.total + ' ligne' + (b.total > 1 ? 's' : '') + ' pour les autres sociétés ou sans société connue.' : 'Ce bloc est vide dans Ulyss.') :
        el('div', { class: 'liste' }, el('table', {},
          el('thead', {}, el('tr', {}, avecSte ? el('th', {}, 'Ste') : null, cols.map((col) => el('th', { class: droite(col.genre) ? 'd' : '' }, col.nom)), el('th', {}))),
          el('tbody', {}, vues.map((l) => el('tr', { onclick: aller(l), title: l.href ? 'Ouvrir dans Ulyss' : null },
            avecSte ? el('td', {}, STES[l.ste] ? el('span', { class: 'ste', style: 'background:' + STES[l.ste] }, l.ste) : l.ste ? el('span', { class: 'ste', style: 'background:' + (l.couleur || '#56608a') }, l.ste) : el('span', { class: 'ste vide', title: 'Société en cours de lecture' }, '···')) : null,
            cols.map((col) => cellule(col, l.cellules[col.i])),
            el('td', { class: 'va' }, l.href ? el('a', { href: l.href, 'aria-label': 'Ouvrir dans Ulyss' }, '›') : '')))))),
      b.lignes.length !== b.total && !b.erreur ? el('div', { class: 'pied' }, b.lignes.length + ' lignes affichées par Ulyss sur ' + b.total + '.') : null);
  }
  function dessiner() {
    if (!ecran) return;
    const zone = ecran.shadowRoot.querySelector('.page'); if (!zone) return;
    const haut = zone.scrollTop, defil = {}; zone.querySelectorAll('.carte').forEach((c) => { const l = c.querySelector('.liste'); if (l) defil[c.id] = l.scrollTop; });
    const bMaj = el('button', { class: 'btn', onclick: () => charger(), title: 'Relire le tableau de bord d\'Ulyss' }, enCharge ? 'Lecture…' : 'Actualiser'); bMaj.disabled = enCharge;
    const puce = (v, t) => el('button', { 'aria-pressed': String(filtre === v), onclick: () => { filtre = v; dessiner(); } }, v ? el('i', { style: 'background:' + STES[v] }) : null, t);
    const tete = el('div', { class: 'haut' },
      el('div', {}, el('h1', {}, 'Tableau de bord'), el('div', { class: 'sous' }, quand ? 'Mêmes informations que le tableau de bord d\'Ulyss · lu à ' + ('0' + quand.getHours()).slice(-2) + ' h ' + ('0' + quand.getMinutes()).slice(-2) : 'Mêmes informations que le tableau de bord d\'Ulyss')),
      el('div', { class: 'outils' }, el('div', { class: 'seg' }, puce('', 'Toutes'), puce('FRA', 'FRA'), puce('LDL', 'LDL'), puce('BD', 'BD')), bMaj));
    if (!blocs || !blocs.length) { zone.replaceChildren(tete, el('div', { class: 'msg' + (message ? ' err' : '') }, message || (blocs ? 'Ulyss ne propose aucun bloc à ce profil.' : 'Lecture du tableau de bord d\'Ulyss…'))); return; }
    const ordre = [], reste = blocs.filter((b) => !THEMES.some((t) => t[2].indexOf(b.id) >= 0));
    THEMES.forEach((t) => { const l = t[2].map((id) => blocs.find((b) => b.id === id)).filter(Boolean); if (l.length) ordre.push([t[0], t[1], l]); });
    if (reste.length) ordre.push(['Autres', '#56608a', reste]);
    const nb = (b) => (filtre ? b.lignes.filter((l) => l.ste === filtre).length : b.total);
    zone.replaceChildren(tete,
      el('div', { class: 'tuiles' }, ordre.flatMap((t) => t[2].map((b) => el('button', { class: 'tuile' + (nb(b) ? '' : ' zero'), style: '--c:' + t[1], title: b.titre, onclick: () => { const c = zone.querySelector('#' + CSS.escape('bloc-' + b.id)); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, el('b', {}, nb(b)), el('span', {}, COURTS[b.id] || b.titre))))),
      ...ordre.flatMap((t) => [el('div', { class: 'theme', style: '--c:' + t[1] }, el('i', {}), t[0]), el('div', { class: 'blocs' }, t[2].map(carte))]));
    zone.scrollTop = haut; Object.keys(defil).forEach((id) => { const l = zone.querySelector('#' + CSS.escape(id) + ' .liste'); if (l) l.scrollTop = defil[id]; });
  }
  async function charger() {
    if (enCharge) return; enCharge = true; message = ''; dessiner();
    try {
      const liste = await blocsDuProfil(), lus = new Array(liste.length); let i = 0;
      const ouvrier = async () => { while (i < liste.length) { const n = i++, b = liste[n]; try { lus[n] = lireBloc(b.id, await html(b.src, b.id)); } catch (e) { lus[n] = { id: b.id, titre: COURTS[b.id] || b.id, total: 0, colonnes: [], lignes: [], erreur: String(e.message || e) }; } } };
      await Promise.all([ouvrier(), ouvrier(), ouvrier()]);
      blocs = lus; quand = new Date();
    } catch (e) { message = 'Tableau de bord d\'Ulyss illisible : ' + (e.message || e) + '.'; if (!blocs) blocs = null; }
    enCharge = false; dessiner();
    if (blocs) chercherSocietes(blocs, dessiner);
  }
  function caler() { if (!ecran) return; const sb = document.getElementById('global-sidebar'), zone = ecran.shadowRoot.querySelector('.page'); if (zone) zone.style.left = (sb ? Math.round(sb.getBoundingClientRect().right) : 0) + 'px'; }
  let veille = null;
  function monter() {
    if (ecran && ecran.isConnected) return;
    ecran = el('div', { id: ID_ECRAN }); document.body.append(ecran);
    ecran.attachShadow({ mode: 'open' }).append(el('style', {}, CSS_ECRAN), el('div', { class: 'page', role: 'main', 'aria-label': 'Dashboard V2' }));
    caler(); window.addEventListener('resize', caler);
    const sb = document.getElementById('global-sidebar'); if (sb && window.ResizeObserver) { veille = new ResizeObserver(caler); veille.observe(sb); }
    dessiner(); charger();
  }
  function demonter() { if (veille) { veille.disconnect(); veille = null; } window.removeEventListener('resize', caler); if (ecran) { ecran.remove(); ecran = null; } const e = document.getElementById(ID_ENTREE); if (e) e.classList.remove('active'); }
  function suivreAdresse() { if (location.hash === ANCRE) { monter(); const e = document.getElementById(ID_ENTREE); if (e) e.classList.add('active'); } else if (ecran) demonter(); }
  /** Entrée de la barre latérale, juste sous « Dashboard ». */
  function insererEntree() {
    if (document.getElementById(ID_ENTREE)) return;
    const zone = document.querySelector('#global-sidebar .discret-scroll') || document.getElementById('global-sidebar');
    const liens = zone ? [...zone.querySelectorAll(':scope > a.sidebar-link')] : [];
    if (!liens.length) return;
    const r = document.createElement('a');
    r.id = ID_ENTREE; r.href = ANCRE; r.className = 'sidebar-link';
    r.title = 'Dashboard V2 : le tableau de bord d\'Ulyss, remis en forme (Extension Ulyss)';
    r.innerHTML = '<div class="text-3xl mr-3.75"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" style="display:block;margin:3px 0"><rect x="4" y="4" width="7" height="9" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/></svg></div><div class="reductible">Dashboard V2</div>';
    r.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (location.hash !== ANCRE) history.pushState(history.state, '', location.pathname + location.search + ANCRE); suivreAdresse(); });
    liens[0].insertAdjacentElement('afterend', r);
    zone.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a.sidebar-link'); if (a && a.id !== ID_ENTREE && ecran) { if (!/^ext-ulyss-/.test(a.id)) history.replaceState(history.state, '', location.pathname + location.search); demonter(); } }, true);
  }
  if (window.__extUlyssDashboard2Essai) Object.assign(window.__extUlyssDashboard2Essai, { lireBloc });
  const poser = () => { insererEntree(); suivreAdresse(); };
  document.addEventListener('turbo:load', poser);
  window.addEventListener('hashchange', suivreAdresse); window.addEventListener('popstate', suivreAdresse);
  let prevu = false;
  new MutationObserver(() => { if (prevu) return; prevu = true; requestAnimationFrame(() => { prevu = false; insererEntree(); }); }).observe(document.documentElement, { childList: true, subtree: true });
  poser();
})();
