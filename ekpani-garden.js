/* Ekpani garden: an 8-bit ekpani (Centella) garden growing around the
   central specimen sheet. Decorative only: two fixed, pointer-events:none
   canvases. #garden (z-0) draws behind the translucent sheet and under the
   grain; #garden-fg (z-5) draws the few corner "climbers" in front of the
   sheet. Reuses the canvas-sprite + safe-zone technique from amrith.co.
   Palette + leaf silhouette match ekpani-leaf.js / the brand greens. */
(function () {
  "use strict";

  var CONFIG = {
    DENSITY:  "medium",   // "quiet" | "medium" | "lush"
    SAFEZONE: "climb",    // "around" | "peek" | "climb"
    MOTION:   "tint",     // "growsway" | "static" | "tint"
    MOBILE:   "band"      // "band" | "through" | "hide"
  };

  var bg = document.getElementById("garden");
  if (!bg) return;
  var fg = document.getElementById("garden-fg");
  var bctx = bg.getContext("2d");
  var fctx = fg ? fg.getContext("2d") : null;
  var main = document.querySelector("main.sheet") || document.querySelector("main");

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var staticMode = reduce || CONFIG.MOTION === "static";

  var W = 0, H = 0, s = 3, isMobile = false;
  var GUT = 20, GROW = 700;
  var safe = { L: -1, R: -1, T: -1, B: -1 };
  var leaves = [], climbers = [];
  var t0 = 0, raf = 0;

  /* ---- palette (brand greens), tinted by hour ---- */
  var BASE = { d:[61,72,56], e:[84,98,78], s:[140,154,130], v:[248,245,238], t:[84,98,78], g:[185,138,46] };
  var PAL = {};
  function cl(n){ n = Math.round(n); return n < 0 ? 0 : n > 255 ? 255 : n; }
  function hourNow(){
    var m = location.search.match(/[?&]hour=(\d+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1]) % 24;
    var d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  function computePAL(){
    var h = (CONFIG.MOTION === "tint") ? hourNow() : 13;
    var day = Math.max(0, Math.sin((h - 6) / 12 * Math.PI)); // 0 at 6h/18h, 1 at noon
    var night = 1 - day;
    function mix(rgb){
      var r = rgb[0] + 8 * day - 10 * night;
      var g = rgb[1] + 4 * day - 6 * night;
      var b = rgb[2] - 6 * day + 4 * night;
      var dk = 1 - 0.16 * night;
      return "rgb(" + cl(r * dk) + "," + cl(g * dk) + "," + cl(b * dk) + ")";
    }
    PAL = { d:mix(BASE.d), e:mix(BASE.e), s:mix(BASE.s), v:mix(BASE.v), t:mix(BASE.t), g:mix(BASE.g) };
  }

  /* ---- sprites (8-bit ekpani): scalloped fan, cream veins, cordate cleft, stem ---- */
  var SPROUT = [
    ".sss.",
    "seees",
    ".ses.",
    "..t..",
    "..t.."
  ];
  var YOUNG = [
    "..seees..",
    ".seeeees.",
    "seeeeeees",
    "seeeeeees",
    ".seeeees.",
    "..seees..",
    "....t....",
    "....t...."
  ];
  var FULL = [
    "...seees...",
    "..seeeees..",
    ".seeeeeees.",
    "seeeeeeeees",
    "seeeeeeeees",
    ".seeeeeees.",
    "..seeeees..",
    "...seees...",
    "....eee....",
    ".....t.....",
    ".....t....."
  ];

  function blit(ctx, map, x, y, px, flip, dx, bladeRows){
    var cols = map[0].length, r, k, ch, col, kk, row, shift;
    for (r = 0; r < map.length; r++){
      row = map[r];
      shift = (dx && r < bladeRows) ? dx : 0;
      for (k = 0; k < row.length; k++){
        ch = row.charAt(k);
        if (ch === ".") continue;
        col = PAL[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        kk = flip ? (cols - 1 - k) : k;
        ctx.fillRect(Math.round(x + kk * px + shift), Math.round(y + r * px), px, px);
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

  /* ---- safe zone (carved from the sheet's box) ---- */
  function readSafe(){
    if (!main){ safe = { L:-1, R:-1, T:-1, B:-1 }; return; }
    var r = main.getBoundingClientRect();
    safe = { L:r.left, R:r.right, T:r.top, B:r.bottom };
  }
  function blocked(x, topY, w, h){
    if (safe.L < 0) return false;
    var x2 = x + w, y2 = topY + h;
    return !(x2 < safe.L - GUT || x > safe.R + GUT || y2 < safe.T - GUT || topY > safe.B + GUT);
  }

  function densMul(){ return CONFIG.DENSITY === "quiet" ? 0.6 : CONFIG.DENSITY === "lush" ? 1.7 : 1.0; }

  function birthFor(x, baseY){
    return (Math.min(x, W - x) / W) * 500 + ((H - baseY) / H) * 400;
  }

  function pushLeaf(arr, x, baseY, R, force){
    var w = FULL[0].length * s, h = FULL.length * s;
    // On mobile the sheet fills the screen; skip the carve so the calm bottom
    // band shows faintly through the translucent sheet.
    if (!force && !isMobile && blocked(x, baseY - h, w, h)) return;
    arr.push({ x:x, baseY:baseY, flip: R() < 0.5, phase: R() * 6.2832, birth: birthFor(x, baseY), full: !!force });
  }

  function rail(R, left){
    var w = FULL[0].length * s;
    var x = left ? Math.max(s * 2, safe.L - GUT - w) : Math.min(W - w - s * 2, safe.R + GUT);
    if (x < 0) return;
    var top = Math.max(s * 6, safe.T + s * 4), bot = Math.min(H - s * 5, safe.B + s * 8);
    var stepY = Math.round(s * 10), n = 0, max = Math.round(4 * densMul());
    for (var y = bot; y > top && n < max; y -= stepY){
      if (R() < 0.7){ pushLeaf(leaves, x + Math.round((R() - 0.5) * s * 3), y, R); n++; }
    }
  }

  function addClimbers(R){
    if (!fctx || safe.L < 0) return;
    var lw = FULL[0].length * s, lh = FULL.length * s;
    var pts = [
      { x: safe.L, y: safe.T, fx:-1, fy:-1 },  // top-left
      { x: safe.R, y: safe.B, fx: 1, fy: 1 },  // bottom-right
      { x: safe.R, y: safe.T, fx: 1, fy:-1 }   // top-right
    ];
    for (var i = 0; i < pts.length; i++){
      var p = pts[i];
      var x = p.fx < 0 ? (p.x - Math.round(lw * 0.45)) : (p.x - Math.round(lw * 0.55));
      var baseY = p.fy < 0 ? (p.y + Math.round(lh * 0.55)) : (p.y + Math.round(lh * 0.25));
      climbers.push({ x:x, baseY:baseY, flip: p.fx > 0, phase: R() * 6.2832, birth: 200 + i * 140, full: true });
    }
  }

  function build(){
    leaves = []; climbers = [];
    if (isMobile && CONFIG.MOBILE === "hide") return;
    var R = seeded(20260605);
    var groundY = H - Math.round(s * 3);
    var step = Math.round(s * (isMobile ? 16 : 7));
    var pBottom = (isMobile ? 0.4 : 0.55) * densMul();
    // bottom band (full width; carved around the sheet on desktop, sparse on mobile)
    for (var x = Math.round(s * 3); x < W - s * 6; x += step){
      if (R() < pBottom){
        pushLeaf(leaves, x + Math.round((R() - 0.5) * s * 2), groundY, R);
        if (!isMobile && R() < 0.45) pushLeaf(leaves, x + Math.round(s * 3), groundY - (R() < 0.5 ? 0 : s), R);
      }
    }
    if (!isMobile){
      rail(R, true);
      rail(R, false);
      if (CONFIG.SAFEZONE === "climb") addClimbers(R);
    }
    if (staticMode){
      leaves.forEach(function(L){ L.birth = -1e9; });
      climbers.forEach(function(L){ L.birth = -1e9; });
    }
  }

  /* ---- draw ---- */
  function progress(L, now){
    if (L.birth <= -1e8) return 1;
    var p = (now - (t0 + L.birth)) / GROW;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }
  function drawLeaf(ctx, L, now){
    var p = progress(L, now);
    if (p <= 0) return;
    var map = L.full ? FULL : (p < 0.34 ? SPROUT : p < 0.7 ? YOUNG : FULL);
    var h = map.length * s;
    var ease = p * p * (3 - 2 * p);
    var yOff = Math.round((1 - ease) * 4 * s);
    var sway = (!staticMode && p >= 1) ? Math.round(Math.sin(now * 0.0009 + L.phase) * Math.max(1, s * 0.4)) : 0;
    blit(ctx, map, L.x, L.baseY - h + yOff, s, L.flip, sway, map.length - 3);
  }
  function drawAll(now){
    bctx.clearRect(0, 0, W, H);
    if (fctx) fctx.clearRect(0, 0, W, H);
    var i;
    for (i = 0; i < leaves.length; i++) drawLeaf(bctx, leaves[i], now);
    if (fctx) for (i = 0; i < climbers.length; i++) drawLeaf(fctx, climbers[i], now);
  }
  function frame(now){
    if (!t0) t0 = now;
    drawAll(now);
    raf = requestAnimationFrame(frame);
  }

  /* ---- sizing / lifecycle ---- */
  function sizeCanvas(c){
    if (!c) return;
    c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr);
    c.style.width = W + "px"; c.style.height = H + "px";
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resize(){
    W = window.innerWidth; H = window.innerHeight;
    isMobile = W <= 720;
    s = isMobile ? 2 : (W > 1536 ? 4 : 3);
    sizeCanvas(bg); sizeCanvas(fg);
    readSafe();
    build();
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
  if (CONFIG.MOTION === "tint"){
    setInterval(function(){ computePAL(); if (staticMode) drawAll(performance.now()); }, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.EkpaniGarden = { CONFIG: CONFIG, redraw: start };
})();
