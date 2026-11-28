/*
 * Extension Ulyss — tableau de bord : bloc « Demandes d'autorisation à effectuer » redessiné (28/11/2026, essai demandé par
 * Guillaume : « beaucoup plus design », avec la société notée « STE », affiché par-dessus la carte existante).
 * La carte d'Ulyss (turbo-frame#waiting_authorizations-parking_decrees) reste dans la page, masquée : elle sert de source
 * (date, client, adresse, ville, lien du dossier) et se remet en un clic (« Affichage d'origine »). Rien n'est écrit dans Ulyss.
 * La société n'est pas dans la carte d'Ulyss. Elle est retrouvée une fois par dossier puis gardée sur le poste :
 *   1. liste du module Panneaux (/parking_decrees, colonne « Strc. ») — une requête, couvre une partie des dossiers ;
 *   2. pour les autres, lettre du numéro lu sur /contracts/<id>/documents (0,6 s), un dossier à la fois.
 * Relevé production du 28/11/2026 : couleurs des sociétés FRA #0039b3, LDL #9e1f1f, BD #f67904 ; police Manrope.
 */
(() => {
  'use strict';
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const ID_CADRE = 'waiting_authorizations-parking_decrees';
  const ID = 'ext-ulyss-autorisations';
  const CLE_STE = 'ext-ulyss-ste', CLE_VUE = 'ext-ulyss-autorisations-vue';
  const SOCIETES = { FRA: { nom: 'Fraisseix Déménagements', couleur: '#0039b3' }, LDL: { nom: 'Les Déménageurs Limousins', couleur: '#9e1f1f' }, BD: { nom: 'Bardon Déménagements', couleur: '#f67904' } };
  const LETTRES = { F: 'FRA', L: 'LDL', B: 'BD' };
  const MOIS = { janv: 0, jan: 0, févr: 1, fevr: 1, fév: 1, mars: 2, mar: 2, avr: 3, mai: 4, juin: 5, juil: 6, août: 7, aout: 7, sept: 8, sep: 8, oct: 9, nov: 10, déc: 11, dec: 11 };
  const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const essai = () => !!window.__extUlyssRdvEssai;

  const lireJson = (cle, defaut) => { try { return JSON.parse(localStorage.getItem(cle) || 'null') || defaut; } catch (e) { return defaut; } };
  const ecrire = (cle, v) => { try { localStorage.setItem(cle, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} };
  const societes = lireJson(CLE_STE, {});   // { <id dossier>: 'FRA' | 'LDL' | 'BD' }
  let filtre = '';                           // société choisie dans les puces, '' = toutes

  function style() {
    if (document.getElementById(ID + '-style')) return;
    const s = document.createElement('style');
    s.id = ID + '-style';
    s.textContent = `
      #${ID}{height:100%;display:flex;flex-direction:column;background:#fff;border-radius:18px;box-shadow:0 1px 2px rgba(17,26,102,.05),0 10px 30px rgba(17,26,102,.07);overflow:hidden;font-family:Manrope,Inter,'Segoe UI',system-ui,sans-serif;color:#111a66}
      #${ID} .eu-tete{display:flex;align-items:center;gap:14px;padding:20px 24px 14px}
      #${ID} .eu-ico{flex:none;width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#e7efff,#d5e2ff);color:#0039b3}
      #${ID} .eu-titres{flex:1;min-width:0} #${ID} .eu-titre{font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.2}
      #${ID} .eu-sous{font-size:12.5px;color:#7a84a6;margin-top:2px}
      #${ID} .eu-nb{flex:none;font-size:22px;font-weight:800;line-height:1;color:#111a66;background:#f1f4fb;border-radius:12px;padding:9px 13px}
      #${ID} .eu-puces{display:flex;gap:6px;padding:0 24px 12px;flex-wrap:wrap}
      #${ID} .eu-puce{border:1px solid #e3e8f4;background:#fff;border-radius:999px;padding:5px 11px;font:inherit;font-size:12px;font-weight:600;color:#56608a;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .15s,border-color .15s}
      #${ID} .eu-puce:hover{background:#f6f8fd} #${ID} .eu-puce[aria-pressed=true]{background:#111a66;border-color:#111a66;color:#fff}
      #${ID} .eu-puce i{width:7px;height:7px;border-radius:50%;display:inline-block} #${ID} .eu-puce b{font-weight:700;opacity:.7}
      #${ID} .eu-col{display:grid;grid-template-columns:54px 92px minmax(0,1.1fr) minmax(0,1.5fr) 64px 20px;gap:12px;align-items:center;padding:0 24px}
      #${ID} .eu-entetes{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#9aa3c0;padding-bottom:8px;border-bottom:1px solid #eef1f8}
      #${ID} .eu-liste{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:#d5dbec transparent}
      #${ID} a.eu-ligne{text-decoration:none;color:inherit;min-height:54px;border-bottom:1px solid #f3f5fa;transition:background .12s}
      #${ID} a.eu-ligne:hover{background:#f7f9ff} #${ID} a.eu-ligne:hover .eu-fleche{transform:translateX(3px);color:#0039b3}
      #${ID} .eu-ste{justify-self:start;font-size:10.5px;font-weight:800;letter-spacing:.05em;color:#fff;border-radius:7px;padding:4px 7px;min-width:38px;text-align:center}
      #${ID} .eu-ste.eu-attente{background:#eef1f8;color:#9aa3c0}
      #${ID} .eu-date{display:flex;align-items:baseline;gap:5px;white-space:nowrap} #${ID} .eu-date b{font-size:17px;font-weight:800;line-height:1} #${ID} .eu-date span{font-size:12px;color:#56608a;font-weight:600}
      #${ID} .eu-duree{display:block;font-size:11px;color:#9aa3c0;margin-top:2px;white-space:nowrap}
      #${ID} .eu-client{font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${ID} .eu-adr{min-width:0} #${ID} .eu-adr div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:#56608a}
      #${ID} .eu-adr .eu-ville{font-size:11px;font-weight:700;letter-spacing:.05em;color:#9aa3c0;text-transform:uppercase;margin-top:1px}
      #${ID} .eu-delai{justify-self:end;font-size:11.5px;font-weight:700;border-radius:999px;padding:4px 9px;white-space:nowrap;background:#eef6ee;color:#2c7a43}
      #${ID} .eu-delai.eu-proche{background:#fff3df;color:#a8650a} #${ID} .eu-delai.eu-urgent{background:#fde8e8;color:#b42318}
      #${ID} .eu-fleche{color:#b9c1da;transition:transform .12s,color .12s;display:flex}
      #${ID} .eu-vide{padding:40px 24px;text-align:center;color:#9aa3c0;font-size:13px}
      #${ID} .eu-pied{display:flex;justify-content:space-between;align-items:center;padding:9px 24px;border-top:1px solid #eef1f8;font-size:11.5px;color:#9aa3c0}
      #${ID} .eu-lien{background:none;border:0;padding:0;font:inherit;color:#56608a;text-decoration:underline;cursor:pointer}
      #${ID}-retour{position:absolute;right:26px;top:8px;background:none;border:0;font:600 11.5px Manrope,system-ui,sans-serif;color:#56608a;text-decoration:underline;cursor:pointer}
    `;
    (document.head || document.documentElement).append(s);
  }
  function el(tag, attrs, ...enfants) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) n.setAttribute(k, v); }
    enfants.flat().forEach((e) => n.append(e instanceof Node ? e : document.createTextNode(String(e))));
    return n;
  }
  const svg = (chemin, taille) => { const d = document.createElement('div'); d.innerHTML = `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${chemin}</svg>`; return d.firstChild; };

  /** « 14 Déc. 2026 » → Date (midi), ou null. */
  function dateUlyss(t) {
    const m = String(t || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{4})$/);
    return m && MOIS[m[2]] !== undefined ? new Date(+m[3], MOIS[m[2]], +m[1], 12) : null;
  }
  /** Lignes de la carte d'Ulyss : [{debut, fin, client, adresse, ville, lien, dossier}]. */
  function lireLignes(cadre) {
    return [...cadre.querySelectorAll('table tbody tr')].map((tr) => {
      const c = tr.cells, a = tr.querySelector('a[href*="/contracts/"]');
      if (!c || c.length < 4) return null;
      const dates = c[0].textContent.replace(/\s+/g, ' ').trim().split(/\s+-\s+/);
      const lien = a ? a.getAttribute('href') : '';
      return { debut: dateUlyss(dates[0]), fin: dateUlyss(dates[1] || dates[0]), brut: dates.join(' – '), client: c[1].textContent.replace(/\s+/g, ' ').trim(), adresse: c[2].textContent.replace(/\s+/g, ' ').trim(), ville: c[3].textContent.replace(/\s+/g, ' ').trim(), lien, dossier: (lien.match(/contracts\/(\d+)/) || [])[1] || '' };
    }).filter(Boolean);
  }

  // ---------- Société de chaque dossier (retrouvée une fois, gardée sur le poste) ----------
  let recherche = null;
  function chercherSocietes(ids, redessiner) {
    const manquants = () => ids.filter((i) => i && !societes[i]);
    if (recherche || !manquants().length) return;
    recherche = (async () => {
      if (manquants().length >= 5) {
        try {
          const doc = new DOMParser().parseFromString(await fetch('/parking_decrees', { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : '')), 'text/html');
          doc.querySelectorAll('tbody tr').forEach((tr) => {
            const ste = tr.cells[1] ? tr.cells[1].textContent.trim().toUpperCase() : '', id = (tr.innerHTML.match(/contracts\/(\d+)/) || [])[1];
            if (id && SOCIETES[ste]) societes[id] = ste;
          });
          ecrire(CLE_STE, societes); redessiner();
        } catch (e) { /* on passera par les dossiers */ }
      }
      for (const id of manquants().slice(0, 40)) {
        try {
          const html = await fetch('/contracts/' + id + '/documents', { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''));
          const ste = LETTRES[(html.match(/DGT[CD]([A-Z])\d{4}-\d{3}/) || [])[1]];
          societes[id] = ste || '?';
          ecrire(CLE_STE, societes); redessiner();
        } catch (e) { break; }
      }
    })().finally(() => { recherche = null; });
  }

  // ---------- Dessin ----------
  function dessiner(cadre) {
    const lignes = lireLignes(cadre);
    const auj = new Date(); auj.setHours(12, 0, 0, 0);
    const compte = { FRA: 0, LDL: 0, BD: 0 };
    lignes.forEach((l) => { const s = societes[l.dossier]; if (compte[s] !== undefined) compte[s]++; });
    const montrees = lignes.filter((l) => !filtre || societes[l.dossier] === filtre);
    const prochaine = lignes.map((l) => l.debut).filter(Boolean).sort((a, b) => a - b)[0];
    const puce = (cle, texte, nb, couleur) => el('button', { class: 'eu-puce', type: 'button', 'aria-pressed': String(filtre === cle), onclick: () => { filtre = cle; poser(true); } }, couleur ? el('i', { style: 'background:' + couleur }) : '', texte, el('b', {}, nb));
    const carte = el('div', { id: ID },
      el('div', { class: 'eu-tete' },
        el('div', { class: 'eu-ico' }, svg('<path d="M9 3h6l1 2h3a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h3z"/><path d="M9 12l2 2 4-4"/>', 22)),
        el('div', { class: 'eu-titres' }, el('div', { class: 'eu-titre' }, 'Demandes d\'autorisation à effectuer'),
          el('div', { class: 'eu-sous' }, prochaine ? 'Prochain déménagement concerné le ' + prochaine.getDate() + ' ' + MOIS_COURTS[prochaine.getMonth()] : 'Stationnement à demander en mairie')),
        el('div', { class: 'eu-nb', title: lignes.length + ' demandes à effectuer' }, lignes.length)),
      el('div', { class: 'eu-puces' }, puce('', 'Toutes', lignes.length), Object.keys(SOCIETES).filter((s) => compte[s]).map((s) => puce(s, s, compte[s], SOCIETES[s].couleur))),
      el('div', { class: 'eu-col eu-entetes' }, el('span', {}, 'Ste'), el('span', {}, 'Date'), el('span', {}, 'Client'), el('span', {}, 'Adresse'), el('span', { style: 'justify-self:end' }, 'Dans'), el('span', {})),
      el('div', { class: 'eu-liste' }, montrees.length ? montrees.map((l) => {
        const s = societes[l.dossier], soc = SOCIETES[s];
        const jours = l.debut ? Math.round((l.debut - auj) / 86400000) : null;
        const duree = l.debut && l.fin && l.fin > l.debut ? 'au ' + l.fin.getDate() + ' ' + MOIS_COURTS[l.fin.getMonth()] : '';
        return el('a', { class: 'eu-col eu-ligne', href: l.lien || '#', 'data-turbo-frame': '_top', title: 'Ouvrir les documents du dossier' },
          el('span', { class: 'eu-ste' + (soc ? '' : ' eu-attente'), style: soc ? 'background:' + soc.couleur : null, title: soc ? soc.nom : 'Société en cours de lecture' }, soc ? s : '···'),
          el('span', {}, l.debut ? el('span', { class: 'eu-date' }, el('b', {}, l.debut.getDate()), el('span', {}, MOIS_COURTS[l.debut.getMonth()])) : l.brut, duree ? el('span', { class: 'eu-duree' }, duree) : ''),
          el('span', { class: 'eu-client', title: l.client }, l.client),
          el('span', { class: 'eu-adr', title: l.adresse + ' — ' + l.ville }, el('div', {}, l.adresse), el('div', { class: 'eu-ville' }, l.ville)),
          jours === null ? el('span', {}) : el('span', { class: 'eu-delai' + (jours <= 7 ? ' eu-urgent' : jours <= 14 ? ' eu-proche' : ''), title: 'Jours avant le déménagement' }, jours < 0 ? 'passé' : jours === 0 ? 'auj.' : 'J-' + jours),
          el('span', { class: 'eu-fleche' }, svg('<path d="M9 6l6 6-6 6"/>', 18)));
      }) : el('div', { class: 'eu-vide' }, lignes.length ? 'Aucune demande pour cette société.' : 'Aucune demande d\'autorisation à effectuer.')),
      el('div', { class: 'eu-pied' }, el('span', {}, 'Rouge : moins de 8 jours · orange : moins de 15 jours'), el('button', { class: 'eu-lien', type: 'button', onclick: () => { ecrire(CLE_VUE, 'origine'); poser(true); } }, 'Affichage d\'origine')));
    return { carte, ids: [...new Set(lignes.map((l) => l.dossier))], signature: lignes.length + '|' + lignes.map((l) => l.dossier + l.brut).join(',') + '|' + filtre + '|' + lignes.map((l) => societes[l.dossier] || '').join('') };
  }

  let derniere = '', hauteur = 0;
  function poser(force) {
    if (window.top !== window || (!HOTES.test(location.hostname) && !essai())) return;
    const cadre = document.getElementById(ID_CADRE);
    if (!cadre) return;
    const origine = [...cadre.children].find((c) => c.id !== ID && c.id !== ID + '-retour' && c.querySelector && c.querySelector('table'));
    if (!origine) return;   // la carte d'Ulyss n'est pas encore chargée
    const mienne = document.getElementById(ID), retour = document.getElementById(ID + '-retour');
    style();
    if (lireJson(CLE_VUE, '') === 'origine' || localStorage.getItem(CLE_VUE) === 'origine') {
      // Affichage d'origine : la carte d'Ulyss, avec un lien discret pour revenir au nouvel affichage.
      if (mienne) mienne.remove();
      origine.style.display = '';
      if (!retour) { cadre.style.position = 'relative'; cadre.append(el('button', { id: ID + '-retour', type: 'button', onclick: () => { try { localStorage.removeItem(CLE_VUE); } catch (e) {} poser(true); } }, 'Nouvel affichage')); }
      derniere = '';
      return;
    }
    if (retour) retour.remove();
    const d = dessiner(cadre);
    if (!force && mienne && d.signature === derniere && origine.style.display === 'none') return;   // rien n'a changé
    derniere = d.signature;
    const defilement = mienne ? (mienne.querySelector('.eu-liste') || {}).scrollTop || 0 : 0;
    if (mienne) mienne.replaceWith(d.carte); else cadre.append(d.carte);
    if (origine.offsetHeight) hauteur = origine.offsetHeight;   // mesurée tant que la carte d'Ulyss est visible
    d.carte.style.height = (hauteur || 442) + 'px';
    origine.style.display = 'none';
    d.carte.querySelector('.eu-liste').scrollTop = defilement;
    chercherSocietes(d.ids, () => poser());
  }

  let prevu = false;
  const passer = () => { if (prevu || location.pathname.indexOf('/dashboard') !== 0) return; prevu = true; requestAnimationFrame(() => { prevu = false; try { poser(); } catch (e) {} }); };
  document.addEventListener('turbo:load', passer);
  document.addEventListener('turbo:frame-load', passer);
  new MutationObserver(passer).observe(document.documentElement, { childList: true, subtree: true });
  passer();
})();
