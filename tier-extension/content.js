// content.js — injected into Zillow & Redfin listing pages.
// Finds the hero listing photo from the live rendered DOM and caches it
// in chrome.storage.local so the Tier popup can retrieve it instantly.

(function tierPhotoCapture() {
  function cacheKey() {
    const href = window.location.href;
    // Zillow: extract zpid  e.g. /12345678_zpid
    const zpid = href.match(/\/(\d{7,})_zpid/)?.[1];
    if (zpid) return `tier_prop_photo_zpid_${zpid}`;
    // Redfin / others: use sanitised pathname
    const path = window.location.pathname.replace(/[^a-zA-Z0-9-_/]/g, "").slice(0, 120);
    return `tier_prop_photo_path_${path}`;
  }

  function bestHeroUrl() {
    const all = Array.from(document.querySelectorAll("img"));

    // 1. Zillow CDN — /fp/ images are the listing photos
    const zillow = all.filter(i => i.src && i.src.includes("zillowstatic.com/fp/"));
    if (zillow.length) {
      zillow.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
      // Strip width/height params to get full-res version
      return zillow[0].src.replace(/[?&][wh]=\d+/g, "").replace(/\?$/, "");
    }

    // 2. Redfin CDN
    const redfin = all.filter(i => i.src && i.src.includes("ssl-photos.redfin.com"));
    if (redfin.length) {
      redfin.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
      return redfin[0].src;
    }

    // 3. og:image meta (already in DOM for SSR pages)
    const og = document.querySelector('meta[property="og:image"]');
    if (og?.content?.startsWith("http")) return og.content;

    return null;
  }

  function tryCapture() {
    const key = cacheKey();
    const url = bestHeroUrl();
    if (key && url) {
      try { chrome.storage.local.set({ [key]: url }); } catch (_) {}
    }
    return !!url;
  }

  // Run immediately, then retry as React/Next lazy-loads images
  if (!tryCapture()) {
    const delays = [800, 2000, 5000];
    delays.forEach(ms => setTimeout(tryCapture, ms));

    // Also watch for DOM mutations (gallery slider loads)
    const mo = new MutationObserver(() => { if (tryCapture()) mo.disconnect(); });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 12000);
  }
})();
