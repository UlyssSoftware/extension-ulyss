/*
 * Extension Ulyss — relevé des avis Google d'une fiche (26/11/2026, demande de Guillaume : veille des avis clients).
 * Ce script ne fait RIEN sur Google Maps, sauf dans un onglet que l'extension vient d'ouvrir elle-même pour le relevé
 * (le service worker tient la liste de ces onglets et répond « oui » à gc-avis-onglet). Il ouvre alors l'onglet « Avis »,
 * trie par « Plus récents », lit les premiers avis (auteur, note, texte, ancienneté) et les rend ; l'onglet est refermé.
 * Sélecteurs relevés le 26/11/2026 ; Google peut les changer : en cas d'échec, le motif remonte dans le module Avis clients.
 */
(() => {
  'use strict';
  const attendre = (f, ms) => new Promise((ok) => { const t0 = Date.now(); (function voir() { let r = null; try { r = f(); } catch (e) {} if (r) return ok(r); if (Date.now() - t0 > (ms || 15000)) return ok(null); setTimeout(voir, 300); })(); });
  const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const propre = (s) => String(s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
  /** « il y a 5 jours » → 5 ; heures, minutes → 0 ; « une semaine » et au-delà → 99. */
  function jours(age) {
    const t = propre(age).toLowerCase();
    if (/minute|heure|hour|instant|now/.test(t)) return 0;
    const m = t.match(/(\d+|un|a)\s+(jour|day)/);
    if (m) return /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
    return 99;
  }
  async function lire() {
    const onglet = await attendre(() => [...document.querySelectorAll('button[role="tab"]')].find((b) => /^(avis|reviews)$/i.test(propre(b.textContent)) || /[-–] (avis|reviews)$/i.test(propre(b.getAttribute('aria-label')))), 20000);
    if (!onglet) return { ok: false, motif: location.hostname.indexOf('consent') >= 0 ? 'page de consentement Google' : "onglet « Avis » introuvable sur la fiche" };
    onglet.click();
    const tri = await attendre(() => [...document.querySelectorAll('button')].find((b) => /trier|sort/i.test(propre(b.getAttribute('aria-label') || '') + ' ' + propre(b.getAttribute('data-value') || ''))), 12000);
    if (!tri) return { ok: false, motif: 'bouton « Trier » introuvable' };
    tri.click();
    const recents = await attendre(() => [...document.querySelectorAll('[role="menuitemradio"]')].find((m) => /plus récents|newest/i.test(propre(m.textContent))), 8000);
    if (!recents) return { ok: false, motif: 'tri « Plus récents » introuvable' };
    const avant = document.querySelector('div.jftiEf');
    recents.click();
    await attendre(() => { const p = document.querySelector('div.jftiEf'); return p && p !== avant ? p : null; }, 8000);
    await pause(1200);
    const blocs = [...document.querySelectorAll('div.jftiEf')].slice(0, 20);
    if (!blocs.length) return { ok: false, motif: 'aucun avis lisible (présentation de Google modifiée ?)' };
    blocs.forEach((b) => { const plus = b.querySelector('button.w8nwRe'); if (plus) plus.click(); });
    await pause(500);
    const avis = blocs.map((b) => {
      const etoiles = (b.querySelector('.kvMYJc') || { getAttribute: () => '' }).getAttribute('aria-label') || '';
      const age = propre((b.querySelector('.rsqaWe') || {}).textContent);
      return { auteur: propre((b.querySelector('.d4r55') || {}).textContent), note: parseInt((etoiles.match(/\d/) || ['5'])[0], 10), texte: propre((b.querySelector('.wiI7pd') || {}).textContent), age, jours: jours(age) };
    }).filter((a) => a.auteur);
    return { ok: true, nb: avis.length, avis: avis.filter((a) => a.jours <= 6) };
  }
  if (typeof window !== 'undefined' && window.__extUlyssMapsEssai) { window.__extUlyssMapsEssai.lire = lire; return; }
  let ext = null;
  try { ext = chrome.runtime && chrome.runtime.id ? chrome.runtime : null; } catch (e) {}
  if (!ext || window.top !== window) return;
  ext.sendMessage({ type: 'gc-avis-onglet' }, (r) => {
    void chrome.runtime.lastError;
    if (!r || !r.oui) return;   // onglet ordinaire de l'utilisateur : on n'y touche pas
    lire().catch((e) => ({ ok: false, motif: String((e && e.message) || e) })).then((res) => { try { ext.sendMessage({ type: 'gc-avis-lu', resultat: res }); } catch (e) {} });
  });
})();
