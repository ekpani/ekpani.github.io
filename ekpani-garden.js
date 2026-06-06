/* Ekpani garden: a quiet 8-bit foliage texture framing the specimen sheet.
   Decorative only: one fixed, pointer-events:none canvas (#garden) sitting
   behind the translucent sheet (z-0) and under the grain (z-50), so the same
   paper grain unifies it. Two motifs, kept to a whisper:
     - hanging vines trailing down from the top edge + the side gutters
     - a soft dithered leaf band along the bottom
   The texture (a deep->lit green ramp + ordered dithering on the rim) is lifted
   from the reference art the user shared: foliage that reads as grown and fuzzy,
   not cut. Palette is the brand greens; a gentle day/night tint keeps it alive. */
(function () {
  "use strict";

  var CONFIG = {
    VINES:     true,
    BAND:      true,
    INTENSITY: "whisper"   // "whisper" | "medium" | "lush"
  };

  var cv = document.getElementById("garden");
  if (!cv) return;
  var ctx = cv.getContext("2d");
  var main = document.querySelector("main.sheet") || document.querySelector("main");

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var staticMode = reduce;
  var ALPHA = CONFIG.INTENSITY === "lush" ? 0.92 : CONFIG.INTENSITY === "medium" ? 0.78 : 0.6;

  var W = 0, H = 0, s = 3, GW = 0, GH = 0, isMobile = false;
  var GUT = 20;
  var safe = { L: -1, R: -1, T: -1, B: -1 };
  var vines = [];
  var t0 = 0, raf = 0;

  function cl(n){ n = Math.round(n); return n < 0 ? 0 : n > 255 ? 255 : n; }
  function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }

  /* ---- palette: a 5-step green ramp (deep -> lit), tinted by local hour ---- */
  var BASE = { "1":[47,56,44], "2":[61,72,56], "3":[84,98,78], "4":[140,154,130], "5":[176,190,164] };
  var PAL = {};
  function hourNow(){
    var m = location.search.match(/[?&]hour=(\d+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1]) % 24;
    var d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  function computePAL(){
    var h = hourNow();
    var day = Math.max(0, Math.sin((h - 6) / 12 * Math.PI)); // 0 at 6h/18h, 1 at noon
    var night = 1 - day;
    PAL = {};
    for (var k in BASE){
      var c = BASE[k];
      var r = c[0] + 7 * day - 9 * night;
      var g = c[1] + 4 * day - 6 * night;
      var b = c[2] - 5 * day + 4 * night;
      var dk = 1 - 0.14 * night;
      PAL[k] = "rgb(" + cl(r * dk) + "," + cl(g * dk) + "," + cl(b * dk) + ")";
    }
  }

  /* ---- ordered (Bayer) dithering for soft, grown-looking rims ---- */
  var B4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  function dith(gx, gy, p){ return (B4[gy & 3][gx & 3] + 0.5) / 16 < p; }

  /* ---- small vine-leaf sprites (chars index the ramp; '.' = transparent) ---- */
  var LEAVES = [
    [".34.", "3453", "2342", ".22."],
    [".43.", "3543", "2432", ".22."],
    ["..3.", "3454", ".342", "..2."]
  ];

  function setPx(gx, gy, col){ ctx.fillStyle = col; ctx.fillRect(gx * s, gy * s, s, s); }

  /* ---- seeded PRNG so layout is stable across frames/resizes ---- */
  function seeded(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---- safe zone (carved from the sheet's box, with a gutter) ---- */
  function readSafe(){
    if (!main){ safe = { L:-1, R:-1, T:-1, B:-1 }; return; }
    var r = main.getBoundingClientRect();
    safe = { L:r.left, R:r.right, T:r.top, B:r.bottom };
  }
  function blockedCell(gx, gy){
    if (safe.L < 0) return false;
    var x = gx * s, y = gy * s;
    return !(x + s < safe.L - GUT || x > safe.R + GUT || y + s < safe.T - GUT || y > safe.B + GUT);
  }

  /* ---- build the hanging vines ---- */
  function makeVine(R, x0, len, opts){
    var path = [], gx = x0, drift = 0, d;
    for (d = 0; d < len; d++){
      if (R() < 0.30) drift = (R() < 0.5 ? -1 : 1);
      if (d % 2 === 0) gx += (R() < 0.55 ? drift : 0);
      if (opts.minX != null) gx = clamp(gx, opts.minX, opts.maxX);
      path.push(gx);
    }
    var leaves = [], side = R() < 0.5 ? 1 : -1, every = opts.every || 3;
    for (d = 2; d < len; d += every){
      leaves.push({ d:d, side:side, leaf: Math.floor(R() * LEAVES.length), flip: side < 0, phase: R() * 6.2832 });
      side = -side;
    }
    return { path:path, len:len, leaves:leaves, birth: opts.birth || 0 };
  }

  function buildVines(){
    vines = [];
    if (!CONFIG.VINES) return;
    var R = seeded(20260606);
    var topRoom = Math.max(3, Math.floor((safe.T > 0 ? safe.T : 90) / s) - 2);

    // top dangles: a couple of short vines above the sheet (off-centre)
    var slots = isMobile ? [0.5] : [0.17, 0.83, 0.5];
    var nTop = isMobile ? 1 : 2;
    for (var i = 0; i < nTop; i++){
      var fx = slots[i % slots.length];
      var x0 = Math.round(GW * fx + (R() - 0.5) * GW * 0.05);
      var len = Math.max(3, Math.round(topRoom * (0.55 + R() * 0.4)));
      vines.push(makeVine(R, x0, len, { every:3, birth:120 + i * 150, minX:1, maxX:GW - 2 }));
    }

    if (isMobile) return;

    // side vines: trail down the gutters beside the sheet (only if there's room)
    var GMIN = 80;
    var bottom = Math.round(Math.min(safe.B, H - s * 3) / s);
    if (safe.L > GMIN){
      vines.push(makeVine(R, Math.round((safe.L * 0.5) / s),
        Math.round(bottom * (0.7 + R() * 0.2)),
        { every:3, birth:240, minX:1, maxX:Math.floor((safe.L - GUT) / s) - 1 }));
    }
    if (W - safe.R > GMIN){
      vines.push(makeVine(R, Math.round((safe.R + (W - safe.R) * 0.5) / s),
        Math.round(bottom * (0.7 + R() * 0.2)),
        { every:3, birth:320, minX:Math.ceil((safe.R + GUT) / s) + 1, maxX:GW - 2 }));
    }
  }

  /* ---- bottom band: a low, scalloped, dithered leaf strip ---- */
  function bandProfile(gx){
    var x = gx * s, maxH = isMobile ? 7 : 11;
    var n = Math.sin(x * 0.012) * 0.45 + Math.sin(x * 0.034 + 1.3) * 0.30 + Math.sin(x * 0.085 + 0.7) * 0.25;
    return Math.max(3, Math.round(maxH * (0.25 + 0.6 * ((n + 1) / 2))));
  }

  /* ---- growth easing (in step with the sheet's ~1.3s fade-in) ---- */
  function grow(now, birth, dur){
    if (staticMode) return 1;
    var p = (now - (t0 + birth)) / dur;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  function drawBand(now){
    if (!CONFIG.BAND) return;
    var g0 = grow(now, 200, 1300), ground = GH, gx, d;
    for (gx = 0; gx < GW; gx++){
      var hgt = bandProfile(gx);
      var edge = Math.min(gx, GW - gx) / GW;            // corners grow first
      var local = clamp(g0 * 1.4 - edge * 0.5, 0, 1);
      local = local * local * (3 - 2 * local);
      var breath = staticMode ? 0 : Math.sin(now * 0.0005 + gx * 0.05) * 0.04;
      var hh = Math.round(hgt * local * (1 + breath));
      for (d = 0; d < hh; d++){
        var gy = ground - 1 - d;
        if (blockedCell(gx, gy)) continue;
        var top = hgt - 1 - d, ch, p = 1;
        if (top <= 0){ ch = "4"; p = 0.45; }
        else if (top <= 1){ ch = "4"; p = 0.8; }
        else if (top <= 3){ ch = "3"; }
        else if (top <= 6){ ch = "2"; }
        else { ch = "1"; }
        if (p < 1 && !dith(gx, gy, p)) continue;
        var col = PAL[ch];
        if (ch === "3" && dith(gx + 5, gy + 3, 0.12)) col = PAL["4"]; // sparse lit flecks
        setPx(gx, gy, col);
      }
    }
  }

  function drawVine(v, now){
    var frac = grow(now, v.birth, 1100);
    var lenNow = staticMode ? v.len : Math.round(v.len * frac), d, i;
    for (d = 0; d < lenNow; d++){
      var gx = v.path[d];
      if (!blockedCell(gx, d)) setPx(gx, d, PAL["2"]); // stem
    }
    for (i = 0; i < v.leaves.length; i++){
      var lf = v.leaves[i];
      if (lf.d >= lenNow) continue;
      var map = LEAVES[lf.leaf];
      var sway = staticMode ? 0 : Math.round(Math.sin(now * 0.0008 + lf.phase));
      var bx = v.path[lf.d] + (lf.side < 0 ? -(map[0].length) + 1 : 0) + sway;
      var by = lf.d - 1;
      var cols = map[0].length, r, k;
      for (r = 0; r < map.length; r++){
        var row = map[r];
        for (k = 0; k < row.length; k++){
          var c2 = row.charAt(k);
          if (c2 === ".") continue;
          var kk = lf.flip ? (cols - 1 - k) : k;
          var X = bx + kk, Y = by + r;
          if (blockedCell(X, Y)) continue;
          setPx(X, Y, PAL[c2]);
        }
      }
    }
  }

  function drawAll(now){
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = ALPHA;
    drawBand(now);
    for (var i = 0; i < vines.length; i++) drawVine(vines[i], now);
    ctx.globalAlpha = 1;
  }
  function frame(now){
    if (!t0) t0 = now;
    drawAll(now);
    raf = requestAnimationFrame(frame);
  }

  /* ---- sizing / lifecycle ---- */
  function resize(){
    W = window.innerWidth; H = window.innerHeight;
    isMobile = W <= 720;
    s = isMobile ? 2 : 3;
    GW = Math.ceil(W / s) + 1; GH = Math.ceil(H / s) + 1;
    cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    readSafe();
    buildVines();
  }
  function start(){
    computePAL();
    resize();
    if (staticMode){ drawAll(performance.now()); return; }
    t0 = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  function pause(){ if (raf){ cancelAnimationFrame(raf); raf = 0; } }
  function resume(){
    if (staticMode){ drawAll(performance.now()); return; }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  var rt;
  window.addEventListener("resize", function(){ clearTimeout(rt); rt = setTimeout(start, 150); });
  window.addEventListener("scroll", function(){
    readSafe();
    if (staticMode){ clearTimeout(rt); rt = setTimeout(function(){ drawAll(performance.now()); }, 60); }
  }, { passive: true });
  if (window.ResizeObserver && main){
    new ResizeObserver(function(){ clearTimeout(rt); rt = setTimeout(start, 150); }).observe(main);
  }
  if (main) main.addEventListener("animationend", function(){ readSafe(); }, { once: true });
  document.addEventListener("visibilitychange", function(){ document.hidden ? pause() : resume(); });
  if (document.body){
    new MutationObserver(function(){
      document.body.classList.contains("card-open") ? pause() : resume();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  setInterval(function(){ computePAL(); if (staticMode) drawAll(performance.now()); }, 30000);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.EkpaniGarden = { CONFIG: CONFIG, redraw: start };
})();
