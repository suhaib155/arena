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

  /* ───────────────────────── hex grid helper ───────────────────── */
  /* Pointy-top hexes covering a viewBox. Returns [{el,x,y,ring}]. */
  function genHexGrid(svg, vw, vh, r, cx, cy) {
    var hexes = [];
    var hw = r * Math.sqrt(3) / 2;
    var rowH = r * 1.5;
    var row = 0;
    for (var y = -r; y < vh + r; y += rowH, row++) {
      var off = (row % 2) * hw;
      for (var x = -hw + off; x < vw + hw; x += hw * 2) {
        var pts = [];
        for (var k = 0; k < 6; k++) {
          var a = Math.PI / 180 * (60 * k - 30);
          pts.push((x + r * Math.cos(a)).toFixed(1) + "," + (y + r * Math.sin(a)).toFixed(1));
        }
        var poly = document.createElementNS(SVGNS, "polygon");
        poly.setAttribute("points", pts.join(" "));
        svg.appendChild(poly);
        var dx = x - (cx != null ? cx : vw / 2);
        var dy = y - (cy != null ? cy : vh / 2);
        hexes.push({ el: poly, x: x, y: y, dist: Math.sqrt(dx * dx + dy * dy) });
      }
    }
    return hexes;
  }

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
    updateRail();
    requestAnimationFrame(loop);
  }

  /* ───────────────────────── runner rail ───────────────────────── */
  var railFill = $("#railFill"), railOrb = $("#railOrb");
  function updateRail() {
    if (!railFill) return;
    var doc = document.documentElement;
    var p = clamp(doc.scrollTop / (doc.scrollHeight - window.innerHeight), 0, 1);
    var span = window.innerHeight * 0.76;
    railFill.style.height = (p * span) + "px";
    railOrb.style.top = "calc(12vh + " + (p * span) + "px)";
  }

  /* ───────────────────────── hero globe ────────────────────────── */
  var heroCanvas = $("#heroGlobe");
  var heroGlobe = heroCanvas ? new MRGlobe(heroCanvas) : null;
  var heroRot = 18;
  function heroFrame(t) {
    if (!heroGlobe) return;
    var rect = heroCanvas.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      heroRot += 0.045;
      heroGlobe.render({
        rotation: heroRot,
        hexAlpha: 0.55,
        gpsPulse: (t % 1800) / 1800,
        cloudDrift: t * 0.0015
      });
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
  var descentMeterFill = $("#descentMeterFill");
  var phases = $all(".descent-phase");

  var cityHexes = [];
  (function () {
    var svg = $("#cityHexes");
    if (!svg) return;
    cityHexes = genHexGrid(svg, 1000, 1000, 56, 500, 500);
    cityHexes.forEach(function (h) {
      h.ring = Math.round(h.dist / 97);
      h.el.style.transitionDelay = (h.ring * 0.055) + "s";
      h.captured = h.ring <= 1 && Math.random() < 0.6;
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
    var canvasFade = 1 - smooth(clamp((p - 0.52) / 0.16, 0, 1));
    descentCanvas.style.opacity = canvasFade;
    if (canvasFade > 0.01) {
      descentGlobe.render({
        rotation: rot, radius: R, cx: cx, cy: cy,
        hexAlpha: 0.5, detail: Math.max(detail, 0.15),
        gpsPulse: (t % 1500) / 1500, arcs: p < 0.25,
        cloudDrift: t * 0.0015
      });
    }

    /* white haze swells through the hand-off */
    var haze = Math.exp(-Math.pow((p - 0.56) / 0.13, 2));
    descentHaze.style.opacity = (haze * 0.95).toFixed(3);

    /* city plane lands */
    var cp = smooth(clamp((p - 0.52) / 0.22, 0, 1));
    cityStage.style.opacity = cp.toFixed(3);
    var rx = lerp(56, 28, easeCine(clamp((p - 0.52) / 0.45, 0, 1)));
    var sc = lerp(1.32, 1.0, easeCine(clamp((p - 0.52) / 0.45, 0, 1)));
    cityPlane.style.transform = "rotateX(" + rx + "deg) scale(" + sc + ")";

    if (cityMarker) cityMarker.classList.toggle("on", p > 0.6);
    for (var i = 0; i < cityHexes.length; i++) {
      var hx = cityHexes[i];
      var on = p > 0.62 + hx.ring * 0.035;
      hx.el.classList.toggle("on", on);
      hx.el.classList.toggle("captured", on && hx.captured && p > 0.88);
    }

    /* copy phases */
    var phase = p < 0.3 ? 0 : p < 0.62 ? 1 : 2;
    phases.forEach(function (el, i) { el.classList.toggle("on", i === phase); });

    /* altitude meter */
    if (descentAlt) {
      var alt = 6371 * Math.pow(1 - clamp(p, 0, 0.99), 2.4);
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
    var hexes = genHexGrid(svg, 240, 300, 26, 120, 165);
    hexes.forEach(function (h) {
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
    if (appBgRoute) appBgRoute.style.strokeDashoffset = 2200 * (1 - easeCine(p));
  }

  /* ───────────────────────── live session ──────────────────────── */
  var sessionRoute = $("#sessionRoute");
  var sessionTrail = $("#sessionTrail");
  var sessionMarkerEl = $("#sessionMarker");
  var ssDist = $("#ssDist"), ssTime = $("#ssTime"), ssPace = $("#ssPace"), ssRing = $("#ssRing");
  var zoneToast = $("#zoneToast");
  var routeLen = 0, sessionHexes = [], captureHexes = [], toastTimer = null, lastZone = -1;

  (function () {
    if (!sessionRoute) return;
    routeLen = sessionRoute.getTotalLength();
    sessionRoute.style.strokeDasharray = routeLen;
    sessionRoute.style.strokeDashoffset = routeLen;
    var svg = $("#sessionHexes");
    sessionHexes = genHexGrid(svg, 960, 520, 38, 480, 260);
    /* mark the hexes the route passes through as capture targets */
    var thresholds = [0.10, 0.26, 0.42, 0.58, 0.74, 0.90];
    thresholds.forEach(function (th, i) {
      var pt = sessionRoute.getPointAtLength(routeLen * th);
      var best = null, bd = 1e9;
      sessionHexes.forEach(function (h) {
        var d = Math.pow(h.x - pt.x, 2) + Math.pow(h.y - pt.y, 2);
        if (d < bd) { bd = d; best = h; }
      });
      if (best) captureHexes.push({ hex: best, th: th, contested: i === 3 });
    });
  })();

  function sessionUpdate(p) {
    if (!sessionRoute) return;
    var dp = easeCine(p);
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
    captureHexes.forEach(function (c, i) {
      var hit = dp > c.th;
      if (c.contested) {
        c.hex.el.classList.toggle("contested", hit && dp < c.th + 0.18);
        c.hex.el.classList.toggle("captured", dp >= c.th + 0.18);
      } else {
        c.hex.el.classList.toggle("captured", hit);
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
    var svg = $("#rewardHexCluster");
    if (!svg) return;
    var centers = [[150, 110], [186, 131], [114, 131], [150, 152], [186, 89]];
    centers.forEach(function (c, i) {
      var pts = [];
      for (var k = 0; k < 6; k++) {
        var a = Math.PI / 180 * (60 * k - 30);
        pts.push((c[0] + 24 * Math.cos(a)).toFixed(1) + "," + (c[1] + 24 * Math.sin(a)).toFixed(1));
      }
      var poly = document.createElementNS(SVGNS, "polygon");
      poly.setAttribute("points", pts.join(" "));
      poly.style.transitionDelay = (0.5 + i * 0.18) + "s";
      svg.appendChild(poly);
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
    for (var i = 0; i < 54; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 0.6 + Math.random() * 2.4;
      parts.push({
        x: rect.width * (0.2 + Math.random() * 0.25),
        y: rect.height * (0.25 + Math.random() * 0.3),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.6,
        life: 0, max: 70 + Math.random() * 60,
        c: colors[i % colors.length],
        hex: Math.random() < 0.45, s: 2 + Math.random() * 3.2,
        delay: Math.random() * 50
      });
    }
    function frame() {
      ctx.clearRect(0, 0, rect.width, rect.height);
      var alive = false;
      parts.forEach(function (pp) {
        if (pp.delay > 0) { pp.delay--; alive = true; return; }
        pp.life++;
        if (pp.life > pp.max) return;
        alive = true;
        pp.x += pp.vx; pp.y += pp.vy; pp.vy += 0.015; pp.vx *= 0.985;
        var o = 1 - pp.life / pp.max;
        ctx.globalAlpha = o * 0.9;
        ctx.fillStyle = pp.c;
        if (pp.hex) {
          ctx.beginPath();
          for (var k = 0; k < 6; k++) {
            var a2 = Math.PI / 180 * (60 * k - 30) + pp.life * 0.04;
            var px = pp.x + pp.s * Math.cos(a2), py = pp.y + pp.s * Math.sin(a2);
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(pp.x, pp.y, pp.s * 0.6, 0, Math.PI * 2); ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      if (alive) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, rect.width, rect.height);
    }
    requestAnimationFrame(frame);
  }

  /* ───────────────────────── economy hexes ─────────────────────── */
  function fillEcoHexes(id, ratio) {
    var svg = $(id);
    if (!svg) return;
    var hexes = genHexGrid(svg, 320, 180, 24, 160, 90);
    hexes.sort(function (a, b) { return a.dist - b.dist; });
    hexes.forEach(function (h, i) {
      if (i < hexes.length * ratio) {
        h.el.classList.add("lit");
        h.el.style.transitionDelay = (0.15 + i * 0.045) + "s";
      }
    });
  }
  fillEcoHexes("#ecoFreeHexes", 0.5);
  fillEcoHexes("#ecoDeedHexes", 0.28);

  /* ───────────────────────── clubs / city war ──────────────────── */
  var CLUB_COLORS = [
    ["rgba(36,107,254,0.30)", "rgba(36,107,254,0.75)"],
    ["rgba(24,201,135,0.30)", "rgba(24,201,135,0.75)"],
    ["rgba(247,185,85,0.34)", "rgba(247,185,85,0.85)"],
    ["rgba(255,107,74,0.28)", "rgba(255,107,74,0.7)"]
  ];
  var warHexes = [];
  (function () {
    var svg = $("#warMap");
    if (!svg) return;
    warHexes = genHexGrid(svg, 460, 340, 27, 230, 170);
    var seeds = [[110, 90], [340, 100], [140, 260], [360, 250]];
    warHexes.forEach(function (h) {
      var best = 0, bd = 1e9;
      seeds.forEach(function (s, i) {
        var d = Math.pow(h.x - s[0], 2) + Math.pow(h.y - s[1], 2) + Math.random() * 5200;
        if (d < bd) { bd = d; best = i; }
      });
      h.club = best;
      h.el.style.fill = "rgba(208,213,221,0.15)";
      h.el.style.stroke = "rgba(163,170,184,0.35)";
      h.el.style.transitionDelay = (Math.random() * 0.9) + "s";
    });
  })();
  function paintWar() {
    warHexes.forEach(function (h) {
      h.el.style.fill = CLUB_COLORS[h.club][0];
      h.el.style.stroke = CLUB_COLORS[h.club][1];
    });
  }
  var warFlipTimer = null;
  function startWarFlips() {
    if (warFlipTimer || REDUCED) return;
    warFlipTimer = setInterval(function () {
      for (var i = 0; i < 3; i++) {
        var h = warHexes[Math.floor(Math.random() * warHexes.length)];
        h.club = (h.club + 1 + Math.floor(Math.random() * 3)) % 4;
        h.el.style.transitionDelay = "0s";
        h.el.style.fill = CLUB_COLORS[h.club][0];
        h.el.style.stroke = CLUB_COLORS[h.club][1];
      }
    }, 1800);
  }

  /* countdown */
  (function () {
    var el = $("#warTimer");
    if (!el) return;
    var secs = 23 * 3600 + 59 * 60 + 42;
    setInterval(function () {
      secs = Math.max(0, secs - 1);
      var hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
      el.textContent = ("0" + hh).slice(-2) + ":" + ("0" + mm).slice(-2) + ":" + ("0" + ss).slice(-2);
    }, 1000);
  })();

  /* leaderboard reorder */
  (function () {
    var wrap = $("#boardRows");
    if (!wrap || REDUCED) return;
    var rows = $all(".board-row", wrap);
    var order = [0, 1, 2, 3];
    var counts = [218, 204, 187, 142];
    setInterval(function () {
      var rect = wrap.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      /* a chasing club gains ground; occasionally overtakes */
      var i = 1 + Math.floor(Math.random() * 3);
      counts[order[i]] += 4 + Math.floor(Math.random() * 9);
      if (counts[order[i]] > counts[order[i - 1]]) {
        var tmp = order[i]; order[i] = order[i - 1]; order[i - 1] = tmp;
      }
      var rowH = rows[0].offsetHeight + 10;
      order.forEach(function (club, pos) {
        var row = rows[club];
        var domIdx = club;
        row.style.transform = "translateY(" + ((pos - domIdx) * rowH) + "px)";
        var span = row.querySelector(".club-info span");
        span.textContent = counts[club] + " hexes";
        var trend = row.querySelector(".club-trend");
        trend.className = "club-trend " + (pos < domIdx || (pos === domIdx && Math.random() < 0.6) ? "up" : "down");
        trend.textContent = trend.classList.contains("up") ? "▲" : "▼";
      });
    }, 2600);
  })();

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
  var finalHexes = [];
  (function () {
    var svg = $("#finalHexes");
    if (!svg) return;
    finalHexes = genHexGrid(svg, 1400, 760, 46, 700, 380);
    finalHexes.forEach(function (h) {
      if (Math.random() < 0.4) {
        h.lit = true;
        h.violet = Math.random() < 0.22;
        h.el.style.transitionDelay = (Math.random() * 2.2) + "s";
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
        startWarFlips();
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
      finalHexes.forEach(function (h) {
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
  }
  window.addEventListener("resize", onResize);

  if (REDUCED) {
    /* static, accessible rendering: one globe frame, everything revealed */
    if (heroGlobe) heroGlobe.render({ rotation: 30, hexAlpha: 0.5, gpsPulse: 0.3 });
    $all(".reveal, .loop-card, .eco-card").forEach(function (el) { el.classList.add("in"); });
    $all(".num[data-count]").forEach(runCounter);
    phases.forEach(function (el) { el.classList.add("on"); });
    if (cityStage) { cityStage.style.opacity = 1; cityPlane.style.transform = "rotateX(30deg)"; }
    cityHexes.forEach(function (h) { h.el.classList.add("on"); });
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
