/*
 * Extension Ulyss — « Niveau de prix » dans la liste des dossiers (28/11/2026, demande de Guillaume).
 * À côté du tarif de chaque dossier : COMMENT il a été chiffré (grille, forfait, les deux, ou sans) et, pour la grille,
 * l'ÉCART entre le prix vendu et le prix de la grille. Au survol : prix de la grille, prix vendu, écart, date du chiffrage.
 *   vert  : vendu plus de 3 % au-dessus de la grille      bleu       : à ± 3 % de la grille
 *   rouge clair : de 3 à 10 % en dessous                  rouge foncé : plus de 10 % en dessous
 * Le prix de la grille n'est PAS recalculé ici : il a été retenu par le panneau de chiffrage au report dans le devis
 * (serveur prix/). Une seule demande au serveur par page de liste. Ulyss n'est pas interrogé : tout est lu dans la page.
 * Colonne « Tarif » d'Ulyss = HT net de remise du dossier entier ; s'il y a aussi un forfait, sa part est retirée avant de
 * comparer à la grille. « Sans » n'est montré que pour un dossier créé depuis la mise en service, à partir de l'état Devisé.
 */
(() => {
  'use strict';
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const CLASSE = 'ext-ulyss-prix';
  const SAISONS = ['basse saison', 'saison normale', 'haute saison', 'très haute saison'];
  const AVANT_DEVIS = /^(brouillon|rdv)$/i;
  const essai = () => !!window.__extUlyssRdvEssai;
  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => {
      try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false }); }); } catch (e) { ok({ ok: false }); }
    });
  }
  const euros = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';
  const nombre = (t) => { const x = parseFloat(String(t || '').replace(/[\s  €]/g, '').replace(',', '.')); return isFinite(x) ? x : 0; };
  const dateIso = (t) => { const m = String(t || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  const fr = (d) => (d ? d.split('-').reverse().join('/') : '');

  function style() {
    if (document.getElementById(CLASSE + '-style')) return;
    const s = document.createElement('style');
    s.id = CLASSE + '-style';
    s.textContent = `
      .${CLASSE}{position:relative;display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:2px 7px 2px 6px;border-radius:999px;font:700 10.5px/1.5 Manrope,system-ui,sans-serif;letter-spacing:.03em;vertical-align:middle;cursor:default;white-space:nowrap;border:1px solid transparent}
      .${CLASSE} i{width:8px;height:8px;border-radius:50%;display:inline-block;background:currentColor}
      .${CLASSE}.haut{background:#eaf5ec;color:#22693a} .${CLASSE}.egal{background:#e6eeff;color:#1d4fd7}
      .${CLASSE}.bas{background:#fdebe4;color:#a23b1c} .${CLASSE}.tresbas{background:#8f1d14;color:#fff}
      .${CLASSE}.forfait{background:#f1f3f8;color:#4a5578} .${CLASSE}.sans{background:#fff;color:#6b7392;border:1px dashed #9aa3c0}
      .${CLASSE}::after{content:attr(data-info);position:absolute;right:0;top:calc(100% + 6px);z-index:50;display:none;white-space:pre;text-align:left;background:#111a66;color:#fff;font:500 12px/1.6 Manrope,system-ui,sans-serif;letter-spacing:0;padding:9px 12px;border-radius:10px;box-shadow:0 10px 26px rgba(17,26,102,.28)}
      .${CLASSE}:hover::after,.${CLASSE}:focus::after{display:block}
    `;
    (document.head || document.documentElement).append(s);
  }

  /** Colonnes de la liste, repérées par leur titre (Numéro, Date, Tarif, État). */
  function colonnes(table) {
    const c = {};
    [...table.querySelectorAll('thead th')].forEach((th, i) => {
      const t = th.textContent.trim().toLowerCase();
      if (t === 'numéro') c.numero = i; else if (t === 'date') c.date = i; else if (t === 'tarif') c.tarif = i; else if (t === 'état') c.etat = i;
    });
    return c.numero !== undefined && c.tarif !== undefined ? c : null;
  }
  /** Pastille d'un dossier : { classe, texte, info } ou null (rien à montrer). */
  function pastille(d, ligne, depuis) {
    const phases = d ? Object.values(d.phases || {}) : [];
    const g = phases.filter((p) => p.m === 'g').reduce((s, p) => s + (p.v || 0), 0);
    const f = phases.filter((p) => p.m === 'f').reduce((s, p) => s + (p.v || 0), 0);
    const aG = phases.some((p) => p.m === 'g'), aF = phases.some((p) => p.m === 'f');
    if (AVANT_DEVIS.test(ligne.etat) || !(ligne.tarif > 0)) return null;
    if (!aG && !aF) {
      if (!depuis || !ligne.date || ligne.date < depuis) return null;   // dossier d'avant la mise en service : on ne sait pas
      return { classe: 'sans', texte: 'Sans', info: 'Chiffré sans la grille ni un forfait de l\'extension\nVendu ' + euros(ligne.tarif) + ' HT' };
    }
    const quand = d.quand ? '\nChiffré le ' + fr(d.quand) + (aG && typeof d.saison === 'number' ? ' · ' + SAISONS[d.saison] : '') : '';
    if (!aG) return { classe: 'forfait', texte: 'Forfait', info: 'Chiffré au forfait : ' + euros(f) + ' HT\nVendu ' + euros(ligne.tarif) + ' HT' + quand };
    const vendu = ligne.tarif - f, ecart = vendu - g, pct = g > 0 ? ecart / g : 0;
    const classe = pct > 0.03 ? 'haut' : pct >= -0.03 ? 'egal' : pct >= -0.10 ? 'bas' : 'tresbas';
    const signe = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + euros(Math.abs(n));
    const p100 = (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct * 100).toFixed(1).replace('.', ',') + ' %';
    return {
      classe, texte: aF ? 'Grille + forfait' : 'Grille',
      info: 'Grille ' + euros(g) + ' HT' + (aF ? '\nForfait ' + euros(f) + ' HT (retiré du prix vendu)' : '') + '\nVendu ' + euros(vendu) + ' HT' + (aF ? ' pour la part grille' : '') + '\nÉcart ' + signe(ecart) + ' (' + p100 + ')' + quand,
    };
  }

  let memo = { cle: '', reponse: null, enCours: false };
  async function poser() {
    if (window.__extUlyssActif && !window.__extUlyssActif('prix')) return;
    if (window.top !== window || (!HOTES.test(location.hostname) && !essai())) return;
    if (!/^\/contracts(\/filter)?\/?$/.test(location.pathname)) return;
    const table = [...document.querySelectorAll('table')].find((t) => colonnes(t));
    if (!table) return;
    const col = colonnes(table);
    const lignes = [...table.querySelectorAll('tbody tr')].map((tr) => {
      const c = tr.cells, ref = c[col.numero] ? (c[col.numero].textContent.match(/DGT[CD][A-Z]\d{4}-\d{3}(?:_\d+)?/) || [''])[0] : '';
      return ref && c[col.tarif] ? { tr, ref, cellule: c[col.tarif], tarif: nombre(c[col.tarif].textContent), etat: col.etat !== undefined && c[col.etat] ? c[col.etat].textContent.replace(/\s+/g, ' ').trim() : '', date: col.date !== undefined && c[col.date] ? dateIso(c[col.date].textContent) : '' } : null;
    }).filter(Boolean);
    if (!lignes.length) return;
    const cle = lignes.map((l) => l.ref).join(',');
    if (memo.cle !== cle) {
      if (memo.enCours) return;
      memo.enCours = true;
      const r = await demander({ type: 'gc-rdv', cible: 'prix', donnees: { instance: location.hostname, action: 'lire', refs: lignes.map((l) => l.ref) } });
      memo = { cle, reponse: r && r.ok && r.corps && r.corps.ok ? r.corps : null, enCours: false };
      if (!memo.reponse) return;   // serveur pas encore déposé, ou code jamais saisi : la liste reste telle quelle
    }
    if (!memo.reponse) return;
    style();
    lignes.forEach((l) => {
      if (l.cellule.querySelector('.' + CLASSE)) return;
      const p = pastille(memo.reponse.dossiers[l.ref], l, memo.reponse.depuis);
      if (!p) return;
      const b = document.createElement('span');
      b.className = CLASSE + ' ' + p.classe; b.tabIndex = 0; b.setAttribute('data-info', p.info); b.setAttribute('aria-label', p.texte + '. ' + p.info.replace(/\n/g, '. '));
      b.append(document.createElement('i'), document.createTextNode(p.texte));
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });   // la ligne est un lien : la pastille ne l'ouvre pas
      (l.cellule.querySelector('a') || l.cellule).append(b);
    });
  }
  if (window.__extUlyssPrixEssai) window.__extUlyssPrixEssai.pastille = pastille;
  let prevu = false;
  const passer = () => { if (prevu) return; prevu = true; requestAnimationFrame(() => { prevu = false; poser().catch(() => {}); }); };
  document.addEventListener('turbo:load', passer);
  document.addEventListener('turbo:frame-load', passer);
  new MutationObserver(passer).observe(document.documentElement, { childList: true, subtree: true });
  passer();
})();
