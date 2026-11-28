/*
 * Extension Ulyss — repère « Déplacement » (28/11/2026, demande de Guillaume).
 *  1. Écran Pré-planification d'un dossier : une coche « Déplacement ». Cochée, elle dit que ce déménagement entraîne des
 *     découchés. Elle est gardée sur ulyss-software.com/extension-ulyss/deplacement/ (numéro et identifiant du dossier,
 *     aucun nom), commune à tous les postes équipés de l'extension. Rien n'est écrit dans Ulyss.
 *  2. Planning : les cartes des dossiers cochés sont entourées d'un liseré rouge fin, sur TOUTE la durée du déménagement
 *     (y compris les premiers jours, où personne ne découche encore) : l'équipe qui commence ce chantier découchera.
 * Reconnaître les cartes sans rien demander de plus à Ulyss (relevé production du 28/11/2026) :
 *   - vue semaine (/exploitation_requirements) : chaque carte porte un lien /contracts/<id> → reconnue directement ;
 *     l'identifiant de la carte est alors retenu sur le serveur ;
 *   - écrans d'affectation (jour, normal et compact) : les cartes ne portent pas le dossier → reconnues par les identifiants
 *     retenus. S'il y a des dossiers cochés et que la semaine affichée n'a pas encore été vue pendant cette session, la vue
 *     semaine est lue une fois en arrière-plan (une requête par semaine et par session, jamais plus).
 */
(() => {
  'use strict';
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const PHASES = /^\/contracts\/(\d+)\/phases(?:\/\d+)?\/?$/;
  const ID_COCHE = 'ext-ulyss-deplacement';
  const CLASSE = 'ext-ulyss-carte-deplacement';
  const CLE = 'ext-ulyss-deplacement';
  const FRAICHEUR = 2 * 60000;   // le Planning ne redemande pas la liste au serveur plus d'une fois toutes les 2 minutes
  const essai = () => !!window.__extUlyssRdvEssai;

  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => {
      try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false, motif: "l'extension ne répond pas (recharger la page)" }); }); }
      catch (e) { ok({ ok: false, motif: "l'extension a été mise à jour : recharger la page" }); }
    });
  }
  async function serveur(donnees, silencieux) {
    const r = await demander({ type: 'gc-rdv', cible: 'deplacement', donnees: { instance: location.hostname, ...donnees } });
    if (r && !r.ok && r.motif === 'code') {
      if (silencieux || !window.__gcDemanderCode) throw new Error('code');
      await new Promise((ok) => window.__gcDemanderCode(ok));
      return serveur(donnees, true);
    }
    if (!r || !r.ok) throw new Error((r && r.motif) || 'pas de réponse');
    if (!r.corps || !r.corps.ok) throw new Error((r.corps && r.corps.erreur) || 'réponse illisible du serveur (code ' + r.statut + ') : le dossier « deplacement » est-il déposé ?');
    garder(r.corps.dossiers || {});
    return r.corps.dossiers || {};
  }
  // Liste des dossiers cochés : { <id dossier>: { ref, depuis, cartes: [<id carte>] } }, gardée un court moment sur le poste.
  let memo = null;
  function garder(dossiers) { memo = { quand: Date.now(), dossiers }; try { localStorage.setItem(CLE, JSON.stringify(memo)); } catch (e) {} }
  function enMemoire() {
    if (!memo) { try { memo = JSON.parse(localStorage.getItem(CLE) || 'null'); } catch (e) { memo = null; } }
    return memo && memo.dossiers ? memo : null;
  }
  let lecture = null;
  /** Liste à jour (au plus une demande au serveur toutes les 2 minutes ; « frais » force la demande). */
  function liste(frais) {
    const m = enMemoire();
    if (!frais && m && Date.now() - m.quand < FRAICHEUR) return Promise.resolve(m.dossiers);
    if (!lecture) lecture = serveur({ action: 'lire' }, true).catch(() => { const x = enMemoire(); if (x) { x.quand = Date.now(); memo = x; } return x ? x.dossiers : {}; }).finally(() => { lecture = null; });
    return lecture;
  }

  // ---------------------------------------------------------------------------
  // 1. La coche de l'écran Pré-planification
  // ---------------------------------------------------------------------------
  function numeroDossier() {
    const zones = [document.querySelector('#contract_header_banner #subtitle'), document.querySelector('#contract_header_banner'), document.querySelector('h2#subtitle'), document.querySelector('main') || document.body];
    for (const z of zones) {
      const m = z && z.textContent.match(/DGT[CD][A-Z]\d{4}-\d{3}(?:_\d+)?/);
      if (m) return m[0];
    }
    return '';
  }
  function poserCoche() {
    const m = location.pathname.match(PHASES);
    const deja = document.getElementById(ID_COCHE);
    if (!m || !document.querySelector('[data-events]')) { if (deja) deja.remove(); return; }
    if (deja && deja.dataset.dossier === m[1]) return;
    if (deja) deja.remove();
    const ref = numeroDossier();
    if (!ref) return;
    const affichage = [...document.querySelectorAll('a.btn, button')].find((b) => b.textContent.trim().toLowerCase() === 'affichage');
    const boite = document.createElement('label');
    boite.id = ID_COCHE; boite.dataset.dossier = m[1];
    boite.title = 'Ce déménagement entraîne des découchés : ses cartes sont entourées de rouge au Planning, du premier au dernier jour (Extension Ulyss)';
    boite.style.cssText = 'display:inline-flex;align-items:center;gap:7px;margin-left:12px;padding:6px 12px;border:1px solid #d5dae3;border-radius:8px;background:#fff;font-size:14px;line-height:1;color:#1f2a44;cursor:pointer;user-select:none;white-space:nowrap;vertical-align:middle';
    const case_ = document.createElement('input');
    case_.type = 'checkbox'; case_.disabled = true; case_.style.cssText = 'width:16px;height:16px;margin:0;accent-color:#dc2626;cursor:pointer';
    const texte = document.createElement('span'); texte.textContent = 'Déplacement';
    boite.append(case_, texte);
    const montrer = (dossiers) => { const oui = !!dossiers[m[1]]; case_.checked = oui; boite.style.borderColor = oui ? '#dc2626' : '#d5dae3'; boite.style.boxShadow = oui ? '0 0 0 1px #dc2626' : 'none'; };
    const echec = (e) => { texte.textContent = 'Déplacement (indisponible)'; boite.title = 'Repère « Déplacement » indisponible : ' + ((e && e.message) || e); };
    const ancre = document.getElementById('limodem-bouton-rappel') || (affichage ? affichage.closest('.dropdown') || affichage : null);
    if (ancre) ancre.insertAdjacentElement('afterend', boite); else document.querySelector('[data-events]').insertAdjacentElement('beforebegin', boite);
    serveur({ action: 'lire' }).then((d) => { montrer(d); case_.disabled = false; }).catch(echec);
    case_.addEventListener('change', async () => {
      const voulu = case_.checked;
      case_.disabled = true;
      try {
        montrer(await serveur({ action: 'cocher', id: m[1], ref, coche: voulu }));   // l'état affiché est celui que le serveur renvoie
        texte.textContent = 'Déplacement';
      } catch (e) { case_.checked = !voulu; echec(e); }
      case_.disabled = false;
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Le liseré rouge au Planning
  // ---------------------------------------------------------------------------
  function style() {
    if (document.getElementById(CLASSE + '-style')) return;
    const s = document.createElement('style');
    s.id = CLASSE + '-style';
    s.textContent = '.' + CLASSE + '{outline:2px solid #dc2626 !important;outline-offset:-2px}';
    (document.head || document.documentElement).append(s);
  }
  const idCarte = (c) => (c.id.match(/(\d+)$/) || [])[1] || '';
  function dossierDeCarte(c) {
    for (const a of c.querySelectorAll('a[href^="/contracts/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/contracts\/(\d+)(?:[/?#]|$)/);
      if (m) return m[1];
    }
    return '';
  }
  const semainesVues = new Set();
  let envoi = null;
  /** Apprend au serveur les cartes reconnues ({ <id dossier>: [<id carte>] }). */
  function retenir(nouvelles) {
    if (!Object.keys(nouvelles).length) return;
    envoi = (envoi || Promise.resolve()).then(() => serveur({ action: 'cartes', cartes: nouvelles }, true)).then(marquer, () => {});
  }
  function apprendre(doc, dossiers) {
    const nouvelles = {};
    doc.querySelectorAll('[id^="card_exploitation_requirement_"]').forEach((c) => {
      const d = dossierDeCarte(c), er = idCarte(c);
      if (d && er && dossiers[d] && !(dossiers[d].cartes || []).includes(er)) (nouvelles[d] = nouvelles[d] || []).push(er);
    });
    return nouvelles;
  }
  async function marquer() {
    if (!location.pathname.startsWith('/exploitation_requirements')) return;
    const cartes = [...document.querySelectorAll('[id^="card_exploitation_requirement_"]')];
    if (!cartes.length) return;
    const dossiers = await liste();
    const ids = Object.keys(dossiers);
    const parCarte = new Set();
    ids.forEach((d) => (dossiers[d].cartes || []).forEach((er) => parCarte.add(er)));
    style();
    let sansDossier = 0;
    cartes.forEach((c) => {
      const d = dossierDeCarte(c);
      if (!d) sansDossier++;
      const oui = d ? !!dossiers[d] : parCarte.has(idCarte(c));
      c.classList.toggle(CLASSE, oui);
      if (oui) c.dataset.extUlyssDeplacement = '1'; else delete c.dataset.extUlyssDeplacement;
    });
    if (!ids.length) return;
    retenir(apprendre(document, dossiers));
    // Écran d'affectation (aucune carte ne porte son dossier) : lire une fois la vue semaine du jour affiché pour apprendre ses cartes.
    const jour = new URLSearchParams(location.search).get('date') || '';
    if (sansDossier === cartes.length && /^\d{4}-\d{2}-\d{2}$/.test(jour) && !semainesVues.has(jour)) {
      semainesVues.add(jour);
      try {
        const html = await fetch('/exploitation_requirements?date=' + jour, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''));
        retenir(apprendre(new DOMParser().parseFromString(html, 'text/html'), dossiers));
      } catch (e) { /* on réessaiera à la prochaine session */ }
    }
  }

  // Un seul passage par image affichée, et seulement sur les deux écrans concernés.
  let prevu = false;
  function passer() {
    if (prevu || window.top !== window || (!HOTES.test(location.hostname) && !essai())) return;
    const p = location.pathname;
    if (!PHASES.test(p) && !p.startsWith('/exploitation_requirements') && !document.getElementById(ID_COCHE)) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; try { poserCoche(); } catch (e) {} marquer().catch(() => {}); });
  }
  document.addEventListener('turbo:load', passer);
  document.addEventListener('turbo:frame-load', passer);
  new MutationObserver(passer).observe(document.documentElement, { childList: true, subtree: true });
  passer();
})();
