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
 *  - Les six profils d'Ulyss (relevés en production le 28/11/2026) : Assistante, Direction, Commercial, Exploitation,
 *    Comptabilité, Stockage — lus dans les liens « dashboard_scope » du tableau de bord, donc seuls ceux qu'Ulyss propose à
 *    l'utilisateur apparaissent. Le filtre par société est celui d'Ulyss (« structure_id ») : il vaut aussi pour les graphiques.
 *  - Trois sortes de blocs : listes (tableaux), chiffres clés, graphiques (barres empilées, courbes, anneaux) redessinés à
 *    partir des données qu'Ulyss met dans la page. Les menus d'un graphique (semaine / mois, CA / nombre / volume, dépôt, année)
 *    sont repris : ils relisent le bloc avec les mêmes paramètres qu'Ulyss.
 *  - Le bandeau des compteurs reste en haut de l'écran pendant le défilement : un clic mène au bloc.
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
    ['Chiffres', '#111a66', ['in-progress-figures', 'sales-figures', 'cumulative-sales-figures', 'cumulative-self-stockage-figures', 'conversion-rate']],
    ['Relation client', '#1d4fd7', ['communication-requests', 'after_sales-requests']],
    ['Devis et dossiers', '#be185d', ['proposals-list', 'to_be_processed-contracts', 'follow_up-contracts']],
    ['Stationnement', '#7c3aed', ['waiting_authorizations-parking_decrees', 'authorizations_needed-parking_decrees']],
    ['Exploitation', '#0f766e', ['need_planning-contracts', 'movings-to-plan', 'movings-to-store', 'external-needs', 'validated_waiting-contracts', 'validities']],
    ['Personnel', '#0369a1', ['current-unavailabilities', 'indisponibilities', 'temporary-workers']],
    ['Facturation', '#b45309', ['late_payment-contracts', 'manual-invoices']],
    ['Stockage', '#4d7c0f', ['furniture-storage-occupation-rates', 'self-storage-occupation-rates']],
  ];
  const COURTS = { 'communication-requests': 'Échanges client', 'after_sales-requests': 'SAV', 'waiting_authorizations-parking_decrees': 'Autorisations à demander', 'authorizations_needed-parking_decrees': 'Arrêtés attendus', 'need_planning-contracts': 'Devis à planifier', 'external-needs': 'Besoins externes', 'validated_waiting-contracts': 'Validés en attente', 'late_payment-contracts': 'Règlements en retard', 'manual-invoices': 'Factures à envoyer', 'in-progress-figures': 'En cours', 'sales-figures': 'Chiffre d\'affaires', 'cumulative-sales-figures': 'CA cumulé', 'cumulative-self-stockage-figures': 'CA self-stockage', 'conversion-rate': 'Transformation', 'proposals-list': 'Devis acceptés', 'to_be_processed-contracts': 'Dossiers à traiter', 'follow_up-contracts': 'Dossiers à relancer', 'movings-to-plan': 'À planifier', 'movings-to-store': 'À placer au GM', 'validities': 'Validités', 'current-unavailabilities': 'Arrêts en cours', 'indisponibilities': 'Absences', 'temporary-workers': 'Intérim', 'furniture-storage-occupation-rates': 'Garde-meuble', 'self-storage-occupation-rates': 'Self-stockage' };
  const NOMS_STE = { 'fraisseix déménagements': 'FRA', 'les déménageurs limousins': 'LDL', 'bardon déménagements': 'BD', 'fraisseix libre stockage': 'FLS', 'sas limo dem': 'LIM' };
  const MOIS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
  const CLE_CHOIX = 'ext-ulyss-dashboard2';
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
  /** Tableau de bord d'un profil : { scope, profils: [[scope, nom]], structures: [[id, nom]], cadres: [{ id, src, large }] }. */
  async function profilUlyss(scope, structure) {
    const q = new URLSearchParams(); if (scope) q.set('dashboard_scope', scope); if (structure) q.set('structure_id', structure); if (scope || structure) q.set('view_option', 'small');
    const d = await html('/dashboard' + (String(q) ? '?' + q : ''));
    const liens = [...d.querySelectorAll('a[href*="dashboard_scope"]')].map((a) => [new URL(a.getAttribute('href'), location.origin).searchParams, propre(a.textContent)]);
    const profils = [...new Map(liens.filter((l) => !l[0].get('structure_id') && !/colonnes|^toutes$/i.test(l[1])).map((l) => [l[0].get('dashboard_scope'), l[1]])).entries()];
    const structures = [...new Map(liens.filter((l) => l[0].get('structure_id')).map((l) => [l[0].get('structure_id'), l[1]])).entries()];
    const courant = (liens.find((l) => l[0].get('structure_id')) || liens.find((l) => /^toutes$/i.test(l[1])) || [new URLSearchParams()])[0].get('dashboard_scope') || scope || '';
    const cadres = [...d.querySelectorAll('turbo-frame[id][src]')].filter((f) => /\/dashboards\//.test(f.getAttribute('src'))).map((f) => { const u = new URL(f.getAttribute('src'), location.origin); return { id: f.id, src: u.pathname + u.search, large: /col-span-4/.test(f.className) }; });
    return { scope: courant, profils, structures, cadres };
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
    // Chiffres clés (libellé en capitales + valeur), gros chiffre du bloc, graphiques et menus : lus tels qu'Ulyss les sert.
    const chiffres = [...f.querySelectorAll('.uppercase.font-bold')].map((e) => { const v = e.nextElementSibling, x = v && v.nextElementSibling; return v ? { nom: propre(e.textContent), valeur: propre(v.textContent), rouge: /red/.test(v.className), plus: x ? propre([...x.childNodes].map((n) => n.textContent).join(' ')) : '' } : null; }).filter(Boolean);
    const g = [...f.querySelectorAll('.text-big-title')].filter((e) => !/^H1$/.test(e.tagName))[0];
    let gros = '', note = '';
    if (g) { gros = propre(g.textContent); let n = g.nextSibling; while (n) { note += ' ' + n.textContent; n = n.nextSibling; } note = propre(note); }
    const graphiques = [...f.querySelectorAll('[data-controller~="chart"]')].map((e) => { try { return { type: e.dataset.type || '', pas: e.dataset.timeStep || '', donnees: JSON.parse(e.dataset.data || '{}') }; } catch (x) { return null; } }).filter((x) => x && Array.isArray(x.donnees.datasets));
    const menus = [...f.querySelectorAll('.dropdown')].map((d) => { const b = d.querySelector(':scope > a, :scope > button'); return { courant: propre(b ? b.textContent : ''), choix: [...d.querySelectorAll('.dropdown-content a[href]')].map((a) => [propre(a.textContent), a.getAttribute('href')]) }; }).filter((x) => x.choix.length);
    const figure = !table && (chiffres.length || graphiques.length);
    return { id, titre: m ? m[1] : (h ? brut : COURTS[id] || id), total: m ? +m[2] : (table ? lignes.length : null), colonnes, lignes, chiffres: table ? [] : chiffres, gros, note, graphiques, menus, figure: !!figure, table: !!table };
  }
  /** Société des lignes qui n'en ont pas : une lecture par dossier, 2 à la fois, gardée sur le poste. */
  let recherche = null;
  function chercherSocietes(liste, redessiner) {
    const manquants = () => [...new Set(liste.flatMap((b) => b.lignes || []).filter((l) => !l.ste && l.dossier && !societes[l.dossier]).map((l) => l.dossier))];
    if (recherche || !manquants().length) return;
    const poser = () => { liste.forEach((b) => b.lignes.forEach((l) => { if (!l.ste && STES[societes[l.dossier]]) l.ste = societes[l.dossier]; })); garderStes(); redessiner(); };
    recherche = (async () => {
      if (manquants().length >= 5 && liste.some((b) => /parking_decrees/.test(b.id))) {
        try { (await html('/parking_decrees')).querySelectorAll('tbody tr').forEach((tr) => { const s = tr.cells[1] ? propre(tr.cells[1].textContent).toUpperCase() : '', id = (tr.innerHTML.match(/contracts\/(\d+)/) || [])[1]; if (id && STES[s]) societes[id] = s; }); poser(); } catch (e) { /* on passera par les dossiers */ }
      }
      const file = manquants().slice(0, 150); let n = 0;
      const ouvrier = async () => { while (file.length && ecran) { const id = file.shift(); try { const r = await fetch('/contracts/' + id + '/documents', { credentials: 'same-origin' }); const t = r.ok ? await r.text() : ''; societes[id] = LETTRES[(t.match(/DGT[CD]([A-Z])\d{4}-\d{3}/) || [])[1]] || '?'; } catch (e) { return; } if (++n % 6 === 0) poser(); } };
      await Promise.all([ouvrier(), ouvrier()]); poser();
    })().finally(() => { recherche = null; if (ecran && blocs && blocs !== liste) chercherSocietes(blocs, redessiner); });
  }

  // ---------------------------------------------------------------------------
  // Écran
  // ---------------------------------------------------------------------------
  const CSS_ECRAN = `
    :host{all:initial} *{box-sizing:border-box}
    .page{position:fixed;top:0;right:0;bottom:0;background:#eef1fa;overflow:auto;z-index:900;font-family:Manrope,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1f2a44;font-size:13px;padding:26px 32px 70vh}
    .haut{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:18px}
    h1{margin:0;font-size:24px;font-weight:800;color:#111a66;letter-spacing:-.01em} .sous{color:#6b7392;margin-top:4px}
    .outils{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .seg{display:inline-flex;background:#fff;border-radius:12px;padding:3px;box-shadow:0 1px 2px rgba(17,26,102,.06)}
    .seg button{border:0;background:none;font:700 12.5px Manrope,system-ui,sans-serif;color:#4a5578;padding:7px 12px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
    .seg button i{width:8px;height:8px;border-radius:50%} .seg button[aria-pressed=true]{background:#111a66;color:#fff}
    .btn{border:0;background:#fff;color:#111a66;font:700 12.5px Manrope,system-ui,sans-serif;border-radius:12px;padding:10px 14px;cursor:pointer;box-shadow:0 1px 2px rgba(17,26,102,.06)} .btn[disabled]{opacity:.5;cursor:default}
    .onglets{display:inline-flex;background:#fff;border-radius:14px;padding:4px;box-shadow:0 1px 2px rgba(17,26,102,.06);margin-bottom:14px;flex-wrap:wrap}
    .onglets button{border:0;background:none;font:700 13px Manrope,system-ui,sans-serif;color:#4a5578;padding:9px 16px;border-radius:10px;cursor:pointer} .onglets button[aria-selected=true]{background:#111a66;color:#fff}
    select{border:0;background:#fff;border-radius:12px;padding:9px 12px;font:700 12.5px Manrope,system-ui,sans-serif;color:#1f2a44;box-shadow:0 1px 2px rgba(17,26,102,.06);cursor:pointer;max-width:220px}
    .bandeau{position:sticky;top:-26px;z-index:20;background:#eef1fa;margin:0 -32px;padding:10px 32px 10px;transition:box-shadow .15s} .bandeau.colle{box-shadow:0 8px 16px -10px rgba(17,26,102,.28)}
    .tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px}
    .tuile.ici{background:#111a66} .tuile.ici b,.tuile.ici span{color:#fff}
    .large{grid-column:1/-1}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0;padding:6px 8px 14px} .stat{padding:8px 16px;border-left:1px solid #eef1fa} .stat:first-child{border-left:0}
    .stat .n{font-size:11px;font-weight:800;color:#8088a8;text-transform:uppercase;letter-spacing:.05em} .stat .v{font-size:26px;font-weight:800;color:#111a66;letter-spacing:-.02em;margin:4px 0 2px} .stat .v.rouge{color:#b42318} .stat .p{font-size:12px;color:#6b7392}
    .gros{padding:0 20px 4px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap} .gros b{font-size:26px;font-weight:800;color:#111a66;letter-spacing:-.02em} .gros span{font-size:12.5px;color:#6b7392}
    .menus{display:flex;gap:6px;flex-wrap:wrap} .menus select{background:#f1f3f8;box-shadow:none;padding:6px 8px;font-size:12px;border-radius:9px}
    .graph{padding:6px 16px 4px} .leg{display:flex;align-items:center;gap:6px 16px;flex-wrap:wrap;font-size:12px;color:#4a5578;padding:4px 20px 16px} .leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px} .leg b{color:#111a66}
    .ans{margin-left:auto;position:relative;font-size:12px} .ans summary{cursor:pointer;list-style:none;font-weight:700;color:#4a5578;background:#f1f3f8;border-radius:9px;padding:4px 10px;user-select:none} .ans summary::-webkit-details-marker{display:none} .ans summary::after{content:' ▾'} .ans[open] summary{background:#111a66;color:#fff}
    .ans > div{position:absolute;right:0;bottom:calc(100% + 6px);background:#fff;border-radius:12px;box-shadow:0 10px 28px rgba(17,26,102,.2);padding:8px 12px;display:flex;flex-direction:column;gap:6px;z-index:5;min-width:110px} .ans label{display:flex;align-items:center;gap:8px;font-weight:700;color:#111a66;cursor:pointer;white-space:nowrap}
    .anneau{display:flex;align-items:center;gap:24px;padding:4px 20px 18px;flex-wrap:wrap} .anneau table{width:auto;flex:1;min-width:220px} .anneau td{padding:6px 10px 6px 0;border-top:1px solid #eef1fa} .anneau tr:first-child td{border-top:0} .anneau tbody tr{cursor:default} .anneau tbody tr:hover td{background:none}
    .tuile{background:#fff;border:0;border-radius:14px;padding:10px 12px;text-align:left;cursor:pointer;box-shadow:0 1px 3px rgba(17,26,102,.06);font-family:inherit;border-top:3px solid var(--c);display:flex;flex-direction:column;gap:2px;min-width:0}
    .tuile b{font-size:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800;color:#111a66;letter-spacing:-.02em;line-height:1.1} .tuile span{font-size:12px;font-weight:600;color:#56608a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .tuile:hover{box-shadow:0 4px 14px rgba(17,26,102,.12)} .tuile.zero b{color:#b3bad2}
    .theme{display:flex;align-items:center;gap:10px;margin:26px 0 12px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#56608a} .theme i{width:22px;height:3px;border-radius:2px;background:var(--c)} .theme::after{content:'';flex:1;height:1px;background:#dfe4f3}
    .blocs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:14px;align-items:start}
    .carte{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(17,26,102,.06);min-width:0;overflow:hidden;scroll-margin-top:var(--haut,120px)}
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
    enfants.flat(Infinity).forEach((e) => { if (e !== null && e !== undefined && e !== false) n.append(e instanceof Node ? e : document.createTextNode(String(e))); });
    return n;
  }
  const icone = (id, b) => { const d = document.createElement('div'); d.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONES[id] || (b && b.graphiques && b.graphiques.length ? (b.graphiques[0].type === 'doughnut' ? '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v5"/>' : '<path d="M4 20h16M7 20v-7M12 20V6M17 20v-10"/>') : b && b.chiffres && b.chiffres.length ? '<path d="M4 17l5-5 4 3 7-8"/><path d="M15 7h5v5"/>' : '<path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/>')}</svg>`; return d.firstChild; };

  let ecran = null, blocs = null, message = '', quand = null, enCharge = false, profil = { scope: '', profils: [], structures: [], cadres: [] };
  const choix = lireJson(CLE_CHOIX);   // { scope, ste } : dernier profil et dernière société regardés sur ce poste
  const themeDe = (id) => THEMES.find((t) => t[2].indexOf(id) >= 0) || ['Autres', '#56608a', []];
  const fr = (n, dec) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: dec === undefined ? (Math.abs(n) >= 1000 ? 0 : 2) : dec });
  const court = (n) => { const a = Math.abs(n); return a >= 1e6 ? fr(n / 1e6, 2) + ' M' : a >= 10000 ? fr(n / 1000, 0) + ' k' : fr(n); };
  /** « 350224.65 € » → « 350 225 € » ; tout autre texte est rendu tel quel. */
  /** Nombre en tête d'un texte d'Ulyss (« 350224.65 € », « 123 456,78 € », « 24.5 ») → [nombre, suite] ou null. */
  const nombreDe = (t) => { const x = String(t).trim(); let m = x.match(/^(-?\d+(?:\.\d+)?)\s*(\D*)$/); if (m) return [+m[1], m[2].trim()]; m = x.match(/^(-?\d{1,3}(?:[\s\u00a0\u202f]\d{3})*(?:,\d+)?)\s*(\D*)$/); return m ? [+m[1].replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'), m[2].trim()] : null; };
  const beau = (t) => { const m = nombreDe(t); return m ? fr(m[0]) + (m[1] ? ' ' + m[1] : '') : t; };
  const nomSte = (n) => NOMS_STE[String(n).toLowerCase()] || n;
  const opaque = (c) => (/^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c || '#111a66');
  const dessin = (code, l, h) => { const d = document.createElement('div'); d.innerHTML = `<svg viewBox="0 0 ${l} ${h}" width="100%" style="display:block" xmlns="http://www.w3.org/2000/svg" font-family="Manrope,system-ui,sans-serif">${code}</svg>`; return d.firstChild; };
  const ech = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const abscisse = (n, i) => (n === 12 ? MOIS[i] : 'S' + (i + 1));

  /** Graphique d'Ulyss redessiné : [élément graphique, légende]. */
  // Années affichées sur les graphiques par année (28/11/2026, Guillaume) : l'année en cours et la précédente ; les années
  // antérieures s'ajoutent par le petit menu « Années antérieures » du graphique. Choix gardé tant que l'écran reste ouvert.
  const anneesVues = {}, menuOuvert = {};
  const anDe = (d) => { const a = d.annee !== undefined ? d.annee : d.label; return /^\d{4}$/.test(String(a)) ? +a : null; };
  function menuAnnees(cle, toutes, vues) {
    const anciennes = toutes.slice(0, -2); if (!anciennes.length) return null;
    const d = el('details', { class: 'ans' }, el('summary', {}, 'Années antérieures' + (vues.length > 2 ? ' (' + (vues.length - 2) + ')' : '')),
      el('div', {}, anciennes.slice().reverse().map((a) => { const c = el('input', { type: 'checkbox', onchange: () => { anneesVues[cle] = toutes.filter((x) => (x === a ? c.checked : vues.indexOf(x) >= 0)); dessiner(); } }); c.checked = vues.indexOf(a) >= 0; return el('label', {}, c, String(a)); })));
    d.open = !!menuOuvert[cle]; d.addEventListener('toggle', () => { menuOuvert[cle] = d.open; });
    return d;
  }
  function graphique(g, cle) {
    let D = g.donnees.datasets; const L = 640, H = 230, G = 44, B = 196;
    let choixAns = null;
    if (g.type !== 'doughnut' && D.length && D.every((d) => anDe(d) !== null)) {
      const toutes = [...new Set(D.map(anDe))].sort((a, b) => a - b), vues = (anneesVues[cle] || toutes.slice(-2)).filter((a) => toutes.indexOf(a) >= 0);
      D = D.filter((d) => vues.indexOf(anDe(d)) >= 0).sort((a, b) => anDe(a) - anDe(b));
      choixAns = menuAnnees(cle, toutes, vues);
    }
    if (g.type === 'doughnut') {
      // Ulyss mêle parfois deux lectures dans le même anneau (libre / occupé, puis l'occupé détaillé par société) : le détail est mis à part.
      const tous = D.map((d) => ({ nom: d.label, v: +(d.values || d.data || [0])[0] || 0, c: opaque(d.color) })), parSte = tous.filter((p) => NOMS_STE[String(p.nom).toLowerCase()]), mixte = parSte.length && parSte.length < tous.length;
      const parts = mixte ? tous.filter((p) => parSte.indexOf(p) < 0) : tous, tot = parts.reduce((s, p) => s + p.v, 0) || 1; let a = -Math.PI / 2;
      const arcs = parts.filter((p) => p.v > 0).map((p) => { const b = a + p.v / tot * Math.PI * 2 - 0.0001, gr = b - a > Math.PI ? 1 : 0, pt = (r, t) => (90 + r * Math.cos(t)).toFixed(2) + ' ' + (90 + r * Math.sin(t)).toFixed(2); const ch = `<path d="M${pt(80, a)}A80 80 0 ${gr} 1 ${pt(80, b)}L${pt(52, b)}A52 52 0 ${gr} 0 ${pt(52, a)}Z" fill="${p.c}"><title>${ech(p.nom)} : ${fr(p.v)} (${fr(p.v / tot * 100, 1)} %)</title></path>`; a = b + 0.0001; return ch; }).join('');
      const svg = dessin(arcs + `<text x="90" y="88" text-anchor="middle" font-size="20" font-weight="800" fill="#111a66">${ech(court(tot))}</text><text x="90" y="106" text-anchor="middle" font-size="10" fill="#6b7392">au total</text>`, 180, 180); svg.style.width = '170px'; svg.style.flex = 'none';
      return [el('div', { class: 'anneau' }, svg, el('table', {}, el('tbody', {}, parts.map((p) => el('tr', {}, el('td', {}, el('i', { style: 'display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;background:' + p.c }), p.nom), el('td', { class: 'd montant' }, fr(p.v)), el('td', { class: 'd' }, fr(p.v / tot * 100, 1) + ' %'))), mixte ? [el('tr', {}, el('td', { colspan: '3', style: 'font-size:10.5px;font-weight:800;color:#8088a8;text-transform:uppercase;letter-spacing:.05em;padding-top:12px' }, 'Par société')), parSte.map((p) => el('tr', {}, el('td', {}, el('span', { class: 'ste', style: 'background:' + (STES[nomSte(p.nom)] || p.c) + ';margin-right:8px' }, nomSte(p.nom)), p.nom), el('td', { class: 'd montant' }, fr(p.v)), el('td', { class: 'd' }, fr(p.v / tot * 100, 1) + ' %')))] : null))), null];
    }
    const grille = (max) => [0, 0.5, 1].map((k) => `<line x1="${G}" x2="${L}" y1="${B - k * 170}" y2="${B - k * 170}" stroke="#eef1fa"/><text x="${G - 6}" y="${B - k * 170 + 3.5}" text-anchor="end" font-size="9.5" fill="#8088a8">${ech(court(max * k))}</text>`).join('');
    const etiq = (n, pas) => Array.from({ length: n }, (_, i) => (n <= 12 || i % 4 === 0 ? `<text x="${G + pas * (i + 0.5)}" y="${B + 15}" text-anchor="middle" font-size="9.5" fill="#8088a8">${abscisse(n, i)}</text>` : '')).join('');
    if (g.type === 'stack-bars') {
      const n = Math.max(1, ...D.map((d) => Math.max(0, ...(d.sets || []).map((s) => (s.values || []).length)))), pas = (L - G) / n, lb = Math.max(1, (pas * 0.82) / D.length);
      const somme = (d, i) => (d.sets || []).reduce((s, x) => s + Math.max(0, +x.values[i] || 0), 0), max = Math.max(1, ...D.flatMap((d) => Array.from({ length: n }, (_, i) => somme(d, i))));
      const op = (k) => (D.length === 1 ? 1 : 0.28 + 0.72 * k / (D.length - 1));
      let code = grille(max);
      D.forEach((d, k) => { for (let i = 0; i < n; i++) { let y = B; (d.sets || []).forEach((s) => { const v = Math.max(0, +s.values[i] || 0), h = v / max * 170; if (h <= 0) return; y -= h; code += `<rect x="${(G + pas * i + pas * 0.09 + lb * k).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.8, lb - (lb > 4 ? 1.2 : 0)).toFixed(1)}" height="${h.toFixed(1)}" fill="${opaque(s.color)}" opacity="${op(k).toFixed(2)}"><title>${abscisse(n, i)} ${ech(d.annee)} · ${ech(s.label)} : ${fr(v)}</title></rect>`; }); } });
      const series = [...new Map(D.flatMap((d) => (d.sets || []).map((s) => [s.label, opaque(s.color)]))).entries()];
      return [el('div', { class: 'graph' }, dessin(code + etiq(n, pas), L, H)), el('div', { class: 'leg' }, series.map((s) => el('span', {}, el('i', { style: 'background:' + s[1] }), s[0])), D.map((d, k) => el('span', {}, el('i', { style: 'background:#111a66;opacity:' + op(k) }), el('b', {}, d.annee), d.header ? ' · ' + d.header : '')), choixAns)];
    }
    // « mixed » : une série par année, en courbe ou en barres
    const n = Math.max(1, ...D.map((d) => (d.data || []).length)), pas = (L - G) / n, max = Math.max(1, ...D.flatMap((d) => (d.data || []).map((v) => +v || 0)));
    const barres = D.filter((d) => d.type === 'bar'); let code = grille(max);
    barres.forEach((d, k) => { const lb = (pas * 0.7) / barres.length; (d.data || []).forEach((v, i) => { const h = (+v || 0) / max * 170; code += `<rect x="${(G + pas * i + pas * 0.15 + lb * k).toFixed(1)}" y="${(B - h).toFixed(1)}" width="${Math.max(1, lb - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${opaque(d.color)}"><title>${abscisse(n, i)} ${ech(d.label)} : ${fr(+v || 0)}</title></rect>`; }); });
    D.filter((d) => d.type !== 'bar').forEach((d) => { const pts = (d.data || []).map((v, i) => [G + pas * (i + 0.5), B - (+v || 0) / max * 170, +v || 0]); code += `<polyline points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${opaque(d.color)}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>` + pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#fff" stroke="${opaque(d.color)}" stroke-width="1.8"><title>${abscisse(n, i)} ${ech(d.label)} : ${fr(p[2])}</title></circle>`).join(''); });
    return [el('div', { class: 'graph' }, dessin(code + etiq(n, pas), L, H)), el('div', { class: 'leg' }, D.map((d) => el('span', {}, el('i', { style: 'background:' + opaque(d.color) }), el('b', {}, d.label), d.legendHeader ? ' · ' + beau(d.legendHeader) : '')), choixAns)];
  }
  /** Relit un seul bloc avec les paramètres d'un menu d'Ulyss (semaine / mois, CA / nombre, dépôt, année…). */
  async function relireBloc(b, href, rang, libelle) {
    try {
      const u = new URL(href, location.origin), base = new URL(b.src, location.origin);
      base.searchParams.forEach((v, k) => { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
      const n = lireBloc(b.id, await html(u.pathname + u.search, b.id)); n.src = b.src; n.large = b.large; n.choisi = { ...(b.choisi || {}), [rang]: libelle };
      blocs[blocs.indexOf(b)] = n;
    } catch (e) { b.erreur = String(e.message || e); }
    dessiner();
  }
  function carte(b) {
    const c = themeDe(b.id)[1], avecSte = b.lignes.some((l) => l.ste) || b.lignes.some((l) => l.dossier);
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
    const menus = b.menus && b.menus.length ? el('div', { class: 'menus' }, b.menus.map((m, rang) => { const ici = (b.choisi || {})[rang] || m.courant || 'Choisir'; const s = el('select', { 'aria-label': 'Option du graphique', onchange: () => { s.disabled = true; relireBloc(b, s.value, rang, s.options[s.selectedIndex].textContent); } }, el('option', { value: '' }, ici), m.choix.filter((x) => x[0] !== ici).map((x) => el('option', { value: x[1] }, x[0]))); return s; })) : null;
    let corps;
    if (b.erreur) corps = el('div', { class: 'rien err' }, 'Bloc illisible : ' + b.erreur + '.');
    else if (b.table) corps = !b.lignes.length ? el('div', { class: 'rien' }, el('b', {}, 'Rien à traiter'), 'Ce bloc est vide dans Ulyss.') :
      el('div', { class: 'liste' }, el('table', {},
        el('thead', {}, el('tr', {}, avecSte ? el('th', {}, 'Ste') : null, cols.map((col) => el('th', { class: droite(col.genre) ? 'd' : '' }, col.nom)), el('th', {}))),
        el('tbody', {}, b.lignes.map((l) => el('tr', { onclick: aller(l), title: l.href ? 'Ouvrir dans Ulyss' : null },
          avecSte ? el('td', {}, STES[l.ste] ? el('span', { class: 'ste', style: 'background:' + STES[l.ste] }, l.ste) : l.ste ? el('span', { class: 'ste', style: 'background:' + (l.couleur || '#56608a') }, l.ste) : el('span', { class: 'ste vide', 'data-dossier': l.dossier || null, title: 'Société en cours de lecture' }, '···')) : null,
          cols.map((col) => cellule(col, l.cellules[col.i])),
          el('td', { class: 'va' }, l.href ? el('a', { href: l.href, 'aria-label': 'Ouvrir dans Ulyss' }, '›') : ''))))));
    else corps = [
      b.gros ? el('div', { class: 'gros' }, el('b', {}, beau(b.gros)), el('span', {}, b.note)) : null,
      b.chiffres.length ? el('div', { class: 'stats' }, b.chiffres.map((k) => el('div', { class: 'stat' }, el('div', { class: 'n' }, k.nom), el('div', { class: 'v' + (k.rouge ? ' rouge' : '') }, k.valeur), k.plus ? el('div', { class: 'p' }, k.plus) : null))) : null,
      b.graphiques.flatMap((g, i) => graphique(g, b.id + '/' + i)),
      !b.gros && !b.chiffres.length && !b.graphiques.length ? el('div', { class: 'rien' }, 'Ce bloc ne contient rien que l\'extension sache lire : ouvrez le tableau de bord d\'Ulyss pour le voir.') : null];
    return el('section', { class: 'carte' + (b.large || (b.chiffres.length && !b.graphiques.length) ? ' large' : ''), id: 'bloc-' + b.id, style: '--c:' + c },
      el('div', { class: 'tete' }, el('div', { class: 'ico' }, icone(b.id, b)), el('h2', {}, b.titre), menus, b.total !== null && b.total !== undefined ? el('span', { class: 'nb' }, b.total) : null),
      corps,
      b.table && b.lignes.length !== b.total && !b.erreur ? el('div', { class: 'pied' }, b.lignes.length + ' lignes affichées par Ulyss sur ' + b.total + '.') : null);
  }
  /** Ce que montre la tuile du bandeau : le compteur d'une liste, sinon le chiffre principal du bloc. */
  function resume(b) {
    if (b.total !== null && b.total !== undefined) return String(b.total);
    const t = b.gros || (b.chiffres[0] || {}).valeur || '', m = nombreDe(t);
    if (m && !/^[KM]\b/i.test(m[1])) return court(m[0]) + (m[1] ? (/[kM]$/.test(court(m[0])) ? '' : ' ') + m[1] : '');
    if (t) return t;
    const g = b.graphiques[0]; if (g && g.type === 'doughnut') { const p = g.donnees.datasets.map((d) => +(d.values || [0])[0] || 0), tot = p.reduce((s, v) => s + v, 0); const occ = g.donnees.datasets.filter((d) => /^occup/i.test(d.label)).reduce((s, d) => s + (+(d.values || [0])[0] || 0), 0), princ = g.donnees.datasets.filter((d) => !NOMS_STE[String(d.label).toLowerCase()]).reduce((s, d) => s + (+(d.values || [0])[0] || 0), 0); if (princ && occ && /occupation/.test(b.id)) return fr(occ / princ * 100, 0) + ' %'; }
    return '›';
  }
  /** Badges de société renseignés sur place, sans redessiner l'écran (le défilement n'est pas interrompu). */
  function poserBadges() {
    if (!ecran) return;
    ecran.shadowRoot.querySelectorAll('.ste.vide[data-dossier]').forEach((e) => { const s = societes[e.dataset.dossier]; if (!STES[s]) return; e.className = 'ste'; e.style.background = STES[s]; e.textContent = s; e.removeAttribute('title'); });
  }
  function suivreDefilement() {
    if (!ecran) return; const zone = ecran.shadowRoot.querySelector('.page'), bd = zone && zone.querySelector('.bandeau'); if (!bd) return;
    const seuil = bd.getBoundingClientRect().bottom + 30; let ici = null;
    zone.querySelectorAll('.carte').forEach((c) => { if (c.getBoundingClientRect().top <= seuil) ici = c.id; });
    bd.classList.toggle('colle', zone.scrollTop > 60);
    bd.querySelectorAll('.tuile').forEach((t) => t.classList.toggle('ici', zone.scrollTop > 60 && t.dataset.bloc === ici));
  }
  function dessiner() {
    if (!ecran) return;
    const zone = ecran.shadowRoot.querySelector('.page'); if (!zone) return;
    const haut = zone.scrollTop, defil = {}; zone.querySelectorAll('.carte').forEach((c) => { const l = c.querySelector('.liste'); if (l) defil[c.id] = l.scrollTop; });
    const bMaj = el('button', { class: 'btn', onclick: () => charger(), title: 'Relire le tableau de bord d\'Ulyss' }, enCharge ? 'Lecture…' : 'Actualiser'); bMaj.disabled = enCharge;
    const sSte = el('select', { 'aria-label': 'Société', title: 'Filtre par société d\'Ulyss', onchange: () => { choix.ste = sSte.value; charger(); } }, el('option', { value: '' }, 'Toutes les sociétés'), profil.structures.map((x) => el('option', { value: x[0] }, x[1]))); sSte.value = choix.ste || '';
    const tete = el('div', { class: 'haut' },
      el('div', {}, el('h1', {}, 'Tableau de bord'), el('div', { class: 'sous' }, quand ? 'Mêmes informations que le tableau de bord d\'Ulyss · lu à ' + ('0' + quand.getHours()).slice(-2) + ' h ' + ('0' + quand.getMinutes()).slice(-2) : 'Mêmes informations que le tableau de bord d\'Ulyss')),
      el('div', { class: 'outils' }, profil.structures.length ? sSte : null, bMaj));
    const onglets = profil.profils.length > 1 ? el('div', { class: 'onglets', role: 'tablist', 'aria-label': 'Profil du tableau de bord' }, profil.profils.map((p) => el('button', { role: 'tab', 'aria-selected': String(p[0] === profil.scope), onclick: () => { if (p[0] === profil.scope || enCharge) return; choix.scope = p[0]; blocs = null; zone.scrollTop = 0; charger(); } }, p[1]))) : null;
    if (!blocs || !blocs.length) { zone.replaceChildren(tete, ...(onglets ? [onglets] : []), el('div', { class: 'msg' + (message ? ' err' : '') }, message || (blocs ? 'Ulyss ne propose aucun bloc à ce profil.' : 'Lecture du tableau de bord d\'Ulyss…'))); return; }
    const ordre = [], reste = blocs.filter((b) => !THEMES.some((t) => t[2].indexOf(b.id) >= 0));
    THEMES.forEach((t) => { const l = t[2].map((id) => blocs.find((b) => b.id === id)).filter(Boolean); if (l.length) ordre.push([t[0], t[1], l]); });
    if (reste.length) ordre.push(['Autres', '#56608a', reste]);
    const bandeau = el('div', { class: 'bandeau' }, el('div', { class: 'tuiles' }, ordre.flatMap((t) => t[2].map((b) => el('button', { class: 'tuile' + (resume(b) === '0' ? ' zero' : ''), 'data-bloc': 'bloc-' + b.id, style: '--c:' + t[1], title: b.titre, onclick: () => { const c = zone.querySelector('#' + CSS.escape('bloc-' + b.id)); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, el('b', {}, resume(b)), el('span', {}, COURTS[b.id] || b.titre))))));
    zone.replaceChildren(tete, ...(onglets ? [onglets] : []), bandeau,
      ...ordre.flatMap((t) => [el('div', { class: 'theme', style: '--c:' + t[1] }, el('i', {}), t[0]), el('div', { class: 'blocs' }, t[2].map(carte))]));
    zone.style.setProperty('--haut', (bandeau.offsetHeight + 12) + 'px');
    zone.scrollTop = haut; Object.keys(defil).forEach((id) => { const l = zone.querySelector('#' + CSS.escape(id) + ' .liste'); if (l) l.scrollTop = defil[id]; });
    suivreDefilement();
  }
  async function charger() {
    if (enCharge) return; enCharge = true; message = ''; dessiner();
    try {
      let p = await profilUlyss(choix.scope || '', choix.ste || '');
      // Profil ou société gardés sur le poste mais plus proposés par Ulyss : retour au tableau de bord par défaut.
      if ((choix.scope && !p.profils.some((x) => x[0] === choix.scope)) || (choix.ste && !p.structures.some((x) => x[0] === choix.ste))) { choix.scope = ''; choix.ste = ''; p = await profilUlyss('', ''); }
      profil = { ...p, structures: p.structures.map((x) => [x[0], nomSte(x[1])]) };
      try { localStorage.setItem(CLE_CHOIX, JSON.stringify({ scope: choix.scope || '', ste: choix.ste || '' })); } catch (e) {}
      const liste = p.cadres, lus = new Array(liste.length); let i = 0;
      const ouvrier = async () => { while (i < liste.length) { const n = i++, b = liste[n]; try { lus[n] = lireBloc(b.id, await html(b.src, b.id)); } catch (e) { lus[n] = { id: b.id, titre: COURTS[b.id] || b.id, total: null, colonnes: [], lignes: [], chiffres: [], graphiques: [], menus: [], gros: '', note: '', erreur: String(e.message || e) }; } lus[n].src = b.src; lus[n].large = b.large; } };
      await Promise.all([ouvrier(), ouvrier(), ouvrier()]);
      blocs = lus; quand = new Date();
    } catch (e) { message = 'Tableau de bord d\'Ulyss illisible : ' + (e.message || e) + '.'; }
    enCharge = false; dessiner();
    if (blocs) chercherSocietes(blocs, poserBadges);
  }
  function caler() { if (!ecran) return; const sb = document.getElementById('global-sidebar'), zone = ecran.shadowRoot.querySelector('.page'); if (zone) zone.style.left = (sb ? Math.round(sb.getBoundingClientRect().right) : 0) + 'px'; }
  let veille = null;
  function monter() {
    if (ecran && ecran.isConnected) return;
    ecran = el('div', { id: ID_ECRAN }); document.body.append(ecran);
    ecran.attachShadow({ mode: 'open' }).append(el('style', {}, CSS_ECRAN), el('div', { class: 'page', role: 'main', 'aria-label': 'Dashboard V2' }));
    caler(); window.addEventListener('resize', caler);
    const sb = document.getElementById('global-sidebar'); if (sb && window.ResizeObserver) { veille = new ResizeObserver(caler); veille.observe(sb); }
    let attente = false; ecran.shadowRoot.querySelector('.page').addEventListener('scroll', () => { if (attente) return; attente = true; requestAnimationFrame(() => { attente = false; suivreDefilement(); }); }, { passive: true });
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
