/*
 * Extension Ulyss — modules activés ou désactivés (28/11/2026, demande de Guillaume). Chargé AVANT tous les autres scripts.
 *  - Une entrée « Extension » en bas de la barre latérale ouvre les réglages, visibles par tout le monde.
 *  - Chaque module a deux interrupteurs : « Pour tout le monde » et « Sur ce poste ».
 *      · « Sur ce poste » : chacun peut couper pour lui un module resté actif ; ce choix ne quitte pas le poste.
 *      · « Pour tout le monde » : demande le code d'accès de l'extension (celui des tarifs, que seul Guillaume connaît) ;
 *        le réglage est gardé sur ulyss-software.com/extension-ulyss/modules/ et suivi par tous les postes.
 *      · Un module coupé pour tout le monde ne peut pas être rallumé sur un poste… sauf avec le code d'accès : l'interrupteur
 *        « Sur ce poste » d'un module coupé pour tous se rallume alors pour CE poste seulement (28/11, 13 h 01 : couper pour
 *        les autres mais pas pour soi, pour faire des essais). Cette exception reste sur le poste (liste « exempt »).
 *  - Les autres scripts demandent window.__extUlyssActif('<module>') avant d'agir : réponse immédiate, lue dans la mémoire du
 *    poste (le réglage commun y est recopié au plus toutes les 5 minutes). Un changement s'applique au rechargement de la page.
 *  - Le serveur ne reçoit jamais le code : seulement une preuve dérivée (PBKDF2), calculée ici après contrôle du code.
 */
(() => {
  'use strict';
  const HOTES = /^(fraisseix\.staging\.unova\.fr|ulyss\.fr)$/;
  const CLE = 'ext-ulyss-modules';
  const ID_ENTREE = 'ext-ulyss-raccourci-reglages';
  const FRAICHEUR = 5 * 60000;
  const MODULES = [
    ['chiffrage', 'Chiffrage', 'Panneau de la grille, forfaits et contrôle des moyens dans la pré-planification'],
    ['rdv', 'Confirmation de rendez-vous', 'Bouton et e-mail de confirmation du rendez-vous'],
    ['rappel', 'Lettre de voiture et rappel', 'Bouton « Lettre de voiture » de la pré-planification et e-mail de rappel au client'],
    ['prix', 'Niveau de prix', 'Dans la liste des dossiers : mode de chiffrage et écart par rapport à la grille'],
    ['commercial', 'Activité commerciale', 'Écran de suivi commercial et relevé quotidien des dossiers'],
    ['demande-avis', 'Demande d\'avis', 'Bouton « Demander un avis » de l\'écran Devis'],
    ['avis', 'Avis clients', 'Module de la barre latérale et relevé des avis Google le matin'],
    ['charge', 'Taux de charge', 'Module de la barre latérale, bouton du Planning et lecture du Planning le matin'],
    ['deplacement', 'Déplacement', 'Coche de la phase et liseré rouge au Planning'],
    ['logos', 'Logos', 'Logo de la barre latérale et logo en haut des pages'],
  ];
  // Modules RÉSERVÉS (28/11/2026) : coupés pour tout le monde d'office, sur tous les postes et sans passer par le serveur.
  // Ils ne s'allument que poste par poste, avec le code d'accès (« Sur ce poste »). « Activité commerciale » : Guillaume seul pour le moment.
  const RESERVES = ['commercial'];
  const avecReserves = (c) => c.concat(RESERVES.filter((n) => c.indexOf(n) < 0));
  const lire = () => { try { const m = JSON.parse(localStorage.getItem(CLE) || 'null'); return m && typeof m === 'object' ? { coupes: avecReserves(m.coupes || []), poste: m.poste || [], exempt: m.exempt || [], quand: m.quand || 0 } : { coupes: avecReserves([]), poste: [], exempt: [], quand: 0 }; } catch (e) { return { coupes: avecReserves([]), poste: [], exempt: [], quand: 0 }; } };
  const garder = (m) => { try { localStorage.setItem(CLE, JSON.stringify(m)); } catch (e) {} };
  // État au chargement de la page : c'est lui qui vaut jusqu'au rechargement (pas de bouton à moitié retiré).
  const depart = lire();
  // Actif si le module n'est pas coupé pour tous (ou si ce poste en est exempté), et pas coupé sur ce poste.
  window.__extUlyssActif = (nom) => (depart.coupes.indexOf(nom) < 0 || depart.exempt.indexOf(nom) >= 0) && depart.poste.indexOf(nom) < 0;

  const EXT = (() => { try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) { return null; } })();
  function demander(msg) {
    if (window.__extUlyssRdvEssai) return window.__extUlyssRdvEssai(msg);
    return new Promise((ok) => {
      try { EXT.sendMessage(msg, (r) => { void chrome.runtime.lastError; ok(r || { ok: false, motif: "l'extension ne répond pas (recharger la page)" }); }); }
      catch (e) { ok({ ok: false, motif: "l'extension a été mise à jour : recharger la page" }); }
    });
  }
  async function serveur(donnees) {
    const r = await demander({ type: 'gc-rdv', cible: 'modules', donnees: { instance: location.hostname, ...donnees } });
    if (!r || !r.ok) throw new Error(r && r.motif === 'code' ? 'code d\'accès de l\'extension jamais saisi sur ce poste' : (r && r.motif) || 'pas de réponse');
    if (!r.corps) throw new Error('réponse illisible du serveur (code ' + r.statut + ') : le dossier « modules » est-il déposé ?');
    if (Array.isArray(r.corps.coupes)) { const m = lire(); m.coupes = r.corps.coupes; m.quand = Date.now(); garder(m); }
    if (!r.corps.ok) throw new Error(r.corps.erreur || 'refusé');
    return r.corps;
  }
  /** Réglage commun recopié sur le poste, au plus toutes les 5 minutes. */
  function rafraichir() {
    if (window.top !== window || (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai)) return;
    if (Date.now() - lire().quand < FRAICHEUR) return;
    const m = lire(); m.quand = Date.now(); garder(m);   // pas deux demandes de suite si le serveur ne répond pas
    serveur({ action: 'lire' }).catch(() => {});
  }
  /** Preuve du code d'accès : PBKDF2-SHA256 du code (jamais le code lui-même), en hexadécimal. */
  async function preuveDuCode(code) {
    const enc = new TextEncoder();
    const cle = await crypto.subtle.importKey('raw', enc.encode(String(code)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('extension-ulyss/modules'), iterations: 150000 }, cle, 256);
    return Array.prototype.map.call(new Uint8Array(bits), (o) => ('0' + o.toString(16)).slice(-2)).join('');
  }

  // ---------------------------------------------------------------------------
  // Fenêtre des réglages
  // ---------------------------------------------------------------------------
  const CSS = `
    :host{all:initial}
    .voile{position:fixed;inset:0;background:rgba(15,23,42,.38);backdrop-filter:blur(2px);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 12px;font-family:Inter,'Segoe UI',system-ui,-apple-system,Arial,sans-serif}
    .fen{background:#fff;width:min(820px,100%);border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.28);color:#1f2a44;font-size:13px;overflow:hidden}
    .tete{padding:20px 26px 12px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
    .tete b{font-size:19px;font-weight:650;display:block} .tete small{display:block;color:#6b7689;font-size:12.5px;margin-top:3px;line-height:1.45}
    .x{background:#f1f3f7;border:0;border-radius:10px;width:32px;height:32px;color:#4a5568;font-size:15px;cursor:pointer;flex:none}
    .grille{display:grid;grid-template-columns:1fr 130px 110px;align-items:center;padding:0 26px}
    .entetes{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a94a6;padding-bottom:8px;border-bottom:1px solid #e6e9ef}
    .entetes span:not(:first-child),.c{justify-self:center;text-align:center}
    .ligne{border-bottom:1px solid #f0f2f6;min-height:58px}
    .nom{font-weight:650;font-size:14px} .desc{color:#6b7689;font-size:12px;margin-top:2px;padding-right:14px}
    .inter{appearance:none;-webkit-appearance:none;width:40px;height:22px;border-radius:999px;background:#d5dae3;position:relative;cursor:pointer;margin:0;transition:background .15s;border:0}
    .inter::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
    .inter:checked{background:#2d7d8a} .inter:checked::after{left:21px} .inter:disabled{opacity:.4;cursor:default}
    .inter.tous:checked{background:#1f2a44} .inter.exempt:checked{background:#c2410c}
    .code{display:flex;gap:8px;align-items:center;margin:0 26px 12px;padding:12px 14px;background:#f5f7fa;border-radius:12px}
    .code input{flex:1;border:1px solid #d5dae3;border-radius:8px;padding:8px 10px;font-size:13px;color:#1f2a44}
    .btn{border:0;border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer;font-size:12.5px;background:#1f2a44;color:#fff} .btn:disabled{opacity:.5;cursor:default}
    .sec{background:#fff;color:#1f2a44;border:1px solid #d5dae3}
    .pied{display:flex;gap:10px;align-items:center;padding:14px 26px 18px;flex-wrap:wrap}
    .msg{flex:1;min-width:200px;font-size:12.5px;color:#6b7689} .err{color:#c0392b} .ok{color:#23774a}
    .version{font-size:12px;color:#6b7689}
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
  let ouvert = null;
  function ouvrir() {
    if (ouvert && ouvert.isConnected) return;
    const hote = el('div'); ouvert = hote;
    document.body.append(hote);
    const racine = hote.attachShadow({ mode: 'open' });
    racine.append(el('style', {}, CSS));
    let change = false, preuve = '', attente = null;   // attente = action en suspens tant que le code n'est pas donné : [module, actif] pour tous, ou [module, 'exempt']
    const fermer = () => { hote.remove(); if (change) location.reload(); };
    const msg = el('span', { class: 'msg' }), lignes = el('div', {}), zoneCode = el('div', {});
    const dire = (t, genre) => { msg.textContent = t || ''; msg.className = 'msg' + (genre ? ' ' + genre : ''); };

    async function reglerPourTous(nom, actif) {
      dire('Enregistrement…');
      try {
        await serveur({ action: 'regler', modules: { [nom]: actif }, preuve });
        change = true; dire('Enregistré pour tout le monde. Les autres postes suivent dans les 5 minutes, au rechargement de leur page.', 'ok');
      } catch (e) {
        if (/refusé/i.test(e.message)) preuve = '';
        dire('Réglage non enregistré : ' + String(e.message).replace(/\.$/, '') + '.', 'err');
      }
      dessiner();
    }
    function demanderCode() {
      const champ = el('input', { type: 'password', placeholder: 'Code d\'accès de l\'extension', autocomplete: 'off' });
      const valider = async () => {
        if (!champ.value) return;
        bouton.disabled = true; dire('Contrôle du code…');
        const r = await demander({ type: 'gc-code', code: champ.value });
        if (!r || !r.ok) { bouton.disabled = false; dire(r && r.motif === 'code' ? 'Code incorrect.' : 'Contrôle impossible : ' + ((r && r.motif) || 'pas de réponse') + '.', 'err'); return; }
        preuve = await preuveDuCode(champ.value);
        zoneCode.replaceChildren();
        const a = attente; attente = null;
        if (a && a[1] === 'exempt') exempter(a[0]); else if (a) reglerPourTous(a[0], a[1]); else dire('');
      };
      const bouton = el('button', { class: 'btn', onclick: valider }, 'Valider');
      champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') valider(); });
      zoneCode.replaceChildren(el('div', { class: 'code' }, el('span', {}, 'Code d\'accès demandé :'), champ, bouton,
        el('button', { class: 'btn sec', onclick: () => { attente = null; zoneCode.replaceChildren(); dessiner(); dire(''); } }, 'Annuler')));
      champ.focus();
    }
    /** Garde actif sur ce poste un module coupé pour tout le monde (code d'accès déjà contrôlé). */
    function exempter(nom) {
      const x = lire(); if (x.exempt.indexOf(nom) < 0) x.exempt.push(nom); x.poste = x.poste.filter((n) => n !== nom); garder(x);
      change = true; dire('Gardé actif sur ce poste seulement ; il reste coupé pour les autres. La page se recharge à la fermeture.', 'ok');
      dessiner();
    }
    function dessiner() {
      const m = lire();
      // Une exception n'a de sens que tant que le module est coupé pour tous.
      if (m.exempt.some((n) => m.coupes.indexOf(n) < 0)) { m.exempt = m.exempt.filter((n) => m.coupes.indexOf(n) >= 0); garder(m); }
      lignes.replaceChildren(...MODULES.map(([nom, titre, desc]) => {
        const coupe = m.coupes.indexOf(nom) >= 0, perso = m.poste.indexOf(nom) >= 0;
        const tous = el('input', { type: 'checkbox', class: 'inter tous', title: 'Activer ou désactiver pour tous les postes (code d\'accès demandé)', onchange: () => {
          const voulu = tous.checked;
          if (preuve) reglerPourTous(nom, voulu); else { attente = [nom, voulu]; demanderCode(); }
        } });
        tous.checked = !coupe;
        if (RESERVES.indexOf(nom) >= 0) { tous.disabled = true; tous.title = 'Module réservé pour le moment : il s\'allume poste par poste, avec le code d\'accès (colonne « Sur ce poste »).'; }
        const exempte = coupe && m.exempt.indexOf(nom) >= 0;
        const poste = el('input', { type: 'checkbox', class: 'inter' + (exempte ? ' exempt' : ''), title: exempte ? 'Coupé pour tout le monde, gardé actif sur ce poste (code d\'accès)' : coupe ? 'Coupé pour tout le monde. Le rallumer sur ce poste seulement demande le code d\'accès.' : 'Activer ou désactiver sur ce poste seulement', onchange: () => {
          if (coupe) {
            // Module coupé pour tous : le garder actif ici demande le code ; l'éteindre retire simplement l'exception.
            if (!poste.checked) { const x = lire(); x.exempt = x.exempt.filter((n) => n !== nom); garder(x); change = true; dire('Exception retirée : coupé sur ce poste comme pour les autres.', 'ok'); dessiner(); return; }
            if (preuve) exempter(nom); else { attente = [nom, 'exempt']; demanderCode(); }
            return;
          }
          const x = lire(); x.poste = x.poste.filter((n) => n !== nom); if (!poste.checked) x.poste.push(nom); garder(x);
          change = true; dire('Enregistré pour ce poste. La page se recharge à la fermeture.', 'ok');
        } });
        poste.checked = coupe ? exempte : !perso;
        return el('div', { class: 'grille ligne' }, el('div', {}, el('div', { class: 'nom' }, titre), el('div', { class: 'desc' }, desc + (exempte ? ' — coupé pour les autres, actif ici' : RESERVES.indexOf(nom) >= 0 ? ' — réservé : s\'allume sur ce poste avec le code d\'accès' : coupe ? ' — coupé pour tout le monde' : ''))), el('div', { class: 'c' }, tous), el('div', { class: 'c' }, poste));
      }));
    }
    const version = el('span', { class: 'version' }, EXT ? 'Version ' + EXT.getManifest().version : '');
    const bMaj = el('button', { class: 'btn sec', onclick: async () => {
      bMaj.disabled = true; dire('Vérification des mises à jour…');
      const r = await demander({ type: 'gc-verifier', force: true });
      bMaj.disabled = false;
      if (!r || !r.etat) { dire('Vérification impossible.', 'err'); return; }
      dire(r.etat === 'a_jour' ? 'L\'extension est à jour (version ' + r.chargee + ').' : r.etat === 'telechargee' ? 'Version ' + r.publiee + ' téléchargée : fermer cette fenêtre, le bandeau d\'Ulyss propose de recharger l\'extension.' : 'Mise à jour : ' + (r.motif || r.etat) + '.', r.etat === 'echec' ? 'err' : 'ok');
    } }, 'Vérifier les mises à jour');
    racine.append(el('div', { class: 'voile', onclick: (e) => { if (e.target === e.currentTarget) fermer(); } },
      el('div', { class: 'fen' },
        el('div', { class: 'tete' }, el('div', {}, el('b', {}, 'Extension Ulyss'), el('small', {}, 'Activer ou désactiver chaque module. « Sur ce poste » ne concerne que vous. « Pour tout le monde » s\'impose à tous les postes et demande le code d\'accès : un module coupé pour tous ne peut être rallumé sur un poste qu\'avec ce code.')), el('button', { class: 'x', title: 'Fermer', onclick: fermer }, '✕')),
        zoneCode,
        el('div', { class: 'grille entetes' }, el('span', {}, 'Module'), el('span', {}, 'Pour tout le monde'), el('span', {}, 'Sur ce poste')),
        lignes,
        el('div', { class: 'pied' }, msg, version, bMaj, el('button', { class: 'btn', onclick: fermer }, 'Fermer')))));
    dessiner();
    serveur({ action: 'lire' }).then(() => { if (hote.isConnected && !attente) dessiner(); }).catch((e) => dire('Réglage commun illisible : ' + e.message + '. Les réglages « Sur ce poste » restent utilisables.', 'err'));
  }

  /** Entrée « Extension » en bas de la barre latérale, bâtie comme les modules d'Ulyss. */
  function insererEntree() {
    if (window.top !== window || (!HOTES.test(location.hostname) && !window.__extUlyssRdvEssai)) return;
    if (document.getElementById(ID_ENTREE)) return;
    const zone = document.querySelector('#global-sidebar .discret-scroll') || document.getElementById('global-sidebar');
    const liens = zone ? [...zone.querySelectorAll(':scope > a.sidebar-link')] : [];
    if (!liens.length) return;
    const r = document.createElement('a');
    r.id = ID_ENTREE; r.href = '#'; r.className = 'sidebar-link';
    r.title = 'Extension Ulyss : activer ou désactiver les modules, vérifier les mises à jour';
    r.innerHTML = '<div class="text-3xl mr-3.75"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="display:block;margin:3px 0"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg></div><div class="reductible">Extension</div>';
    r.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ouvrir(); });
    liens.filter((l) => !/^ext-ulyss-/.test(l.id)).pop().insertAdjacentElement('afterend', r);
  }
  document.addEventListener('turbo:load', insererEntree);
  new MutationObserver(insererEntree).observe(document.documentElement, { childList: true, subtree: true });
  insererEntree();
  rafraichir();
})();
