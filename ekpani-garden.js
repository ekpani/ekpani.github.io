/* Ekpani garden: quiet 8-bit ivy wrapped around the specimen sheet's border.
   Decorative only: one fixed, pointer-events:none canvas (#garden) sitting in
   FRONT of the translucent sheet (z-5) but under the modal scrim (z-40) and the
   grain (z-50), so the ivy reads as growing ON the frame. Vines sprout from the
   sheet's four corners and trail along its edges (long down the sides, short
   along the top/bottom), with the middle of each edge left open so the wordmark
   and content stay clear. Texture lifted from the reference art: a deep->lit
   green ramp, small alternating leaves, kept to a whisper. A gentle day/night
   tint keeps it alive. (CONFIG.BAND re-enables the old soft bottom band.) */
(function () {
  "use strict";

  var CONFIG = {
    VINES:     true,
    WRAP:      "full",     // "full" = continuous border | "corners" = grows from corners, open mid-edges
    BAND:      false,      // the old soft bottom band; off now (vines by themselves)
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

  var W = 0, H = 0, s = 3, isMobile = false;
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

  /* ---- ordered (Bayer) dithering, used by the optional bottom band ---- */
  var B4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  function dith(gx, gy, p){ return (B4[gy & 3][gx & 3] + 0.5) / 16 < p; }

  /* ---- small ivy-leaf sprites (chars index the ramp; '.' = transparent) ---- */
  var LEAVES = [
    [".34.", "3453", "2342", ".22."],
    [".43.", "3543", "2432", ".22."],
    ["..3.", "3454", ".342", "..2."]
  ];

  function setPx(gx, gy, col){ ctx.fillStyle = col; ctx.fillRect(gx * s, gy * s, s, s); }
  function setPxAbs(x, y, col){ setPx(Math.round(x / s), Math.round(y / s), col); }
  function drawMap(map, gx, gy, flip){
    var cols = map[0].length, r, k;
    for (r = 0; r < map.length; r++){
      var row = map[r];
      for (k = 0; k < row.length; k++){
        var ch = row.charAt(k);
        if (ch === ".") continue;
        var col = PAL[ch];
        if (!col) continue;
        var kk = flip ? (cols - 1 - k) : k;
        setPx(gx + kk, gy + r, col);
      }
    }
  }

  /* ---- seeded PRNG so layout is stable across frames/resizes ---- */
  function seeded(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function readSafe(){
    if (!main){ safe = { L:-1, R:-1, T:-1, B:-1 }; return; }
    var r = main.getBoundingClientRect();
    safe = { L:r.left, R:r.right, T:r.top, B:r.bottom };
  }

  /* ---- one vine running along an edge from a corner ----
     (sx,sy) start; (dx,dy) unit step along the edge; axis = the cross axis the
     leaves spill along ('x' for side vines, 'y' for top/bottom); outward = the
     side away from the sheet; noInwardTop suppresses inward leaves near the top
     (keeps the wordmark clear). */
  function addEdge(R, sx, sy, dx, dy, len, axis, outward, noInwardY, birth, outwardOnly){
    var n = Math.max(2, Math.floor(len / s)), i, mead = 0, pts = [];
    for (i = 0; i < n; i++){
      if (R() < 0.22) mead += (R() < 0.5 ? -1 : 1);
      mead = clamp(mead, -2, 2);
      var x = sx + dx * i * s + (axis === "x" ? mead * s : 0);
      var y = sy + dy * i * s + (axis === "y" ? mead * s : 0);
      pts.push([x, y]);
    }
    var lvs = [], side = outward;
    for (i = 1; i < n; i += 3){
      var s2 = side;
      if (outwardOnly || pts[i][1] < noInwardY) s2 = outward;   // force outward
      lvs.push({ i:i, side:s2, axis:axis, leaf: Math.floor(R() * LEAVES.length), phase: R() * 6.2832 });
      side = -side;
    }
    vines.push({ pts:pts, lvs:lvs, n:n, birth:birth });
  }

  function buildVines(){
    vines = [];
    if (!CONFIG.VINES || safe.L < 0) return;
    var R = seeded(20260606);

    if (isMobile){
      // no real gutter on phones: two short ivy strands down the screen corners,
      // leaves spilling inward over the wide padding.
      var ml = Math.round(H * 0.20);
      addEdge(R, 5,     0, 0, 1, ml, "x", +1, -1e9, 140);
      addEdge(R, W - 5, 0, 0, 1, ml, "x", -1, -1e9, 220);
      return;
    }

    var off = 5;                                  // stem sits just outside the border
    var L = safe.L - off, Rg = safe.R + off, T = safe.T - off, Bm = safe.B + off;
    var eW = Rg - L, eH = Bm - T;
    var noInw = T + 0.20 * eH;                    // top danger zone for the wordmark
    function f(a, b){ return a + R() * (b - a); }

    if (CONFIG.WRAP === "full"){
      // a continuous border, corner to corner, leaves fringing outward only
      addEdge(R, L,  T,  1,  0, eW, "y", -1, 0, 120, true);   // top:    TL -> TR
      addEdge(R, Rg, T,  0,  1, eH, "x", +1, 0, 200, true);   // right:  TR -> BR
      addEdge(R, Rg, Bm, -1, 0, eW, "y", +1, 0, 320, true);   // bottom: BR -> BL
      addEdge(R, L,  Bm, 0, -1, eH, "x", -1, 0, 240, true);   // left:   BL -> TL
      return;
    }

    // "corners": long strands down from the top corners, short strands up from the bottom
    addEdge(R, L,  T,  0,  1, f(0.55, 0.78) * eH, "x", -1, noInw, 120);
    addEdge(R, Rg, T,  0,  1, f(0.55, 0.78) * eH, "x", +1, noInw, 160);
    addEdge(R, L,  Bm, 0, -1, f(0.20, 0.34) * eH, "x", -1, noInw, 320);
    addEdge(R, Rg, Bm, 0, -1, f(0.20, 0.34) * eH, "x", +1, noInw, 300);

    // top + bottom: short runs from each corner, leaves outward (middle stays open)
    addEdge(R, L,  T,  1,  0, f(0.20, 0.36) * eW, "y", -1, 1e9, 180);
    addEdge(R, Rg, T, -1,  0, f(0.20, 0.36) * eW, "y", -1, 1e9, 220);
    addEdge(R, L,  Bm, 1,  0, f(0.18, 0.32) * eW, "y", +1, -1e9, 360);
    addEdge(R, Rg, Bm, -1, 0, f(0.18, 0.32) * eW, "y", +1, -1e9, 380);
  }

  /* ---- optional bottom band (CONFIG.BAND) ---- */
  function bandProfile(gx){
    var x = gx * s, maxH = isMobile ? 7 : 11;
    var n = Math.sin(x * 0.012) * 0.45 + Math.sin(x * 0.034 + 1.3) * 0.30 + Math.sin(x * 0.085 + 0.7) * 0.25;
    return Math.max(3, Math.round(maxH * (0.25 + 0.6 * ((n + 1) / 2))));
  }
  function drawBand(now){
    var GW = Math.ceil(W / s) + 1, GH = Math.ceil(H / s) + 1;
    var g0 = grow(now, 200, 1300), ground = GH, gx, d;
    for (gx = 0; gx < GW; gx++){
      var hgt = bandProfile(gx);
      var local = clamp(g0 * 1.4 - (Math.min(gx, GW - gx) / GW) * 0.5, 0, 1);
      local = local * local * (3 - 2 * local);
      var hh = Math.round(hgt * local);
      for (d = 0; d < hh; d++){
        var gy = ground - 1 - d, top = hgt - 1 - d, ch, p = 1;
        if (top <= 0){ ch = "4"; p = 0.45; }
        else if (top <= 1){ ch = "4"; p = 0.8; }
        else if (top <= 3){ ch = "3"; }
        else if (top <= 6){ ch = "2"; }
        else { ch = "1"; }
        if (p < 1 && !dith(gx, gy, p)) continue;
        setPx(gx, gy, PAL[ch]);
      }
    }
  }

  /* ---- growth easing (in step with the sheet's ~1.3s fade-in) ---- */
  function grow(now, birth, dur){
    if (staticMode) return 1;
    var p = (now - (t0 + birth)) / dur;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  function drawVine(v, now){
    var frac = grow(now, v.birth, 1100);
    var upto = staticMode ? v.n : Math.round(v.n * frac), i, j;
    for (i = 0; i < upto; i++){ var p = v.pts[i]; setPxAbs(p[0], p[1], PAL["2"]); }
    for (j = 0; j < v.lvs.length; j++){
      var lf = v.lvs[j];
      if (lf.i >= upto) continue;
      var q = v.pts[lf.i];
      var cgx = Math.round(q[0] / s), cgy = Math.round(q[1] / s);
      var map = LEAVES[lf.leaf], w = map[0].length, h = map.length;
      var sway = staticMode ? 0 : Math.round(Math.sin(now * 0.0008 + lf.phase));
      var gx, gy, flip = false;
      if (lf.axis === "x"){
        gx = (lf.side > 0 ? cgx + 1 : cgx - w) + sway * lf.side;
        gy = cgy - 2;
        flip = lf.side < 0;
      } else {
        gy = lf.side > 0 ? cgy + 1 : cgy - h;
        gx = cgx - 2 + sway;
      }
      drawMap(map, gx, gy, flip);
    }
  }

  function drawAll(now){
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = ALPHA;
    if (CONFIG.BAND) drawBand(now);
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
    clearTimeout(rt);
    rt = setTimeout(function(){ readSafe(); buildVines(); if (staticMode) drawAll(performance.now()); }, 120);
  }, { passive: true });
  if (window.ResizeObserver && main){
    new ResizeObserver(function(){ clearTimeout(rt); rt = setTimeout(start, 150); }).observe(main);
  }
  if (main) main.addEventListener("animationend", function(){ readSafe(); buildVines(); }, { once: true });
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
