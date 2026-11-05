/* ════════════════════════════════════════════════════════════════
   MovenRun · scroll-driven cinematic engine
   One rAF loop drives every sticky scene from a smoothed scroll
   progress value; IntersectionObservers fire the one-shot moments.
   ════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SVGNS = "http://www.w3.org/2000/svg";

  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeCine(t) { return 1 - Math.pow(1 - t, 4); }      /* ~cubic-bezier(.19,1,.22,1) */
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  /* ───────────────────────── splash + hero intro ───────────────── */
  window.addEventListener("load", function () {
    setTimeout(function () {
      var splash = $("#splash");
      if (splash) splash.classList.add("gone");
      document.body.classList.add("loaded");
    }, REDUCED ? 50 : 700);
  });
  /* Fallback if load never fires (slow font fetch etc.) */
  setTimeout(function () {
    var splash = $("#splash");
    if (splash && !splash.classList.contains("gone")) {
      splash.classList.add("gone");
      document.body.classList.add("loaded");
    }
  }, 2600);

  /* ───────────────────────── map area helper ───────────────────── */
  /* Seeded PRNG (mulberry32) so every map draws the same way on every load. */
  function seededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A closed path through `pts` with every corner rounded, so parcels read
     as blocks and parks on a street map rather than a geometric lattice. */
  function roundedPath(pts, rad) {
    var n = pts.length, d = "";
    function toward(a, b, dist) {
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
      dist = Math.min(dist, len / 2.4);
      return [a[0] + dx / len * dist, a[1] + dy / len * dist];
    }
    function f(p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }
    for (var i = 0; i <= n; i++) {
      var p1 = pts[i % n], p0 = pts[(i - 1 + n) % n], p2 = pts[(i + 1) % n];
      var a = toward(p1, p0, rad), b = toward(p1, p2, rad);
      d += i === 0 ? "M" + f(b) : " L" + f(a) + " Q" + f(p1) + " " + f(b);
    }
    return d + "Z";
  }

  /* Irregular territory parcels covering a viewBox: a jittered street grid
     whose blocks are sometimes split, each block inset (the "street") and
     drawn with rounded corners. Returns [{el,x,y,dist}] for the scene animations,
     with x/y the parcel's centre. `r` is the approximate parcel radius. */
  function genAreaGrid(svg, vw, vh, r, cx, cy, seed) {
    var rand = seededRandom(seed || (vw * 31 + vh * 17 + r * 7));
    var s = r * 1.62;
    var cols = Math.ceil((vw + 2 * s) / s), rows = Math.ceil((vh + 2 * s) / s);
    var grid = [];
    for (var j = 0; j <= rows; j++) {
      grid.push([]);
      for (var i = 0; i <= cols; i++) {
        grid[j].push([-s + i * s + (rand() - 0.5) * s * 0.42, -s + j * s + (rand() - 0.5) * s * 0.42]);
      }
    }
    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    var ox = cx != null ? cx : vw / 2, oy = cy != null ? cy : vh / 2;
    var areas = [];
    function add(quad) {
      var mx = 0, my = 0, k;
      for (k = 0; k < quad.length; k++) { mx += quad[k][0]; my += quad[k][1]; }
      mx /= quad.length; my /= quad.length;
      /* inset toward the centre leaves a street between neighbours */
      var inset = quad.map(function (p) { return mix(p, [mx, my], 0.1); });
      var path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", roundedPath(inset, s * 0.2));
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      var dx = mx - ox, dy = my - oy;
      areas.push({ el: path, x: mx, y: my, dist: Math.sqrt(dx * dx + dy * dy) });
    }
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var a = grid[y][x], b = grid[y][x + 1], c = grid[y + 1][x + 1], d = grid[y + 1][x];
        var roll = rand();
        if (roll < 0.2) {
          /* split across: two long thin blocks */
          var t = 0.38 + rand() * 0.24;
          var ab = mix(a, d, t), bc = mix(b, c, t);
          add([a, b, bc, ab]); add([ab, bc, c, d]);
        } else if (roll < 0.36) {
          /* split down: two narrow blocks side by side */
          var u = 0.38 + rand() * 0.24;
          var top = mix(a, b, u), bot = mix(d, c, u);
          add([a, top, bot, d]); add([top, b, c, bot]);
        } else {
          add([a, b, c, d]);
        }
      }
    }
    return areas;
  }
  var mapRand = seededRandom(20260611);

  /* ───────────────────────── scene engine ──────────────────────── */
  var scenes = [];
  function addScene(el, update) {
    if (!el) return;
    scenes.push({ el: el, update: update, p: 0, target: 0 });
  }
  function stickyProgress(el) {
    var rect = el.getBoundingClientRect();
    var travel = el.offsetHeight - window.innerHeight;
    if (travel <= 0) return 0;
    return clamp(-rect.top / travel, 0, 1);
  }

  var ticking = false;
  function loop(t) {
    for (var i = 0; i < scenes.length; i++) {
      var s = scenes[i];
      var rect = s.el.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > window.innerHeight + 200) continue;
      s.target = stickyProgress(s.el);
      s.p = lerp(s.p, s.target, 0.16);
      if (Math.abs(s.p - s.target) < 0.0005) s.p = s.target;
      s.update(s.p, t);
    }
    updateJourney();
    requestAnimationFrame(loop);
  }

  /* ───────────────────── the journey spine ─────────────────────
     One continuous route drawn from the hero to the final CTA. The
     path is rebuilt from section positions, drawn by scroll, and a
     glowing runner orb travels it with milestone markers lighting up. */
  var journey = $("#journey");
  var journeyTrack = $("#journeyTrack"), journeyFill = $("#journeyFill");
  var journeyNodesG = $("#journeyNodes"), journeyOrb = $("#journeyOrb");
  var journeySvgEl = $("#journeySvg");
  var journeyLen = 0, journeyLUT = [], journeyNodeList = [];

  function buildJourney() {
    if (!journey || REDUCED || window.innerWidth <= 1100) { journeyLen = 0; return; }
    var docH = document.documentElement.scrollHeight;
    var w = document.documentElement.clientWidth;
    journey.style.height = docH + "px";
    journeySvgEl.setAttribute("viewBox", "0 0 " + w + " " + docH);

    function wp(sel, fx, fy) {
      var el = $(sel);
      if (!el) return null;
      var top = el.getBoundingClientRect().top + window.scrollY;
      return [w * fx, top + el.offsetHeight * fy];
    }
    var pts = [
      [w * 0.085, window.innerHeight * 0.88],
      wp(".descent", 0.4, 0.16),
      wp(".descent", 0.62, 0.55),
      wp("#loop", 0.1, 0.45),
      wp("#app", 0.84, 0.28),
      wp("#session", 0.1, 0.5),
      wp("#rewards", 0.8, 0.5),
      wp("#economy", 0.14, 0.5),
      wp("#clubs", 0.84, 0.5),
      wp("#base", 0.12, 0.5),
      wp("#roadmap", 0.5, 0.05),
      wp("#roadmap", 0.5, 0.97),
      wp("#join", 0.5, 0.6)
    ].filter(Boolean);

    /* catmull-rom → cubic beziers for a soft, hand-drawn route */
    var d = "M " + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      d += " C " + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + " " + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
           " " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + " " + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
           " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    journeyTrack.setAttribute("d", d);
    journeyFill.setAttribute("d", d);
    journeyLen = journeyFill.getTotalLength();
    journeyFill.style.strokeDasharray = journeyLen;
    journeyFill.style.strokeDashoffset = journeyLen;

    /* length → page-y lookup so the orb tracks the viewport center */
    journeyLUT = [];
    var SAMPLES = 360;
    for (var k = 0; k <= SAMPLES; k++) {
      var pt = journeyFill.getPointAtLength(journeyLen * k / SAMPLES);
      journeyLUT.push([journeyLen * k / SAMPLES, pt.x, pt.y]);
    }

    /* milestone markers at each section waypoint */
    journeyNodesG.innerHTML = "";
    journeyNodeList = [];
    pts.forEach(function (p, idx) {
      if (idx === 0) return;
      var dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("cx", p[0].toFixed(1));
      dot.setAttribute("cy", p[1].toFixed(1));
      dot.setAttribute("r", "7.5");
      journeyNodesG.appendChild(dot);
      journeyNodeList.push({ el: dot, y: p[1] });
    });
  }

  function updateJourney() {
    if (!journeyLen) return;
    var targetY = window.scrollY + window.innerHeight * 0.55;
    var lo = 0, hi = journeyLUT.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (journeyLUT[mid][2] < targetY) lo = mid + 1; else hi = mid; }
    var a = journeyLUT[Math.max(0, lo - 1)], b = journeyLUT[lo];
    var t = clamp((targetY - a[2]) / Math.max(1, b[2] - a[2]), 0, 1);
    var len = lerp(a[0], b[0], t);
    journeyFill.style.strokeDashoffset = Math.max(0, journeyLen - len);
    journeyOrb.style.transform = "translate(" + lerp(a[1], b[1], t).toFixed(1) + "px," + lerp(a[2], b[2], t).toFixed(1) + "px)";
    for (var i = 0; i < journeyNodeList.length; i++) {
      journeyNodeList[i].el.classList.toggle("lit", targetY >= journeyNodeList[i].y);
    }
  }
  var journeyResizeT = null;
  window.addEventListener("resize", function () {
    clearTimeout(journeyResizeT);
    journeyResizeT = setTimeout(buildJourney, 280);
  });
  window.addEventListener("load", function () { setTimeout(buildJourney, 900); });

  /* ───────────────────────── hero globe ────────────────────────── */
  var heroCanvas = $("#heroGlobe");
  var heroGlobe = heroCanvas ? new MRGlobe(heroCanvas) : null;
  var heroRot = 18;
  var heroHazeA = $(".hero-haze-a"), heroHazeB = $(".hero-haze-b"), heroRouteSvg = $(".hero-route");
  function heroFrame(t) {
    if (!heroGlobe) return;
    var rect = heroCanvas.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      heroRot += 0.045;
      heroGlobe.render({
        rotation: heroRot,
        gridAlpha: 0.55,
        gpsPulse: (t % 1800) / 1800,
        cloudDrift: t * 0.0015
      });
    }
    /* depth parallax as the hero scrolls away */
    var sy = window.scrollY;
    if (sy < window.innerHeight * 1.3) {
      heroCanvas.style.transform = "translateY(" + (sy * 0.16).toFixed(1) + "px) scale(" + (1 + sy * 0.00012).toFixed(4) + ")";
      if (heroHazeA) heroHazeA.style.transform = "translateY(" + (sy * 0.26).toFixed(1) + "px)";
      if (heroHazeB) heroHazeB.style.transform = "translateY(" + (sy * 0.12).toFixed(1) + "px)";
      if (heroRouteSvg) heroRouteSvg.style.transform = "translateY(" + (sy * 0.08).toFixed(1) + "px)";
    }
    if (!REDUCED) requestAnimationFrame(heroFrame);
  }

  /* ───────────────────────── descent scene ─────────────────────── */
  var descentCanvas = $("#descentGlobe");
  var descentGlobe = descentCanvas ? new MRGlobe(descentCanvas) : null;
  var descentHaze = $("#descentHaze");
  var cityStage = $("#cityStage");
  var cityPlane = $("#cityPlane");
  var cityMarker = $("#cityMarker");
  var descentAlt = $("#descentAlt");
  var cloudEls = $all("#descentClouds i");
  var descentMeterFill = $("#descentMeterFill");
  var phases = $all(".descent-phase");

  var cityAreas = [];
  (function () {
    var svg = $("#cityAreas");
    if (!svg) return;
    cityAreas = genAreaGrid(svg, 1000, 1000, 56, 500, 500, 11);
    cityAreas.forEach(function (h) {
      h.ring = Math.round(h.dist / 97);
      h.el.style.transitionDelay = (h.ring * 0.055) + "s";
      h.captured = h.ring <= 1 && mapRand() < 0.6;
    });
  })();

  function descentUpdate(p, t) {
    if (!descentGlobe) return;
    var w = descentGlobe.w, h = descentGlobe.h;
    var minD = Math.min(w, h);

    /* camera: zoom + re-aim at the GPS point */
    var zoomP = easeCine(clamp(p / 0.6, 0, 1));
    var R = lerp(minD * 0.34, minD * 2.6, zoomP);
    var rot = lerp(heroRot % 360, -window.MR_GPS.lon, smooth(clamp(p / 0.5, 0, 1)));
    var aim = smooth(clamp((p - 0.08) / 0.45, 0, 1));
    var gp = descentGlobe.project(window.MR_GPS.lon, window.MR_GPS.lat, rot);
    var cx = w / 2 - gp.x * R * aim;
    var cy = h / 2 - gp.y * R * aim + lerp(h * 0.06, 0, zoomP);

    var detail = 1 - smooth(clamp((p - 0.3) / 0.3, 0, 1));
    var canvasFade = 1 - smooth(clamp((p - 0.5) / 0.2, 0, 1));
    descentCanvas.style.opacity = canvasFade;
    if (canvasFade > 0.01) {
      descentGlobe.render({
        rotation: rot, radius: R, cx: cx, cy: cy,
        gridAlpha: 0.5, detail: Math.max(detail, 0.15),
        gpsPulse: (t % 1500) / 1500, arcs: p < 0.25,
        cloudDrift: t * 0.0015
      });
    }

    /* clouds rush past the camera through the hand-off */
    for (var ci = 0; ci < cloudEls.length; ci++) {
      var cStart = 0.28 + ci * 0.05;
      var cl = clamp((p - cStart) / 0.32, 0, 1);
      var cop = Math.sin(cl * Math.PI);
      var csc = 0.5 + cl * (2.1 + ci * 0.35);
      var cty = lerp(h * 0.35, -h * 0.75, cl) * (1 + ci * 0.12);
      var ctx2 = (ci % 2 ? 1 : -1) * cl * w * 0.16;
      cloudEls[ci].style.opacity = (cop * 0.95).toFixed(3);
      cloudEls[ci].style.transform = "translate3d(" + ctx2.toFixed(1) + "px," + cty.toFixed(1) + "px,0) scale(" + csc.toFixed(3) + ")";
    }

    /* white haze swells through the hand-off */
    var haze = Math.exp(-Math.pow((p - 0.55) / 0.16, 2));
    descentHaze.style.opacity = (haze * 0.97).toFixed(3);

    /* city plane lands */
    var landE = easeCine(clamp((p - 0.47) / 0.5, 0, 1));
    var cp = smooth(clamp((p - 0.47) / 0.24, 0, 1));
    cityStage.style.opacity = cp.toFixed(3);
    var rx = lerp(62, 26, landE);
    var sc = lerp(1.42, 1.0, landE);
    var tz = lerp(h * 0.06, 0, landE);
    cityPlane.style.transform = "translateY(" + tz.toFixed(1) + "px) rotateX(" + rx.toFixed(2) + "deg) scale(" + sc.toFixed(3) + ")";

    if (cityMarker) cityMarker.classList.toggle("on", p > 0.6);
    for (var i = 0; i < cityAreas.length; i++) {
      var hx = cityAreas[i];
      var on = p > 0.62 + hx.ring * 0.035;
      hx.el.classList.toggle("on", on);
      hx.el.classList.toggle("captured", on && hx.captured && p > 0.88);
    }

    /* copy phases */
    var phase = p < 0.3 ? 0 : p < 0.62 ? 1 : 2;
    phases.forEach(function (el, i) { el.classList.toggle("on", i === phase); });

    /* altitude meter */
    if (descentAlt) {
      var alt = 6371 * Math.pow(1 - clamp(p, 0, 0.99), 4.2);
      descentAlt.textContent = p > 0.92 ? "STREET LEVEL" :
        (p < 0.04 ? "SAT · 6,371 km" : "ALT · " + (alt > 10 ? Math.round(alt).toLocaleString() + " km" : alt.toFixed(1) + " km"));
      descentMeterFill.style.width = (p * 100) + "%";
    }
  }

  /* ───────────────────────── move card distance ────────────────── */
  (function () {
    var card = $('.loop-card[data-loop="move"]');
    var out = card && card.querySelector(".move-dist");
    if (!card || !out || REDUCED) return;
    var start = null;
    function frame(t) {
      if (card.classList.contains("in")) {
        if (start === null) start = t;
        var rect = card.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
          var dur = parseFloat(getComputedStyle(card).getPropertyValue("--scene-speed")) * 1000 || 4500;
          var cyc = ((t - start) % dur) / dur;
          /* the route draws over the first 60% of each scene cycle */
          var p = easeCine(clamp(cyc / 0.6, 0, 1));
          out.textContent = (p * 2.4).toFixed(1) + " km";
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();

  /* ───────────────────────── phone scene ───────────────────────── */
  var phone = $("#phone");
  var pscreens = $all(".pscreen");
  var appSteps = $all("#appSteps li");
  var appBgRoute = $("#appBgRoute");
  var phoneBackplate = $("#phoneBackplate"), phoneBackplate2 = $("#phoneBackplate2");
  var lastScreen = -1;

  /* tiny map fills for the phone screens */
  $all(".ps-mapsvg").forEach(function (svg) {
    var g = document.createElementNS(SVGNS, "g");
    g.innerHTML =
      '<rect width="240" height="300" fill="#F2F7F3"/>' +
      '<ellipse cx="60" cy="60" rx="55" ry="40" fill="#DFF3E4"/>' +
      '<path d="M -10 230 C 60 210 140 250 250 220 L 250 310 L -10 310 Z" fill="#DCEEFB"/>' +
      '<g stroke="#E4E9EE" stroke-width="7" stroke-linecap="round"><path d="M 0 120 H 240 M 0 190 H 240 M 70 0 V 300 M 160 0 V 300"/></g>';
    svg.appendChild(g);
    var areas = genAreaGrid(svg, 240, 300, 26, 120, 165, 23);
    areas.forEach(function (h) {
      h.el.setAttribute("fill", h.dist < 60 ? "rgba(24,201,135,0.16)" : "rgba(36,107,254,0.02)");
      h.el.setAttribute("stroke", h.dist < 60 ? "rgba(24,201,135,0.65)" : "rgba(163,170,184,0.4)");
      h.el.setAttribute("stroke-width", "1.3");
    });
  });

  function phoneUpdate(p) {
    if (!phone) return;
    var idx = clamp(Math.floor(p * 6), 0, 5);
    if (idx !== lastScreen) {
      lastScreen = idx;
      pscreens.forEach(function (s, i) { s.classList.toggle("on", i === idx); });
      appSteps.forEach(function (s, i) { s.classList.toggle("on", i === idx); });
    }
    var ry = lerp(-9, 9, p);
    var rx = 4 * Math.sin(p * Math.PI);
    phone.style.transform = "perspective(1100px) rotateY(" + ry + "deg) rotateX(" + rx + "deg) translateY(" + (-8 * Math.sin(p * Math.PI)) + "px)";
    phone.style.setProperty("--glare", easeCine(p).toFixed(3));
    if (phoneBackplate) phoneBackplate.style.transform = "rotate(" + lerp(-8, 4, p).toFixed(2) + "deg) translateY(" + lerp(24, -24, p).toFixed(1) + "px)";
    if (phoneBackplate2) phoneBackplate2.style.transform = "rotate(" + lerp(7, -5, p).toFixed(2) + "deg) translate(" + lerp(-34, 34, p).toFixed(1) + "px," + lerp(-18, 26, p).toFixed(1) + "px)";
    if (appBgRoute) appBgRoute.style.strokeDashoffset = 2200 * (1 - easeCine(p));
  }

  /* ───────────────────────── live session ──────────────────────── */
  var sessionRoute = $("#sessionRoute");
  var sessionTrail = $("#sessionTrail");
  var sessionMarkerEl = $("#sessionMarker");
  var ssDist = $("#ssDist"), ssTime = $("#ssTime"), ssPace = $("#ssPace"), ssRing = $("#ssRing");
  var zoneToast = $("#zoneToast");
  var routeLen = 0, sessionAreas = [], captureAreas = [], toastTimer = null, lastZone = -1;

  (function () {
    if (!sessionRoute) return;
    routeLen = sessionRoute.getTotalLength();
    sessionRoute.style.strokeDasharray = routeLen;
    sessionRoute.style.strokeDashoffset = routeLen;
    var svg = $("#sessionAreas");
    sessionAreas = genAreaGrid(svg, 960, 520, 38, 480, 260, 37);
    /* mark the areas the route passes through as capture targets */
    var thresholds = [0.10, 0.26, 0.42, 0.58, 0.74, 0.90];
    thresholds.forEach(function (th, i) {
      var pt = sessionRoute.getPointAtLength(routeLen * th);
      var best = null, bd = 1e9;
      sessionAreas.forEach(function (h) {
        var d = Math.pow(h.x - pt.x, 2) + Math.pow(h.y - pt.y, 2);
        if (d < bd) { bd = d; best = h; }
      });
      if (best) captureAreas.push({ area: best, th: th, contested: i === 3 });
    });
  })();

  var sessionSvgEl = $(".session-svg");
  function sessionUpdate(p) {
    if (!sessionRoute) return;
    var dp = easeCine(p);
    if (sessionSvgEl && !REDUCED) {
      sessionSvgEl.style.transform = "scale(" + (1.06 - 0.06 * dp).toFixed(4) + ") translateX(" + ((0.5 - dp) * 2.5).toFixed(2) + "%)";
    }
    sessionRoute.style.strokeDashoffset = routeLen * (1 - dp);
    var pt = sessionRoute.getPointAtLength(routeLen * dp);
    sessionMarkerEl.setAttribute("transform", "translate(" + pt.x + "," + pt.y + ")");

    var km = dp * 2.4;
    ssDist.textContent = km.toFixed(1) + " km";
    var mins = dp * 18.37;
    ssTime.textContent = Math.floor(mins) + ":" + ("0" + Math.floor((mins % 1) * 60)).slice(-2);
    ssPace.textContent = km > 0.1 ? "5'" + (28 + Math.round(14 * Math.sin(dp * 9))) + '"' : "—";
    ssRing.style.strokeDashoffset = 94.2 * (1 - dp);

    var zone = -1;
    captureAreas.forEach(function (c, i) {
      var hit = dp > c.th;
      if (c.contested) {
        c.area.el.classList.toggle("contested", hit && dp < c.th + 0.18);
        c.area.el.classList.toggle("captured", dp >= c.th + 0.18);
      } else {
        c.area.el.classList.toggle("captured", hit);
      }
      if (hit) zone = i;
    });
    if (zone !== lastZone && zone > lastZone && zone >= 0 && p < 0.99) {
      zoneToast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { zoneToast.classList.remove("show"); }, 1300);
    }
    lastZone = zone;
  }

  /* ───────────────────────── counters ──────────────────────────── */
  function runCounter(el) {
    if (el.dataset.done) return;
    el.dataset.done = "1";
    var target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    var decimals = parseInt(el.dataset.decimals || "0", 10);
    var prefix = el.dataset.prefix || "";
    var suffix = el.dataset.suffix || "";
    if (REDUCED) { el.textContent = prefix + target.toLocaleString() + suffix; return; }
    var start = null, dur = 1250;
    function step(ts) {
      if (!start) start = ts;
      var t = easeOutCubic(clamp((ts - start) / dur, 0, 1));
      var v = target * t;
      el.textContent = prefix + (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString()) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ───────────────────────── reward moment ─────────────────────── */
  var rewardCard = $("#rewardCard");
  (function () {
    var svg = $("#rewardAreaCluster");
    if (!svg) return;
    /* five neighbouring parcels along the replayed route */
    var parcels = [
      [[128, 92], [170, 88], [172, 128], [126, 130]],
      [[178, 112], [212, 106], [216, 148], [180, 150]],
      [[96, 118], [120, 114], [122, 150], [92, 152]],
      [[128, 138], [172, 136], [170, 170], [132, 174]],
      [[178, 64], [214, 60], [212, 98], [180, 102]]
    ];
    parcels.forEach(function (pts, i) {
      var path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", roundedPath(pts, 9));
      path.style.transitionDelay = (0.5 + i * 0.18) + "s";
      svg.appendChild(path);
    });
  })();

  function rewardBurst() {
    var canvas = $("#rewardParticles");
    if (!canvas || REDUCED) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var colors = ["#F7B955", "#18C987", "#58F2B3", "#7657FF"];
    var parts = [];

    function emit(x, y, n, spread, delayBase) {
      for (var i = 0; i < n; i++) {
        var a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        var sp = 1.0 + Math.random() * 2.6;
        parts.push({
          x: x + (Math.random() - 0.5) * 36, y: y + (Math.random() - 0.5) * 20,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, max: 90 + Math.random() * 70,
          c: colors[(Math.random() * colors.length) | 0],
          chip: Math.random() < 0.5,
          s: 1.6 + Math.random() * 3,
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.1,
          ph: Math.random() * Math.PI * 2,          /* 3D flip phase */
          delay: delayBase + Math.random() * 45
        });
      }
    }
    /* one burst from the Captured stamp, a softer one from the XP rows */
    emit(rect.width * 0.4, rect.height * 0.18, 32, 2.2, 0);
    emit(rect.width * 0.72, rect.height * 0.5, 24, 1.9, 30);

    function frame() {
      ctx.clearRect(0, 0, rect.width, rect.height);
      var alive = false;
      parts.forEach(function (pp) {
        if (pp.delay > 0) { pp.delay--; alive = true; return; }
        pp.life++;
        if (pp.life > pp.max) return;
        alive = true;
        pp.x += pp.vx; pp.y += pp.vy;
        pp.vy = pp.vy * 0.992 + 0.012;   /* drag + the gentlest gravity */
        pp.vx *= 0.985;
        pp.rot += pp.vr;
        var o = 1 - smooth(pp.life / pp.max);
        ctx.globalAlpha = o * 0.92;
        ctx.fillStyle = pp.c;
        ctx.shadowColor = pp.c;
        ctx.shadowBlur = 9;
        if (pp.chip) {
          /* tiny rounded confetti chip with a slow 3D flip (scaleX oscillation) */
          var flip = Math.cos(pp.ph + pp.life * 0.07);
          var cw = pp.s * 1.7, ch = pp.s * 1.2, cr = pp.s * 0.4;
          ctx.save();
          ctx.translate(pp.x, pp.y);
          ctx.rotate(pp.rot);
          ctx.scale(Math.max(0.12, Math.abs(flip)), 1);
          ctx.beginPath();
          ctx.moveTo(-cw / 2 + cr, -ch / 2);
          ctx.arcTo(cw / 2, -ch / 2, cw / 2, ch / 2, cr);
          ctx.arcTo(cw / 2, ch / 2, -cw / 2, ch / 2, cr);
          ctx.arcTo(-cw / 2, ch / 2, -cw / 2, -ch / 2, cr);
          ctx.arcTo(-cw / 2, -ch / 2, cw / 2, -ch / 2, cr);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath(); ctx.arc(pp.x, pp.y, pp.s * 0.55, 0, Math.PI * 2); ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (alive) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, rect.width, rect.height);
    }
    requestAnimationFrame(frame);
  }

  /* ───────────────────────── economy areas ─────────────────────── */
  function fillEcoAreas(id, ratio, seed) {
    var svg = $(id);
    if (!svg) return;
    var areas = genAreaGrid(svg, 320, 180, 24, 160, 90, seed);
    areas.sort(function (a, b) { return a.dist - b.dist; });
    areas.forEach(function (h, i) {
      if (i < areas.length * ratio) {
        h.el.classList.add("lit");
        h.el.style.transitionDelay = (0.15 + i * 0.045) + "s";
      }
    });
  }
  fillEcoAreas("#ecoFreeAreas", 0.5, 41);
  fillEcoAreas("#ecoDeedAreas", 0.28, 43);

  /* ───────────────────────── clubs / city war ──────────────────── */
  var CLUB_COLORS = [
    ["rgba(36,107,254,0.30)", "rgba(36,107,254,0.75)"],
    ["rgba(24,201,135,0.30)", "rgba(24,201,135,0.75)"],
    ["rgba(247,185,85,0.34)", "rgba(247,185,85,0.85)"],
    ["rgba(255,107,74,0.28)", "rgba(255,107,74,0.7)"]
  ];
  var warAreas = [];
  (function () {
    var svg = $("#warMap");
    if (!svg) return;
    warAreas = genAreaGrid(svg, 460, 340, 27, 230, 170, 53);
    var seeds = [[110, 90], [340, 100], [140, 260], [360, 250]];
    warAreas.forEach(function (h) {
      var best = 0, bd = 1e9;
      seeds.forEach(function (s, i) {
        var d = Math.pow(h.x - s[0], 2) + Math.pow(h.y - s[1], 2) + mapRand() * 5200;
        if (d < bd) { bd = d; best = i; }
      });
      h.club = best;
      h.el.style.fill = "rgba(208,213,221,0.15)";
      h.el.style.stroke = "rgba(163,170,184,0.35)";
      h.el.style.transitionDelay = (mapRand() * 0.9) + "s";
    });
  })();
  function paintWar() {
    warAreas.forEach(function (h) {
      h.el.style.fill = CLUB_COLORS[h.club][0];
      h.el.style.stroke = CLUB_COLORS[h.club][1];
    });
  }
  /* The district map and the club board are static mockups: they paint once
     and never change on their own, so nothing on the page imitates live
     activity between players. */

  /* ───────────────────────── roadmap ───────────────────────────── */
  var roadTrack = $("#roadmapTrack");
  var roadOrb = $("#roadOrb");
  var roadFill = $("#roadFillPath");
  var roadPhases = $all(".phase", roadTrack);
  var roadLen = 0;
  if (roadFill) {
    roadLen = roadFill.getTotalLength();
    roadFill.style.strokeDasharray = roadLen;
    roadFill.style.strokeDashoffset = roadLen;
  }
  function roadmapFrame() {
    if (!roadTrack) return;
    var rect = roadTrack.getBoundingClientRect();
    if (rect.bottom > -100 && rect.top < window.innerHeight + 100) {
      var p = clamp((window.innerHeight * 0.62 - rect.top) / rect.height, 0, 1);
      var y = p * rect.height;
      roadOrb.style.top = y + "px";
      if (roadFill) roadFill.style.strokeDashoffset = roadLen * (1 - p);
      roadPhases.forEach(function (ph) {
        if (y > ph.offsetTop + 20) ph.classList.add("unlocked");
      });
    }
    if (!REDUCED) requestAnimationFrame(roadmapFrame);
  }

  /* ───────────────────────── final scene ───────────────────────── */
  var finalSection = $("#join");
  var finalAreas = [];
  (function () {
    var svg = $("#finalAreas");
    if (!svg) return;
    finalAreas = genAreaGrid(svg, 1400, 760, 46, 700, 380, 61);
    finalAreas.forEach(function (h) {
      if (mapRand() < 0.4) {
        h.lit = true;
        h.violet = mapRand() < 0.22;
        h.el.style.transitionDelay = (mapRand() * 2.2) + "s";
      }
    });
  })();
  var finalRoute = $("#finalRoute");
  var finalMarker = $("#finalMarker");
  function finalFrame(t) {
    if (finalRoute && finalSection.classList.contains("in")) {
      var len = finalRoute.getTotalLength();
      var p = clamp((t - finalStart) / 4400, 0, 1);
      var pt = finalRoute.getPointAtLength(len * easeCine(p));
      finalMarker.setAttribute("transform", "translate(" + pt.x + "," + pt.y + ")");
      if (p < 1 && !REDUCED) requestAnimationFrame(finalFrame);
    }
  }
  var finalStart = 0;

  /* ───────────────────────── observers ─────────────────────────── */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      $all(".num[data-count]", e.target).forEach(runCounter);
      if (e.target.id === "rewardCard") {
        setTimeout(rewardBurst, REDUCED ? 0 : 600);
      }
      if (e.target.id === "warMapWrap" || e.target.classList.contains("clubs-map")) {
        setTimeout(paintWar, 150);
      }
      io.unobserve(e.target);
    });
  }, { threshold: 0.3 });

  $all(".reveal, .loop-card, .eco-card, .eco-bridge, #rewardCard, .clubs-map").forEach(function (el) { io.observe(el); });

  /* hero stat chips counter (they sit above the fold) */
  window.addEventListener("load", function () {
    setTimeout(function () { $all(".hero-chips .num[data-count]").forEach(runCounter); }, REDUCED ? 100 : 1400);
  });

  var ioFinal = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      finalStart = performance.now();
      finalAreas.forEach(function (h) {
        if (h.lit) h.el.classList.add("lit");
        if (h.violet) h.el.classList.add("v");
      });
      if (!REDUCED) requestAnimationFrame(finalFrame);
      ioFinal.unobserve(e.target);
    });
  }, { threshold: 0.25 });
  if (finalSection) ioFinal.observe(finalSection);

  /* ───────────────────────── card tilt ─────────────────────────── */
  if (window.matchMedia("(hover: hover)").matches && !REDUCED) {
    $all(".tilt").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var dx = (e.clientX - r.left) / r.width - 0.5;
        var dy = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = "translateY(-8px) rotateX(" + (-dy * 5) + "deg) rotateY(" + (dx * 6) + "deg)";
      });
      card.addEventListener("pointerleave", function () {
        card.style.transform = "";
      });
    });
  }

  /* ───────────────────────── mobile CTA ────────────────────────── */
  var mobileCta = $("#mobileCta");
  if (mobileCta) {
    window.addEventListener("scroll", function () {
      var past = window.scrollY > window.innerHeight * 0.7;
      var nearJoin = finalSection && finalSection.getBoundingClientRect().top < window.innerHeight;
      mobileCta.classList.toggle("show", past && !nearJoin);
    }, { passive: true });
  }

  /* ───────────────────────── boot ──────────────────────────────── */
  function onResize() {
    if (heroGlobe) heroGlobe.resize();
    if (descentGlobe) descentGlobe.resize();
    /* no frame loop under reduced motion, so redraw the one static frame */
    if (REDUCED && heroGlobe) heroGlobe.render({ rotation: 30, gridAlpha: 0.5, gpsPulse: 0.3 });
  }
  window.addEventListener("resize", onResize);

  if (REDUCED) {
    /* static, accessible rendering: one globe frame, everything revealed */
    if (heroGlobe) heroGlobe.render({ rotation: 30, gridAlpha: 0.5, gpsPulse: 0.3 });
    $all(".reveal, .loop-card, .eco-card").forEach(function (el) { el.classList.add("in"); });
    $all(".num[data-count]").forEach(runCounter);
    phases.forEach(function (el) { el.classList.add("on"); });
    if (cityStage) { cityStage.style.opacity = 1; cityPlane.style.transform = "rotateX(30deg)"; }
    cityAreas.forEach(function (h) { h.el.classList.add("on"); });
    pscreens[0] && pscreens[0].classList.add("on");
    roadPhases.forEach(function (ph) { ph.classList.add("unlocked"); });
    if (roadFill) roadFill.style.strokeDashoffset = 0;
    paintWar();
    sessionUpdate(1);
  } else {
    addScene($(".descent"), descentUpdate);
    addScene($(".app-scene"), phoneUpdate);
    addScene($(".session"), sessionUpdate);
    requestAnimationFrame(loop);
    requestAnimationFrame(heroFrame);
    requestAnimationFrame(roadmapFrame);
  }
})();
