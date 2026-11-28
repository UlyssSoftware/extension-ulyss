/*
 * Extension Ulyss — repère « Déplacement » (28/11/2026, demande de Guillaume).
 *  1. Écran Pré-planification : une coche « Déplacement » dans l'EN-TÊTE DE LA PHASE (à côté de son titre et de ses dates).
 *     Cochée, elle dit que cette phase entraîne des découchés. Elle vaut pour cette phase et elle seule : elle ne se reporte
 *     jamais sur les autres phases du même dossier (Guillaume, 12 h 02). Gardée sur ulyss-software.com/extension-ulyss/
 *     deplacement/ (identifiants de la phase et du dossier, numéro du dossier, aucun nom). Rien n'est écrit dans Ulyss.
 *  2. Planning : les cartes de la phase cochée sont entourées d'un liseré rouge fin, sur TOUTE sa durée (y compris les
 *     premiers jours, où personne ne découche encore) : l'équipe qui commence ce chantier découchera.
 * Reconnaître les cartes d'une phase (relevés production du 28/11/2026) :
 *   - vue semaine (/exploitation_requirements) : la carte porte un lien /contracts/<id> (le dossier), pas la phase ;
 *   - la phase d'une carte ne se lit que dans /exploitation_requirements/<carte>/edit (un seul « contracts/<id>/phases/<phase> »),
 *     page lente (7 à 8 s) : elle n'est lue que pour les cartes d'un dossier qui a une phase cochée ET plusieurs phases, une
 *     seule fois par carte tous postes confondus (le résultat est retenu sur le serveur), et une carte à la fois ;
 *   - dossier à une seule phase : toute carte du dossier est celle de la phase, sans aucune lecture ;
 *   - écrans d'affectation (jour, normal et compact) : les cartes ne portent pas le dossier → entourées d'après les
 *     identifiants déjà retenus (appris dès qu'un poste affiche la vue semaine). Aucune lecture en arrière-plan : la vue
 *     semaine met près de 15 s à répondre.
 */
(() => {
  'use strict';
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const PHASES = /^\/contracts\/(\d+)\/phases(?:\/(\d+))?\/?$/;
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
    garder(r.corps.phases || {});
    return r.corps.phases || {};
  }
  // Phases cochées : { <id phase>: { dossier, ref, depuis, nb, cartes: [<id carte>], autres: [<id carte>] } }, gardées un court moment.
  let memo = null;
  function garder(phases) { memo = { quand: Date.now(), phases }; try { localStorage.setItem(CLE, JSON.stringify(memo)); } catch (e) {} }
  function enMemoire() {
    if (!memo) { try { memo = JSON.parse(localStorage.getItem(CLE) || 'null'); } catch (e) { memo = null; } }
    return memo && memo.phases ? memo : null;
  }
  let lecture = null;
  /** Liste à jour (au plus une demande au serveur toutes les 2 minutes ; « frais » force la demande). */
  function liste(frais) {
    const m = enMemoire();
    if (!frais && m && Date.now() - m.quand < FRAICHEUR) return Promise.resolve(m.phases);
    if (!lecture) lecture = serveur({ action: 'lire' }, true).catch(() => { const x = enMemoire(); if (x) { x.quand = Date.now(); memo = x; } return x ? x.phases : {}; }).finally(() => { lecture = null; });
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
  /** Phase affichée : turbo-frame#edit-phase-<id> de son en-tête, sinon l'adresse, sinon les étapes. */
  function phaseAffichee(titre) {
    const cadre = titre && titre.parentElement ? titre.parentElement.querySelector('turbo-frame[id^="edit-phase-"]') : null;
    if (cadre) return cadre.id.replace(/\D/g, '');
    const parAdresse = (location.pathname.match(PHASES) || [])[2];
    if (parAdresse) return parAdresse;
    try { const evs = JSON.parse(document.querySelector('[data-events]').getAttribute('data-events') || '[]'); return evs.map((e) => (String(e.url || '').match(/phases\/(\d+)/) || [])[1]).find(Boolean) || ''; } catch (e) { return ''; }
  }
  /** Nombre de phases du dossier : compteur « 1/3 » à droite de l'en-tête, sinon les liens vers les phases. */
  function nombreDePhases(titre, dossier) {
    const rang = titre && titre.parentElement && titre.parentElement.parentElement;
    for (const z of rang ? rang.children : []) { const m = z.textContent.replace(/\s+/g, '').match(/^(\d+)\/(\d+)$/); if (m) return Math.max(1, +m[2]); }
    const vues = new Set();
    document.querySelectorAll('a[href*="/phases/"]').forEach((a) => { const m = (a.getAttribute('href') || '').match(new RegExp('^/contracts/' + dossier + '/phases/(\\d+)$')); if (m) vues.add(m[1]); });
    return Math.max(1, vues.size);
  }
  function poserCoche() {
    const m = location.pathname.match(PHASES);
    const deja = document.getElementById(ID_COCHE);
    const titre = document.getElementById('phase-title');
    if (!m || !document.querySelector('[data-events]') || !titre) { if (deja) deja.remove(); return; }
    const phase = phaseAffichee(titre);
    if (!phase) { if (deja) deja.remove(); return; }
    if (deja && deja.dataset.phase === phase && deja.isConnected && deja.parentElement === titre.parentElement) return;
    if (deja) deja.remove();
    const ref = numeroDossier();
    if (!ref) return;
    const dossier = m[1], nb = nombreDePhases(titre, dossier);
    const boite = document.createElement('label');
    boite.id = ID_COCHE; boite.dataset.phase = phase;
    boite.title = 'Cette phase entraîne des découchés : ses cartes sont entourées de rouge au Planning, du premier au dernier jour. La coche ne vaut que pour cette phase (Extension Ulyss)';
    boite.style.cssText = 'display:inline-flex;align-items:center;gap:7px;margin-left:14px;padding:5px 11px;border:1px solid #d5dae3;border-radius:8px;background:#fff;font-size:14px;font-weight:400;line-height:1;letter-spacing:0;text-transform:none;color:#1f2a44;cursor:pointer;user-select:none;white-space:nowrap';
    const case_ = document.createElement('input');
    case_.type = 'checkbox'; case_.disabled = true; case_.style.cssText = 'width:16px;height:16px;margin:0;accent-color:#dc2626;cursor:pointer';
    const texte = document.createElement('span'); texte.textContent = 'Déplacement';
    boite.append(case_, texte);
    const montrer = (phases) => { const oui = !!phases[phase]; case_.checked = oui; boite.style.borderColor = oui ? '#dc2626' : '#d5dae3'; boite.style.boxShadow = oui ? '0 0 0 1px #dc2626' : 'none'; };
    const echec = (e) => { texte.textContent = 'Déplacement (indisponible)'; boite.title = 'Repère « Déplacement » indisponible : ' + ((e && e.message) || e); };
    // Dans l'en-tête de la phase : après ses dates (avant le menu ⋮ de la phase).
    const dates = titre.parentElement.querySelector('#phase-dates') || titre;
    dates.insertAdjacentElement('afterend', boite);
    serveur({ action: 'lire' }).then((p) => {
      montrer(p); case_.disabled = false;
      // Le dossier a une phase cochée et son nombre de phases a changé : le dire au serveur (les cartes seront vérifiées une à une).
      if (Object.values(p).some((x) => String(x.dossier) === dossier && (x.nb || 1) !== nb)) return serveur({ action: 'phases', dossier, nb }, true).then(montrer);
    }).catch(echec);
    case_.addEventListener('change', async () => {
      const voulu = case_.checked;
      case_.disabled = true;
      try {
        montrer(await serveur({ action: 'cocher', phase, dossier, ref, nb, coche: voulu }));   // l'état affiché est celui que le serveur renvoie
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
  // Vérifications en attente : une carte à la fois (la page /edit est lente), jamais deux fois la même carte.
  const enVerification = new Set();
  let file = Promise.resolve(), envoi = null;
  function retenir(oui, non) {
    if (!Object.keys(oui).length && !Object.keys(non).length) return;
    envoi = (envoi || Promise.resolve()).then(() => serveur({ action: 'cartes', oui, non }, true)).then(() => marquer(), () => {});
  }
  /** Lit la phase d'une carte dans sa page /edit, puis range la carte : « oui » pour sa phase si elle est cochée, « non » pour les autres. */
  function verifier(er, phasesDuDossier) {
    if (enVerification.has(er)) return;
    enVerification.add(er);
    file = file.then(async () => {
      try {
        const html = await fetch('/exploitation_requirements/' + er + '/edit', { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''));
        const trouvee = (html.match(/contracts\/\d+\/phases\/(\d+)/) || [])[1];
        if (!trouvee) { enVerification.delete(er); return; }   // page illisible : on réessaiera à un prochain affichage
        const oui = {}, non = {};
        phasesDuDossier.forEach((p) => { ((p === trouvee ? oui : non)[p] = []).push(er); });
        retenir(oui, non);
      } catch (e) { enVerification.delete(er); }
    });
  }
  async function marquer() {
    if (!location.pathname.startsWith('/exploitation_requirements')) return;
    const cartes = [...document.querySelectorAll('[id^="card_exploitation_requirement_"]')];
    if (!cartes.length) return;
    const phases = await liste();
    const ids = Object.keys(phases);
    const retenues = new Set(), parDossier = {};
    ids.forEach((p) => { (phases[p].cartes || []).forEach((er) => retenues.add(er)); (parDossier[phases[p].dossier] = parDossier[phases[p].dossier] || []).push(p); });
    style();
    const oui = {};
    cartes.forEach((c) => {
      const er = idCarte(c), d = dossierDeCarte(c), duDossier = d ? parDossier[d] : null;
      let rouge = retenues.has(er);
      if (!rouge && duDossier && er) {
        const inconnues = duDossier.filter((p) => !(phases[p].autres || []).includes(er));
        if (inconnues.length) {
          // Dossier à une seule phase : la carte est forcément celle de la phase cochée. Sinon, lire la phase de la carte.
          if (duDossier.length === 1 && (phases[duDossier[0]].nb || 1) === 1) { rouge = true; if (!enVerification.has(er)) { enVerification.add(er); (oui[duDossier[0]] = oui[duDossier[0]] || []).push(er); } }
          else verifier(er, duDossier);
        }
      }
      c.classList.toggle(CLASSE, rouge);
    });
    retenir(oui, {});
  }

  // Un seul passage par image affichée, et seulement sur les deux écrans concernés.
  let prevu = false;
  function passer() {
    if (window.__extUlyssActif && !window.__extUlyssActif('deplacement')) return;
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
