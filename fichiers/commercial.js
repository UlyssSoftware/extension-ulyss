/*
 * Extension Ulyss — écran « Activité commerciale » (28/11/2026, demande de Guillaume). Module RÉSERVÉ : il ne s'allume que
 * poste par poste, avec le code d'accès (réglages de l'extension, colonne « Sur ce poste »).
 *  - Une entrée « Activité commerciale » dans la barre latérale ouvre un ÉCRAN qui occupe la zone de contenu (barre latérale
 *    conservée, adresse « …#activite-commerciale »). Le tableau de bord d'Ulyss n'est ni modifié ni recouvert d'une fenêtre :
 *    toute autre entrée de la barre latérale referme l'écran.
 *  - Ulyss n'a ni export ni historique : une fois par jour, un poste où le module est allumé lit la liste des dossiers de
 *    déménagement (lecture seule, 3 pages à la fois) et dépose sur le serveur commercial/ des chiffres SANS AUCUN NOM. D'un
 *    jour au suivant, le serveur note les changements d'état : c'est ce qui date les signatures.
 *  - Règles de calcul : claude/ulyss-reporting-commercial-modele.md. Déménagements seuls ; le suivi commence au devis ;
 *    signé = Dates à programmer, Attente de groupage, Planning Ok, LV Ok, Réalisé ; perdu = Sans Suite + Devisé de plus de
 *    deux mois ; Brouillon, RDV, Annulé, Clôturé hors périmètre ; un re-devis (_2, _3) = une seule affaire ; période = date de
 *    création du dossier ; un taux porte sur la sélection telle qu'elle est filtrée.
 *  - Les noms des commerciaux ne quittent pas le poste : le serveur ne connaît que leur identifiant Ulyss.
 */
(() => {
  'use strict';
  if (window.__extUlyssActif && !window.__extUlyssActif('commercial')) return;
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const essai = () => !!window.__extUlyssRdvEssai;
  if (window.top !== window || (!HOTES.test(location.hostname) && !essai())) return;
  const ID_ENTREE = 'ext-ulyss-raccourci-commercial', ID_ECRAN = 'ext-ulyss-ecran-commercial', ANCRE = '#activite-commerciale';
  const PEREMPTION_J = 60, RELANCE_J = 20, PARALLELES = 3;
  const ETATS = { 'brouillon': 0, 'rdv': 1, 'devisé': 2, 'dates à programmer': 3, 'planning ok': 4, 'lv ok': 5, 'réalisé': 6, 'annulé': 7, 'clôturé': 8, 'sans suite': 9, 'attente de groupage': 10, 'validé': 11 };
  const SIGNES = [3, 10, 4, 5, 6], HORS = [0, 1, 7, 8, 11];
  const STE = { F: ['FRA', '#0039b3'], L: ['LDL', '#9e1f1f'], B: ['BD', '#f67904'] };
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MOIS_C = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => { try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false }); }); } catch (e) { ok({ ok: false }); } });
  }
  async function serveur(cible, donnees) {
    const r = await demander({ type: 'gc-rdv', cible, donnees: { instance: location.hostname, ...donnees } });
    if (!r || !r.ok) throw new Error(r && r.motif === 'code' ? 'code d\'accès de l\'extension jamais saisi sur ce poste' : (r && r.motif) || 'pas de réponse');
    if (!r.corps) throw new Error('réponse illisible (code ' + r.statut + ') : le dossier « ' + cible + ' » est-il déposé sur le serveur ?');
    if (!r.corps.ok) throw new Error(r.corps.erreur || 'refusé');
    return r.corps;
  }

  // ---------------------------------------------------------------------------
  // Dates et périodes
  // ---------------------------------------------------------------------------
  const iso = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  const jour = (s) => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const ecartJours = (a, b) => Math.round((jour(b) - jour(a)) / 86400000);
  const plus = (s, n) => { const d = jour(s); d.setDate(d.getDate() + n); return iso(d); };
  const lundi = (s) => { const d = jour(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
  function semaineIso(s) { const d = jour(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const j1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - j1) / 86400000 - 3 + ((j1.getDay() + 6) % 7)) / 7); }
  /** Période { debut, fin, nom, avant } : type 's' semaine, 'm' mois, 't' trimestre, 'a' année ; rang 0 = en cours, −1 = précédente… */
  function periode(type, rang, auj) {
    const d = jour(auj);
    if (type === 's') { const l = plus(lundi(auj), 7 * rang); return { debut: l, fin: plus(l, 6), nom: 'Semaine ' + semaineIso(l) + ' (du ' + l.slice(8) + '/' + l.slice(5, 7) + ')', avant: 'à la semaine précédente' }; }
    if (type === 'm') { const a = new Date(d.getFullYear(), d.getMonth() + rang, 1), z = new Date(a.getFullYear(), a.getMonth() + 1, 0); return { debut: iso(a), fin: iso(z), nom: MOIS[a.getMonth()].replace(/^./, (c) => c.toUpperCase()) + ' ' + a.getFullYear(), avant: 'au mois précédent' }; }
    if (type === 't') { const t = Math.floor(d.getMonth() / 3) + rang, a = new Date(d.getFullYear(), t * 3, 1), z = new Date(a.getFullYear(), a.getMonth() + 3, 0); return { debut: iso(a), fin: iso(z), nom: (Math.floor(a.getMonth() / 3) + 1) + (a.getMonth() < 3 ? 'er' : 'e') + ' trimestre ' + a.getFullYear(), avant: 'au trimestre précédent' }; }
    const an = d.getFullYear() + rang; return { debut: an + '-01-01', fin: an + '-12-31', nom: 'Année ' + an, avant: 'à l\'année précédente' };
  }

  // ---------------------------------------------------------------------------
  // Calcul — tout l'écran sort de cette fonction (essayée à part)
  // ---------------------------------------------------------------------------
  /** Un re-devis (_2, _3) est la même affaire : seule la dernière version compte. */
  function affaires(dossiers) {
    const parRacine = {};
    Object.keys(dossiers).forEach((ref) => {
      const m = ref.match(/^(DGT[CD]([A-Z])\d{4}-\d{3})(?:_(\d+))?$/); if (!m || !STE[m[2]]) return;
      const rang = +(m[3] || 1), d = dossiers[ref];
      if (!parRacine[m[1]] || parRacine[m[1]].rang < rang) parRacine[m[1]] = { ref, racine: m[1], rang, s: m[2], c: d.c, t: +d.t || 0, k: +d.k || 0, e: +d.e || 0, h: d.h || [] };
    });
    return Object.values(parRacine);
  }
  const groupe = (a, auj) => HORS.indexOf(a.e) >= 0 ? 'hors' : SIGNES.indexOf(a.e) >= 0 ? 'signe' : a.e === 9 ? 'perdu' : ecartJours(a.c, auj) > PEREMPTION_J ? 'muet' : 'jeu';
  /** Écart à la grille d'une affaire : { mode: 'g' | 'f' | 'gf' | 'sans' | '', pct } (pct seulement s'il y a une part grille). */
  function ecartGrille(a, prix) {
    const d = prix && prix.dossiers ? prix.dossiers[a.ref] || prix.dossiers[a.racine] : null;
    const ph = d ? Object.values(d.phases || {}) : [];
    const g = ph.filter((p) => p.m === 'g').reduce((s, p) => s + (+p.v || 0), 0), f = ph.filter((p) => p.m === 'f').reduce((s, p) => s + (+p.v || 0), 0);
    const aG = ph.some((p) => p.m === 'g'), aF = ph.some((p) => p.m === 'f');
    if (!aG && !aF) return { mode: prix && prix.depuis && a.c >= prix.depuis ? 'sans' : '' };
    if (!aG || !(g > 0) || !(a.t > 0)) return { mode: aG ? 'gf' : 'f' };
    return { mode: aF ? 'gf' : 'g', pct: (a.t - f - g) / g };
  }
  function mesurer(liste, auj, prix) {
    const r = { ouverts: 0, hors: 0, emis: 0, emisHT: 0, signes: 0, signesHT: 0, realises: 0, realisesHT: 0, perdus: 0, muets: 0, perdusHT: 0, delais: [], prix: { haut: 0, egal: 0, bas: 0, tresbas: 0, g: 0, f: 0, sans: 0 }, ecarts: [] };
    liste.forEach((a) => {
      const g = groupe(a, auj);
      if (a.e !== 0) r.ouverts++;
      if (g === 'hors') { r.hors++; return; }
      r.emis++; r.emisHT += a.t;
      const x = ecartGrille(a, prix); if (typeof x.pct === 'number') r.ecarts.push(x.pct);
      if (g === 'signe') {
        r.signes++; r.signesHT += a.t;
        if (a.e === 6) { r.realises++; r.realisesHT += a.t; }
        // Délai de signature : du jour de création au jour où un relevé a constaté le passage à un état signé.
        const pas = a.h.filter((h) => h[0] && SIGNES.indexOf(+h[1]) >= 0)[0], avant = a.h.length && SIGNES.indexOf(+a.h[0][1]) < 0;
        if (pas && avant) r.delais.push(Math.max(0, ecartJours(a.c, pas[0])));
        if (x.mode === 'g' || x.mode === 'gf') { r.prix.g++; if (typeof x.pct === 'number') r.prix[x.pct > 0.03 ? 'haut' : x.pct >= -0.03 ? 'egal' : x.pct >= -0.10 ? 'bas' : 'tresbas']++; }
        else if (x.mode === 'f') r.prix.f++; else if (x.mode === 'sans') r.prix.sans++;
      } else if (g === 'perdu') { r.perdus++; r.perdusHT += a.t; } else if (g === 'muet') { r.muets++; r.perdusHT += a.t; }
    });
    const tranches = r.signes + r.perdus + r.muets;
    r.taux = tranches ? r.signes / tranches : null; r.tranches = tranches;
    r.rendement = r.emis ? r.signes / r.emis : null; r.tauxValeur = r.emisHT ? r.signesHT / r.emisHT : null;
    r.panier = r.signes ? r.signesHT / r.signes : null;
    r.delai = r.delais.length ? Math.round(r.delais.reduce((s, n) => s + n, 0) / r.delais.length) : null;
    r.ecart = r.ecarts.length ? r.ecarts.reduce((s, n) => s + n, 0) / r.ecarts.length : null;
    return r;
  }
  /** f = { type, rang, ste ('' | F | L | B), com ('' | identifiant | '0' non attribué) } */
  function calculer(donnees, prix, f, auj) {
    const toutes = affaires(donnees.dossiers || {}).filter((a) => (!f.ste || a.s === f.ste) && (f.com === '' || String(a.k) === String(f.com)));
    const P = periode(f.type, f.rang, auj), Q = periode(f.type, f.rang - 1, auj);
    const dans = (p) => toutes.filter((a) => a.c >= p.debut && a.c <= p.fin);
    const liste = dans(P), cur = mesurer(liste, auj, prix), prec = mesurer(dans(Q), auj, prix);
    const jeu = toutes.filter((a) => groupe(a, auj) === 'jeu');
    const relances = jeu.map((a) => ({ ref: a.ref, s: a.s, k: a.k, t: a.t, age: ecartJours(a.c, auj) })).sort((x, y) => y.age - x.age);
    // 12 semaines glissantes, par semaine de création
    const l0 = lundi(auj), semaines = [];
    for (let i = 11; i >= 0; i--) { const d = plus(l0, -7 * i), m = mesurer(toutes.filter((a) => a.c >= d && a.c <= plus(d, 6)), auj, null); semaines.push({ nom: 'S' + semaineIso(d), emis: m.emis, signes: m.signes }); }
    // pertes des 6 derniers mois, par mois de création
    const pertes = [];
    for (let i = 5; i >= 0; i--) { const p = periode('m', -i, auj), m = mesurer(toutes.filter((a) => a.c >= p.debut && a.c <= p.fin), auj, null); pertes.push({ nom: MOIS_C[+p.debut.slice(5, 7) - 1], declare: m.perdus, muet: m.muets }); }
    const coms = {};
    liste.forEach((a) => { (coms[a.k] = coms[a.k] || []).push(a); });
    const parCom = Object.keys(coms).map((k) => ({ k: +k, ...mesurer(coms[k], auj, prix) })).filter((c) => c.emis).sort((x, y) => (x.k === 0) - (y.k === 0) || y.signesHT - x.signesHT || y.emis - x.emis);
    return { P, Q, cur, prec, jeu: { n: jeu.length, ht: jeu.reduce((s, a) => s + a.t, 0), bientot: relances.filter((x) => x.age > PEREMPTION_J - RELANCE_J).length }, relances, semaines, pertes, parCom,
      commerciaux: [...new Set(affaires(donnees.dossiers || {}).map((a) => a.k))] };
  }

  // ---------------------------------------------------------------------------
  // Relevé quotidien de la liste des dossiers (lecture seule)
  // ---------------------------------------------------------------------------
  const CLE_MEMO = 'ext-ulyss-commercial', CLE_NOMS = 'ext-ulyss-commercial-noms';
  const memo = () => { try { return JSON.parse(localStorage.getItem(CLE_MEMO) || '{}') || {}; } catch (e) { return {}; } };
  const noter = (m) => { try { localStorage.setItem(CLE_MEMO, JSON.stringify(m)); } catch (e) {} };
  const noms = () => { try { return JSON.parse(localStorage.getItem(CLE_NOMS) || '{}') || {}; } catch (e) { return {}; } };
  function idPoste() { try { let p = localStorage.getItem('ext-ulyss-poste'); if (!p) { p = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('ext-ulyss-poste', p); } return p; } catch (e) { return ''; } }
  async function page(url) {
    const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    if (r.redirected && /sign_in|login/.test(r.url)) throw new Error('session Ulyss expirée');
    if (!r.ok) throw new Error('Ulyss a répondu ' + r.status);
    const html = await r.text();
    const listes = {};   // les <select> gèlent l'analyse : on ne garde que celui des commerciaux, lu à part
    const com = html.match(/<select[^>]*collaborator_ids[\s\S]*?<\/select>/i);
    if (com) (com[0].match(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/gi) || []).forEach((o) => { const m = o.match(/value="(\d+)"[^>]*>([^<]*)/i); if (m) listes[m[1]] = m[2].replace(/\s+/g, ' ').trim(); });
    return { doc: new DOMParser().parseFromString(html.replace(/<select[\s\S]*?<\/select>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, ''), 'text/html'), listes };
  }
  const nombre = (t) => { const x = parseFloat(String(t || '').replace(/[\s  €]/g, '').replace(',', '.')); return isFinite(x) ? x : 0; };
  /** Lignes d'une page de la liste : { <numéro>: { c, t, k, e, v } } ; les noms des commerciaux vont dans « connus », sur le poste. */
  function lignesDe(p, connus) {
    const table = [...p.doc.querySelectorAll('table')].find((t) => /numéro/i.test((t.querySelector('thead') || {}).textContent || ''));
    const out = {}; if (!table) return out;
    const col = {}; [...table.querySelectorAll('thead th')].forEach((th, i) => { col[th.textContent.trim().toLowerCase()] = i; });
    const parNom = {}; Object.keys(p.listes).forEach((id) => { connus[id] = p.listes[id]; }); Object.keys(connus).forEach((id) => { parNom[connus[id].toLowerCase()] = id; });
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const c = tr.cells, v = (n) => (col[n] !== undefined && c[col[n]] ? c[col[n]].textContent.replace(/\s+/g, ' ').trim() : '');
      const ref = (v('numéro').match(/DGT[CD][A-Z]\d{4}-\d{3}(?:_\d+)?/) || [''])[0], d = v('date').match(/(\d{2})\/(\d{2})\/(\d{4})/), e = ETATS[v('état').toLowerCase()];
      if (!ref || !d || e === undefined) return;
      const cc = col.commercial !== undefined ? c[col.commercial] : null, lien = cc && cc.querySelector('a[href*="/collaborators/"]'), nom = cc ? cc.textContent.replace(/\s+/g, ' ').trim() : '';
      let k = lien ? +((lien.getAttribute('href').match(/\/collaborators\/(\d+)/) || [])[1] || 0) : 0;
      if (!k && nom && parNom[nom.toLowerCase()]) k = +parNom[nom.toLowerCase()];
      if (k && nom) connus[k] = nom;
      out[ref] = { c: `${d[3]}-${d[2]}-${d[1]}`, t: nombre(v('tarif')), k, e, v: parseInt(v('v'), 10) || 0 };
    });
    return out;
  }
  let enCours = null, avancement = '';
  /** Lit la liste des déménagements créés depuis « depuis », 3 pages à la fois, et la dépose par paquets. */
  async function relever(poste, depuis, suivre) {
    const base = '/contracts/filter?filter_contract%5Bcontractable_type_models%5D%5B%5D=MovingContract&filter_contract%5Bcreated_after%5D=' + depuis + '&page=';
    const connus = noms(); let lot = {}, total = 0, fin = false;
    for (let p = 1; p <= 1200 && !fin; p += PARALLELES) {
      const pages = await Promise.all(Array.from({ length: PARALLELES }, (_, i) => page(base + (p + i))));
      pages.forEach((pg) => { const l = lignesDe(pg, connus), n = Object.keys(l).length; if (!n) fin = true; total += n; Object.assign(lot, l); });
      avancement = total + ' dossiers lus'; if (suivre) suivre(avancement);
      if (Object.keys(lot).length >= 600) { await serveur('commercial', { action: 'relever', poste, dossiers: lot }); lot = {}; }
    }
    try { localStorage.setItem(CLE_NOMS, JSON.stringify(connus)); } catch (e) {}
    if (!total) throw new Error('liste des dossiers vide ou illisible');
    return serveur('commercial', { action: 'relever', poste, dossiers: lot, fini: true });
  }
  /** Relevé du jour, s'il n'est pas fait : 25 mois la première fois, 13 mois ensuite. */
  function releveDuJour(suivre) {
    if (enCours) return enCours;
    const poste = idPoste(), auj = iso(new Date()), m = memo();
    if (!poste || (m.jour === auj && (m.fait || m.attendre > Date.now()))) return Promise.resolve(null);
    enCours = (async () => {
      try {
        const r = await serveur('commercial', { action: 'reserver', poste });
        if (!r.accorde) { noter({ jour: auj, fait: r.fait === r.aujourdhui, attendre: Date.now() + 10 * 60000 }); return null; }
        const d = new Date(); d.setMonth(d.getMonth() - (r.depuis ? 13 : 25)); d.setDate(1);
        const fin = await relever(poste, iso(d), suivre);
        noter({ jour: auj, fait: true }); return fin;
      } catch (e) { noter({ jour: auj, fait: false, attendre: Date.now() + 15 * 60000, erreur: String(e.message || e) }); throw e; }
      finally { enCours = null; avancement = ''; }
    })();
    return enCours;
  }

  // ---------------------------------------------------------------------------
  // Écran
  // ---------------------------------------------------------------------------
  const CSS = `
    :host{all:initial}
    *{box-sizing:border-box}
    .page{position:fixed;top:0;right:0;bottom:0;background:#eef1fa;overflow:auto;z-index:900;font-family:Manrope,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1f2a44;font-size:13px;padding:26px 32px 40px}
    h1{margin:0;font-size:24px;font-weight:800;color:#111a66;letter-spacing:-.01em} .sous{color:#6b7392;margin-top:4px;font-size:13px}
    .haut{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:18px}
    .filtres{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .seg{display:inline-flex;background:#fff;border-radius:12px;padding:3px;box-shadow:0 1px 2px rgba(17,26,102,.06)}
    .seg button{border:0;background:none;font:600 12.5px Manrope,system-ui,sans-serif;color:#4a5578;padding:7px 12px;border-radius:9px;cursor:pointer}
    .seg button[aria-pressed=true]{background:#111a66;color:#fff}
    select{border:0;background:#fff;border-radius:12px;padding:9px 12px;font:600 12.5px Manrope,system-ui,sans-serif;color:#1f2a44;box-shadow:0 1px 2px rgba(17,26,102,.06);cursor:pointer}
    .kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin-bottom:14px}
    .carte{background:#fff;border-radius:16px;padding:18px 20px;box-shadow:0 1px 3px rgba(17,26,102,.06);min-width:0}
    .kpi .t{font-size:12px;font-weight:700;color:#6b7392} .kpi .v{font-size:26px;font-weight:800;color:#111a66;margin:6px 0 2px;letter-spacing:-.02em;white-space:nowrap} .kpi .d{font-size:12px;color:#6b7392;line-height:1.4}
    .evo{display:inline-block;margin-top:8px;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#f1f3f8;color:#4a5578} .evo.plus{background:#eaf5ec;color:#22693a} .evo.moins{background:#fdebe4;color:#a23b1c}
    .blocs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    h2{margin:0;font-size:15px;font-weight:800;color:#111a66} .h2s{color:#6b7392;font-size:12px;margin:3px 0 14px}
    table{border-collapse:collapse;width:100%;font-size:13px} th{text-align:left;font-size:11px;font-weight:700;color:#6b7392;text-transform:uppercase;letter-spacing:.04em;padding:0 8px 8px 0} td{padding:8px 8px 8px 0;border-top:1px solid #eef1fa} .n{text-align:right} th.n{padding-right:0} td.n{padding-right:0;font-variant-numeric:tabular-nums}
    .ste{display:inline-block;font-size:10.5px;font-weight:800;color:#fff;border-radius:6px;padding:2px 6px} a{color:#111a66;font-weight:700;text-decoration:none} a:hover{text-decoration:underline}
    .ent{display:grid;grid-template-columns:130px 1fr 130px;gap:10px;align-items:center;margin:9px 0} .ent .b{height:26px;border-radius:8px;background:#111a66;min-width:3px} .ent .l{font-weight:700} .ent .c{text-align:right;color:#4a5578;font-variant-numeric:tabular-nums}
    .note{margin-top:12px;font-size:12px;color:#6b7392;line-height:1.5} .gris{color:#9aa3c0}
    .leg{display:flex;gap:16px;font-size:12px;color:#4a5578;margin-top:8px;flex-wrap:wrap} .leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    .px{display:grid;grid-template-columns:1fr 34px;gap:10px;align-items:center;margin:9px 0} .px .lib{font-size:12.5px;margin-bottom:4px} .px .f{height:10px;border-radius:999px;background:#eef1fa;overflow:hidden} .px .f i{display:block;height:100%;border-radius:999px} .px .q{text-align:right;font-weight:800;color:#111a66}
    .modes{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px} .modes span{background:#f1f3f8;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;color:#4a5578}
    .etat{display:flex;gap:10px;align-items:center;font-size:12px;color:#6b7392} .btn{border:0;background:#111a66;color:#fff;font:700 12.5px Manrope,system-ui,sans-serif;border-radius:10px;padding:8px 14px;cursor:pointer} .btn[disabled]{opacity:.5;cursor:default}
    .vide{padding:40px 20px;text-align:center;color:#6b7392;line-height:1.7}
    .pos{color:#22693a;font-weight:700} .neg{color:#a23b1c;font-weight:700}
    @media (max-width:1250px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}} @media (max-width:900px){.blocs{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  function el(nom, attrs = {}, ...enfants) {
    const n = document.createElement(nom);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) n.setAttribute(k, v); }
    enfants.flat().forEach((e) => { if (e !== null && e !== undefined && e !== false) n.append(e instanceof Node ? e : document.createTextNode(String(e))); });
    return n;
  }
  const svg = (html, l, h) => { const d = document.createElement('div'); d.innerHTML = `<svg viewBox="0 0 ${l} ${h}" width="100%" style="display:block" xmlns="http://www.w3.org/2000/svg" font-family="Manrope,system-ui,sans-serif">${html}</svg>`; return d.firstChild; };
  const ent = (n) => Math.round(n).toLocaleString('fr-FR');
  const keur = (n) => (Math.abs(n) >= 10000 ? ent(n / 1000) + ' k€' : ent(n) + ' €');
  const pc = (x) => (x === null || x === undefined ? '—' : Math.round(x * 100) + ' %');
  const signe = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');

  let ecran = null, etatEcran = { type: 'm', rang: 0, ste: '', com: '' }, donnees = null, prix = null, message = '';
  const nomCom = (k) => (!+k ? 'Non attribué' : noms()[k] || 'Commercial n° ' + k);
  function evo(cur, prec, genre, sens) {
    if (cur === null || prec === null || cur === undefined || prec === undefined || (genre !== 'pts' && genre !== 'j' && !prec)) return el('span', { class: 'evo' }, '—');
    const d = genre === 'pts' ? Math.round((cur - prec) * 100) : genre === 'j' ? cur - prec : Math.round((cur / prec - 1) * 100);
    const bon = sens === -1 ? d < 0 : d > 0;
    return el('span', { class: 'evo' + (d === 0 ? '' : bon ? ' plus' : ' moins') }, signe(d) + Math.abs(d) + (genre === 'pts' ? ' pts' : genre === 'j' ? ' j' : ' %'));
  }
  function dessiner() {
    if (!ecran) return;
    const zone = ecran.shadowRoot.querySelector('.page'); if (!zone) return;
    const auj = iso(new Date()), f = etatEcran;
    const boutons = (liste, cle) => el('div', { class: 'seg' }, liste.map(([v, t]) => el('button', { 'aria-pressed': String(f[cle] === v), onclick: () => { f[cle] = v; if (cle === 'type') f.rang = 0; dessiner(); } }, t)));
    const tete = (P, Q) => el('div', { class: 'haut' },
      el('div', {}, el('h1', {}, 'Activité commerciale'), el('div', { class: 'sous' }, P ? P.nom + ' · comparé ' + P.avant + ' · dossiers classés par date de création' : 'Déménagements des trois sociétés')),
      el('div', { class: 'filtres' },
        el('div', { class: 'seg' }, el('button', { title: 'Période précédente', onclick: () => { f.rang--; dessiner(); } }, '‹'), el('button', { title: 'Période suivante', disabled: f.rang >= 0 ? '' : null, onclick: () => { if (f.rang < 0) { f.rang++; dessiner(); } } }, '›')),
        boutons([['s', 'Semaine'], ['m', 'Mois'], ['t', 'Trimestre'], ['a', 'Année']], 'type'),
        boutons([['', 'Toutes'], ['F', 'FRA'], ['L', 'LDL'], ['B', 'BD']], 'ste'),
        (() => { const s = el('select', { 'aria-label': 'Commercial', onchange: () => { f.com = s.value; dessiner(); } }, el('option', { value: '' }, 'Tous les commerciaux'), (donnees ? [...new Set(affaires(donnees.dossiers).map((a) => a.k))] : []).sort((a, b) => (a === 0) - (b === 0) || nomCom(a).localeCompare(nomCom(b))).map((k) => el('option', { value: String(k) }, nomCom(k)))); s.value = f.com; return s; })()));
    const pied = () => {
      const b = el('button', { class: 'btn', onclick: async () => { b.disabled = true; noter({}); try { await releveDuJour((t) => { message = 'Relevé en cours : ' + t + '…'; info.textContent = message; }); message = ''; await charger(); } catch (e) { message = 'Relevé impossible : ' + (e.message || e) + '.'; dessiner(); } } }, 'Relever maintenant');
      if (enCours || (donnees && donnees.fait === donnees.aujourdhui)) b.disabled = true;
      const info = el('span', {}, message || (enCours ? 'Relevé en cours' + (avancement ? ' : ' + avancement : '') + '…' : donnees && donnees.fait ? 'Dernier relevé des dossiers : ' + donnees.fait.split('-').reverse().join('/') + (donnees.depuis ? ' · historique depuis le ' + donnees.depuis.split('-').reverse().join('/') : '') : 'Aucun relevé pour le moment.'));
      return el('div', { class: 'etat', style: 'margin-top:16px;justify-content:flex-end' }, info, b);
    };
    if (!donnees || !Object.keys(donnees.dossiers || {}).length) {
      zone.replaceChildren(tete(null), el('div', { class: 'carte vide' }, message || (donnees ? 'Aucun dossier relevé pour le moment. Le premier relevé lit la liste des dossiers des 25 derniers mois : comptez deux à trois minutes, pendant lesquelles Ulyss reste utilisable.' : 'Chargement…')), donnees ? pied() : null);
      return;
    }
    const R = calculer(donnees, prix, f, auj), c = R.cur, p = R.prec;
    const kpi = (t, v, d, e) => el('div', { class: 'carte kpi' }, el('div', { class: 't' }, t), el('div', { class: 'v' }, v), el('div', { class: 'd' }, d), e);
    const kpis = el('div', { class: 'kpis' },
      kpi('Devis émis', ent(c.emis), keur(c.emisHT) + ' HT', evo(c.emis, p.emis)),
      kpi('Devis signés', ent(c.signes), keur(c.signesHT) + ' HT', evo(c.signes, p.signes)),
      kpi('Taux de transformation', pc(c.rendement), c.signes + ' signés sur ' + c.emis + ' devis émis · ' + pc(c.tauxValeur) + ' en valeur · ' + pc(c.taux) + ' des ' + c.tranches + ' devis tranchés', evo(c.rendement, p.rendement, 'pts')),
      kpi('Panier moyen signé', c.panier === null ? '—' : ent(c.panier) + ' €', 'HT, net de remise', evo(c.panier, p.panier)),
      kpi('En jeu', keur(R.jeu.ht), R.jeu.n + ' devis ouverts à ce jour · ' + R.jeu.bientot + ' à relancer avant ' + RELANCE_J + ' j', el('span', { class: 'evo' }, 'à date')),
      kpi('Délai de signature', c.delai === null ? '—' : c.delai + ' j', c.delai === null ? 'mesuré sur les signatures constatées depuis le ' + (donnees.depuis || auj).split('-').reverse().join('/') : 'de la création du dossier à l\'accord · ' + c.delais.length + (c.delais.length > 1 ? ' signatures datées' : ' signature datée'), evo(c.delai, p.delai, 'j', -1)));
    // 1. entonnoir
    const maxE = Math.max(1, c.ouverts), barre = (l, n, ht, coul) => el('div', { class: 'ent' }, el('div', { class: 'l' }, l), el('div', {}, el('div', { class: 'b', style: 'width:' + Math.max(1, Math.round(n / maxE * 100)) + '%;background:' + coul })), el('div', { class: 'c' }, ent(n) + (ht === null ? '' : ' · ' + keur(ht))));
    const nonSignes = c.emis - c.signes;
    const entonnoir = el('div', { class: 'carte' }, el('h2', {}, 'Entonnoir'), el('div', { class: 'h2s' }, 'Du dossier ouvert au déménagement réalisé, pour les dossiers créés sur la période'),
      barre('Dossiers ouverts', c.ouverts, null, '#9aa3c0'), barre('Devisés', c.emis, c.emisHT, '#4f6bd8'), barre('Signés', c.signes, c.signesHT, '#111a66'), barre('Réalisés', c.realises, c.realisesHT, '#22693a'),
      el('div', { class: 'note' }, c.emis ? nonSignes + ' devis sur ' + c.emis + ' ne sont pas signés : ' + (c.emis - c.signes - c.perdus - c.muets) + ' encore en jeu, ' + c.perdus + ' sans suite, ' + c.muets + ' sans réponse depuis plus de deux mois. ' : 'Aucun devis sur la période. ', el('span', { class: 'gris' }, c.hors + ' dossiers hors suivi (brouillon, rendez-vous, annulé, clôturé).')));
    // 2. tendance
    const mx = Math.max(1, ...R.semaines.map((s) => s.emis)), L = 560, H = 190, pas = (L - 30) / 12;
    const tendance = el('div', { class: 'carte' }, el('h2', {}, 'Tendance sur 12 semaines'), el('div', { class: 'h2s' }, 'Devis émis et devis signés, par semaine de création du dossier'),
      svg(R.semaines.map((s, i) => { const x = 30 + i * pas, h1 = s.emis / mx * 140, h2 = s.signes / mx * 140; return `<rect x="${x + 4}" y="${155 - h1}" width="${pas / 2 - 5}" height="${h1}" rx="3" fill="#c9d3f5"/><rect x="${x + pas / 2 + 1}" y="${155 - h2}" width="${pas / 2 - 5}" height="${h2}" rx="3" fill="#111a66"/><text x="${x + pas / 2}" y="174" text-anchor="middle" font-size="10" fill="#6b7392">${s.nom}</text>${s.emis ? `<text x="${x + pas / 4 + 2}" y="${150 - h1}" text-anchor="middle" font-size="9.5" fill="#4a5578">${s.emis}</text>` : ''}`; }).join('') + `<line x1="30" y1="155.5" x2="${L}" y2="155.5" stroke="#dfe4f3"/>`, L, H),
      el('div', { class: 'leg' }, el('span', {}, el('i', { style: 'background:#c9d3f5' }), 'Devis émis'), el('span', {}, el('i', { style: 'background:#111a66' }), 'Devis signés')));
    // 3. à relancer
    const lien = (ref) => el('a', { href: '/contracts/filter?filter_contract%5Bsearch%5D=' + encodeURIComponent(ref), title: 'Ouvrir ce dossier dans la liste d\'Ulyss' }, ref);
    const relancer = el('div', { class: 'carte' }, el('h2', {}, 'À relancer'), el('div', { class: 'h2s' }, 'Devis ouverts à ce jour, du plus ancien au plus récent'),
      R.relances.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Ste'), el('th', {}, 'Dossier'), el('th', {}, 'Commercial'), el('th', { class: 'n' }, 'Montant HT'), el('th', { class: 'n' }, 'Depuis'))),
        el('tbody', {}, R.relances.slice(0, 8).map((x) => el('tr', {}, el('td', {}, el('span', { class: 'ste', style: 'background:' + STE[x.s][1] }, STE[x.s][0])), el('td', {}, lien(x.ref)), el('td', {}, nomCom(x.k)), el('td', { class: 'n' }, ent(x.t) + ' €'), el('td', { class: 'n' }, x.age + ' j'))))) : el('div', { class: 'note' }, 'Aucun devis ouvert.'),
      el('div', { class: 'note' }, R.jeu.n + ' devis ouverts au total · ' + R.jeu.bientot + ' seront comptés perdus dans les ' + RELANCE_J + ' jours, faute de réponse (deux mois après la création).'));
    // 4. niveau de prix
    const px = c.prix, mxP = Math.max(1, px.haut, px.egal, px.bas, px.tresbas), lig = (t, n, coul) => el('div', { class: 'px' }, el('div', {}, el('div', { class: 'lib' }, t), el('div', { class: 'f' }, el('i', { style: 'width:' + Math.round(n / mxP * 100) + '%;background:' + coul }))), el('div', { class: 'q' }, n));
    const niveau = el('div', { class: 'carte' }, el('h2', {}, 'Niveau de prix'), el('div', { class: 'h2s' }, 'Devis signés de la période, comparés au prix de la grille'),
      prix ? [lig('Au-dessus de la grille (plus de +3 %)', px.haut, '#2f8f4e'), lig('Au prix de la grille (± 3 %)', px.egal, '#1d4fd7'), lig('En dessous (−3 à −10 %)', px.bas, '#e07a52'), lig('Très en dessous (moins de −10 %)', px.tresbas, '#8f1d14'),
        el('div', { class: 'modes' }, el('span', {}, px.g + ' chiffrés à la grille'), el('span', {}, px.f + ' au forfait'), el('span', {}, px.sans + ' sans la grille')),
        el('div', { class: 'note' }, 'Seuls comptent les dossiers chiffrés avec l\'extension depuis le ' + (prix.depuis || auj).split('-').reverse().join('/') + ' : ' + (c.signes - px.g - px.f - px.sans) + ' signés de la période sont antérieurs.')] : el('div', { class: 'note' }, 'Module « Niveau de prix » pas encore en service (dossier « prix » à déposer sur le serveur).'));
    // 5. par commercial
    const parCom = el('div', { class: 'carte' }, el('h2', {}, 'Par commercial'), el('div', { class: 'h2s' }, 'Devis de la période et écart moyen par rapport à la grille'),
      R.parCom.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Commercial'), el('th', { class: 'n' }, 'Émis'), el('th', { class: 'n' }, 'Signés'), el('th', { class: 'n' }, 'Taux'), el('th', { class: 'n' }, 'Signé HT'), el('th', { class: 'n' }, 'Écart grille'))),
        el('tbody', {}, R.parCom.map((x) => el('tr', {}, el('td', { class: x.k ? '' : 'gris' }, nomCom(x.k)), el('td', { class: 'n' }, x.emis), el('td', { class: 'n' }, x.signes), el('td', { class: 'n', title: x.signes + ' signés sur ' + x.emis + ' émis · ' + pc(x.taux) + ' des ' + x.tranches + ' tranchés' }, pc(x.rendement)), el('td', { class: 'n' }, keur(x.signesHT)),
          el('td', { class: 'n' }, x.ecart === null ? el('span', { class: 'gris' }, '—') : el('span', { class: x.ecart < -0.03 ? 'neg' : x.ecart > 0.03 ? 'pos' : '' }, signe(x.ecart) + Math.abs(x.ecart * 100).toFixed(1).replace('.', ',') + ' %')))))) : el('div', { class: 'note' }, 'Aucun devis sur la période.'));
    // 6. pertes
    const mxL = Math.max(1, ...R.pertes.map((m) => m.declare + m.muet)), pasL = (L - 30) / 6;
    const pertes = el('div', { class: 'carte' }, el('h2', {}, 'Pertes'), el('div', { class: 'h2s' }, 'Devis perdus, par mois de création du dossier'),
      svg(R.pertes.map((m, i) => { const x = 30 + i * pasL + pasL * 0.2, w = pasL * 0.6, h1 = m.declare / mxL * 135, h2 = m.muet / mxL * 135; return `<rect x="${x}" y="${155 - h1}" width="${w}" height="${h1}" fill="#8f1d14"/><rect x="${x}" y="${155 - h1 - h2}" width="${w}" height="${h2}" fill="#f0b9a6"/><text x="${x + w / 2}" y="174" text-anchor="middle" font-size="10.5" fill="#6b7392">${m.nom}</text>${m.declare + m.muet ? `<text x="${x + w / 2}" y="${149 - h1 - h2}" text-anchor="middle" font-size="10" fill="#4a5578">${m.declare + m.muet}</text>` : ''}`; }).join('') + `<line x1="30" y1="155.5" x2="${L}" y2="155.5" stroke="#dfe4f3"/>`, L, H),
      el('div', { class: 'leg' }, el('span', {}, el('i', { style: 'background:#8f1d14' }), 'Sans suite déclaré'), el('span', {}, el('i', { style: 'background:#f0b9a6' }), 'Sans réponse après deux mois')),
      el('div', { class: 'note' }, 'Ulyss n\'enregistre aucun motif de perte : on sait combien, pas pourquoi. Les deux derniers mois ne sont pas encore joués.'));
    zone.replaceChildren(tete(R.P, R.Q), kpis, el('div', { class: 'blocs' }, entonnoir, tendance, relancer, niveau, parCom, pertes), pied());
  }
  async function charger() {
    try { donnees = await serveur('commercial', { action: 'lire' }); message = ''; } catch (e) { donnees = null; message = 'Données illisibles : ' + (e.message || e) + '.'; dessiner(); return; }
    try { prix = await serveur('prix', { action: 'tout' }); } catch (e) { prix = null; }
    dessiner();
  }
  function caler() {
    if (!ecran) return;
    const sb = document.getElementById('global-sidebar'), zone = ecran.shadowRoot.querySelector('.page');
    if (zone) zone.style.left = (sb ? Math.round(sb.getBoundingClientRect().right) : 0) + 'px';
  }
  let veille = null;
  function monter() {
    if (ecran && ecran.isConnected) return;
    ecran = el('div', { id: ID_ECRAN }); document.body.append(ecran);
    const racine = ecran.attachShadow({ mode: 'open' });
    racine.append(el('style', {}, CSS), el('div', { class: 'page', role: 'main', 'aria-label': 'Activité commerciale' }));
    caler(); window.addEventListener('resize', caler);
    const sb = document.getElementById('global-sidebar');
    if (sb && window.ResizeObserver) { veille = new ResizeObserver(caler); veille.observe(sb); }
    document.title = 'Activité commerciale — Ulyss';
    dessiner(); charger().then(() => releveDuJour((t) => { message = 'Relevé du jour en cours : ' + t + '…'; dessiner(); })).then((r) => { if (r) { message = ''; return charger(); } }).catch((e) => { message = 'Relevé du jour impossible : ' + (e.message || e) + '.'; dessiner(); });
  }
  function demonter() { if (veille) { veille.disconnect(); veille = null; } window.removeEventListener('resize', caler); if (ecran) { ecran.remove(); ecran = null; } const e = document.getElementById(ID_ENTREE); if (e) e.classList.remove('active'); }
  function suivreAdresse() {
    if (location.hash === ANCRE) { monter(); const e = document.getElementById(ID_ENTREE); if (e) e.classList.add('active'); } else if (ecran) demonter();
  }
  /** Entrée de la barre latérale, sous « Dashboard ». */
  function insererEntree() {
    if (document.getElementById(ID_ENTREE)) return;
    const zone = document.querySelector('#global-sidebar .discret-scroll') || document.getElementById('global-sidebar');
    const liens = zone ? [...zone.querySelectorAll(':scope > a.sidebar-link')] : [];
    if (!liens.length) return;
    const r = document.createElement('a');
    r.id = ID_ENTREE; r.href = ANCRE; r.className = 'sidebar-link';
    r.title = 'Activité commerciale : devis émis, signés, transformation, relances (Extension Ulyss)';
    r.innerHTML = '<div class="text-3xl mr-3.75"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:3px 0"><path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6M20 6l-4 3"/></svg></div><div class="reductible">Activité commerciale</div>';
    r.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (location.hash !== ANCRE) history.pushState(history.state, '', location.pathname + location.search + ANCRE); suivreAdresse(); });
    liens[0].insertAdjacentElement('afterend', r);
    // Toute autre entrée de la barre latérale referme l'écran, même si elle mène à la page déjà affichée dessous.
    zone.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a.sidebar-link'); if (a && a.id !== ID_ENTREE && !/^ext-ulyss-/.test(a.id) && ecran) { history.replaceState(history.state, '', location.pathname + location.search); demonter(); } }, true);
  }
  if (window.__extUlyssCommercialEssai) Object.assign(window.__extUlyssCommercialEssai, { calculer, affaires, periode, lignesDe, releveDuJour });
  const poser = () => { insererEntree(); suivreAdresse(); };
  document.addEventListener('turbo:load', poser);
  window.addEventListener('hashchange', suivreAdresse); window.addEventListener('popstate', suivreAdresse);
  let prevu = false;
  new MutationObserver(() => { if (prevu) return; prevu = true; requestAnimationFrame(() => { prevu = false; insererEntree(); }); }).observe(document.documentElement, { childList: true, subtree: true });
  poser();
  // Relevé du jour en arrière-plan, une minute après l'ouverture d'Ulyss, sans gêner les autres lectures du matin.
  setTimeout(() => { releveDuJour().catch(() => {}); }, 60000);
})();
