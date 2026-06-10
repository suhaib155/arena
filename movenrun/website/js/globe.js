/* ════════════════════════════════════════════════════════════════
   MovenRun · Daylight globe renderer
   A procedural canvas-2D Earth: pale blue oceans, soft green land,
   drifting clouds, a faint H3-style hex wrap, atmosphere rim, and a
   blinking GPS dot. No textures, no WebGL — runs anywhere at 60fps.
   ════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;

  /* Very low-poly stylized continents as [lon, lat] rings. They only
     need to read as "Earth in daylight" at landing-page scale. */
  var LAND = [
    /* North America */
    [[-168,66],[-160,70],[-140,70],[-125,71],[-110,72],[-90,73],[-80,72],[-70,67],[-60,60],[-65,55],[-60,50],[-65,45],[-70,42],[-75,38],[-78,33],[-80,28],[-82,25],[-88,29],[-95,28],[-97,26],[-100,22],[-105,20],[-95,16],[-90,15],[-85,12],[-82,8],[-88,14],[-94,16],[-99,18],[-105,23],[-110,26],[-113,30],[-118,33],[-123,38],[-124,43],[-124,48],[-128,52],[-132,56],[-140,60],[-150,60],[-156,58],[-165,60]],
    /* Greenland */
    [[-45,60],[-52,62],[-55,67],[-58,72],[-50,78],[-40,80],[-30,80],[-22,76],[-20,70],[-25,65],[-35,62]],
    /* South America */
    [[-78,8],[-72,11],[-62,10],[-55,5],[-50,0],[-45,-3],[-38,-7],[-35,-9],[-38,-15],[-40,-22],[-48,-26],[-53,-32],[-58,-36],[-62,-40],[-65,-45],[-68,-50],[-70,-54],[-72,-50],[-73,-44],[-72,-35],[-70,-25],[-70,-18],[-75,-12],[-80,-5],[-80,2]],
    /* Africa */
    [[-17,15],[-12,8],[-5,5],[5,5],[9,4],[9,-1],[13,-12],[12,-18],[15,-25],[18,-34],[25,-34],[30,-30],[35,-25],[40,-15],[40,-10],[43,-1],[48,5],[51,11],[44,11],[40,16],[38,20],[35,28],[30,31],[20,32],[10,34],[0,35],[-7,33],[-12,28],[-17,21]],
    /* Europe */
    [[-9,37],[-9,43],[-2,44],[-1,46],[-4,48],[-2,50],[4,52],[8,54],[8,57],[12,58],[18,60],[24,60],[30,61],[30,55],[24,52],[28,46],[22,40],[16,40],[12,44],[5,43],[0,40]],
    /* Asia */
    [[30,61],[40,68],[55,70],[75,73],[95,73],[115,73],[135,72],[155,69],[170,67],[179,65],[170,60],[160,60],[155,54],[145,50],[136,44],[130,40],[127,35],[122,30],[120,24],[110,19],[106,11],[103,2],[98,8],[94,16],[90,22],[85,21],[80,14],[77,8],[73,18],[68,24],[62,25],[57,26],[52,27],[48,30],[42,36],[36,37],[30,41],[27,41],[30,46],[30,52]],
    /* Australia */
    [[114,-22],[114,-30],[117,-35],[125,-32],[130,-32],[135,-35],[138,-36],[141,-38],[146,-39],[150,-37],[153,-32],[153,-26],[148,-20],[143,-14],[137,-12],[131,-12],[126,-14],[121,-18]],
    /* Indonesia-ish blob */
    [[100,1],[105,-3],[112,-7],[120,-9],[128,-7],[133,-3],[131,1],[124,1],[117,0],[110,1],[104,3]],
    /* Japan-ish sliver */
    [[131,32],[134,34],[138,36],[141,40],[142,44],[139,42],[136,37],[132,34]]
  ];

  /* Cloud puffs: [lon, lat, size in degrees] — drift independently. */
  var CLOUDS = [
    [-150,35,16],[-100,48,13],[-60,-10,15],[-30,20,12],[10,50,14],
    [25,-15,13],[60,30,15],[95,10,16],[130,-25,13],[160,45,14],
    [-120,-30,14],[80,-40,15],[-15,-45,13],[175,5,12]
  ];

  /* GPS landing point (used by hero blink + descent target). */
  var GPS = { lon: -74.0, lat: 40.7 };

  function Globe(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0;
    this.h = 0;
    this.tilt = -16 * D2R;
    this.resize();
  }

  Globe.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  /* Project lon/lat to unit-sphere view space (y down, z toward viewer). */
  Globe.prototype.project = function (lon, lat, rot) {
    var phi = lat * D2R;
    var theta = (lon + rot) * D2R;
    var x = Math.cos(phi) * Math.sin(theta);
    var y = Math.sin(phi);
    var z = Math.cos(phi) * Math.cos(theta);
    var ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    var y2 = y * ct - z * st;
    var z2 = y * st + z * ct;
    return { x: x, y: -y2, z: z2 };
  };

  /*
    opts:
      rotation   — degrees of spin
      cx, cy     — globe center in CSS px
      radius     — globe radius in CSS px
      cloudDrift — extra cloud rotation in degrees
      hexAlpha   — 0..1 strength of the hex wrap
      detail     — 0..1 fades hexes/clouds out during descent
      gpsPulse   — 0..1 phase of the GPS blink
      arcs       — whether to draw the route arc
  */
  Globe.prototype.render = function (opts) {
    var ctx = this.ctx;
    var w = this.w, h = this.h;
    if (!w) return;
    var cx = opts.cx != null ? opts.cx : w / 2;
    var cy = opts.cy != null ? opts.cy : h / 2;
    var R = opts.radius || Math.min(w, h) * 0.36;
    var rot = opts.rotation || 0;
    var detail = opts.detail != null ? opts.detail : 1;
    var hexAlpha = (opts.hexAlpha != null ? opts.hexAlpha : 0.5) * detail;

    ctx.clearRect(0, 0, w, h);

    /* Atmosphere halo */
    var halo = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R * 1.32);
    halo.addColorStop(0, "rgba(178, 217, 255, 0)");
    halo.addColorStop(0.62, "rgba(178, 217, 255, 0.38)");
    halo.addColorStop(1, "rgba(178, 217, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.32, 0, TAU);
    ctx.fill();

    /* Ocean sphere, lit from upper-left like morning sun */
    var ocean = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.1, cx, cy, R);
    ocean.addColorStop(0, "#EAF6FF");
    ocean.addColorStop(0.45, "#BBDCFC");
    ocean.addColorStop(0.8, "#8FC2F5");
    ocean.addColorStop(1, "#7AB2EC");
    ctx.fillStyle = ocean;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    /* Everything on the sphere clips to the disc */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    /* Land masses */
    var land = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    land.addColorStop(0, "#B6E8C2");
    land.addColorStop(1, "#8AD9A4");
    ctx.fillStyle = land;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(1, R * 0.004);
    for (var i = 0; i < LAND.length; i++) {
      this.drawRing(ctx, LAND[i], rot, cx, cy, R, true);
    }

    /* Hex wrap — faint H3-style grid */
    if (hexAlpha > 0.01) this.drawHexWrap(ctx, rot, cx, cy, R, hexAlpha);

    /* Route arc between two cities */
    if (opts.arcs !== false && detail > 0.05) {
      this.drawArc(ctx, { lon: -74, lat: 40.7 }, { lon: -0.1, lat: 51.5 }, rot, cx, cy, R, 0.55 * detail);
    }

    /* Clouds — separate drift so the sphere feels alive */
    if (detail > 0.02) {
      var drift = rot * 0.55 + (opts.cloudDrift || 0);
      for (var c = 0; c < CLOUDS.length; c++) {
        var cl = CLOUDS[c];
        var p = this.project(cl[0], cl[1], drift);
        if (p.z < 0.05) continue;
        var px = cx + p.x * R, py = cy + p.y * R;
        var s = cl[2] * 0.013 * R * (0.7 + 0.3 * p.z);
        var g = ctx.createRadialGradient(px, py, 0, px, py, s);
        g.addColorStop(0, "rgba(255,255,255," + (0.75 * p.z * detail) + ")");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, s * 1.5, s * 0.85, 0, 0, TAU);
        ctx.fill();
      }
    }

    /* Soft terminator shading bottom-right keeps it "daylight" but 3D */
    var shade = ctx.createRadialGradient(cx - R * 0.42, cy - R * 0.46, R * 0.2, cx, cy, R * 1.18);
    shade.addColorStop(0, "rgba(255,255,255,0.16)");
    shade.addColorStop(0.62, "rgba(120,160,210,0)");
    shade.addColorStop(1, "rgba(70,110,170,0.26)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    ctx.restore();

    /* Crisp rim highlight */
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    /* GPS dot */
    var gp = this.project(GPS.lon, GPS.lat, rot);
    if (gp.z > 0.05) {
      var gx = cx + gp.x * R, gy = cy + gp.y * R;
      var pulse = opts.gpsPulse != null ? opts.gpsPulse : 0;
      var ringR = R * (0.03 + 0.05 * pulse);
      ctx.strokeStyle = "rgba(24, 201, 135," + (0.7 * (1 - pulse)) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, ringR, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "#18C987";
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(3, R * 0.016), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    this.gpsScreen = { x: cx + gp.x * R, y: cy + gp.y * R, visible: gp.z > 0.05 };
  };

  Globe.prototype.drawRing = function (ctx, ring, rot, cx, cy, R, fill) {
    var front = 0;
    var pts = [];
    for (var i = 0; i < ring.length; i++) {
      var p = this.project(ring[i][0], ring[i][1], rot);
      if (p.z > 0) front++;
      /* Push back-facing points out to the silhouette so the shape
         clips cleanly at the horizon instead of folding over. */
      if (p.z < 0) {
        var len = Math.sqrt(p.x * p.x + p.y * p.y) || 1;
        p = { x: (p.x / len) * 1.01, y: (p.y / len) * 1.01, z: 0 };
      }
      pts.push(p);
    }
    if (front < 2) return;
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
      var x = cx + pts[j].x * R, y = cy + pts[j].y * R;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (fill) ctx.fill();
    ctx.stroke();
  };

  Globe.prototype.drawHexWrap = function (ctx, rot, cx, cy, R, alpha) {
    var size = 7.5; /* degrees */
    ctx.lineWidth = 1;
    for (var lat = -52.5; lat <= 60; lat += size * 1.5) {
      var stretch = 1 / Math.max(0.35, Math.cos(lat * D2R));
      var stepLon = size * 1.74 * stretch;
      var row = Math.round(lat / (size * 1.5));
      var offset = (row % 2) * stepLon * 0.5;
      for (var lon = -180 + offset; lon < 180; lon += stepLon) {
        var center = this.project(lon, lat, rot);
        if (center.z < 0.18) continue;
        ctx.strokeStyle = "rgba(36, 107, 254," + (alpha * 0.32 * center.z) + ")";
        ctx.beginPath();
        for (var k = 0; k <= 6; k++) {
          var a = (Math.PI / 180) * (60 * k + 30);
          var hlon = lon + (size * stretch) * Math.cos(a);
          var hlat = lat + size * Math.sin(a);
          var hp = this.project(hlon, hlat, rot);
          var x = cx + hp.x * R, y = cy + hp.y * R;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  };

  Globe.prototype.drawArc = function (ctx, a, b, rot, cx, cy, R, alpha) {
    var steps = 36;
    ctx.strokeStyle = "rgba(36, 107, 254," + alpha + ")";
    ctx.lineWidth = Math.max(1.2, R * 0.006);
    ctx.beginPath();
    var started = false;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var lon = a.lon + (b.lon - a.lon) * t;
      var lat = a.lat + (b.lat - a.lat) * t + Math.sin(t * Math.PI) * 14; /* lift */
      var p = this.project(lon, lat, rot);
      if (p.z < 0.02) { started = false; continue; }
      var x = cx + p.x * R, y = cy + p.y * R;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  window.MRGlobe = Globe;
  window.MR_GPS = GPS;
})();
