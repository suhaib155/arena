/* ════════════════════════════════════════════════════════════════
   MovenRun Docs · progressive enhancement layer.
   Content and navigation work without this file; it adds:
   mobile drawer, search modal, heading copy-links, active TOC,
   and the whitepaper print control. No dependencies, no network
   beyond the same-origin search index.
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $all = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ── Mobile drawer ─────────────────────────────────────────── */
  var toggle = $(".dnav-toggle"), sidebar = $("#dsidebar"), scrim = $(".dscrim");
  function drawerOpen() { return sidebar.classList.contains("open"); }
  function setDrawer(open) {
    sidebar.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      var first = sidebar.querySelector("a, summary");
      if (first) first.focus();
    } else {
      toggle.focus();
    }
  }
  if (toggle && sidebar && scrim) {
    toggle.addEventListener("click", function () { setDrawer(!drawerOpen()); });
    scrim.addEventListener("click", function () { setDrawer(false); });
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest("a") && drawerOpen()) {
        sidebar.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        scrim.hidden = true;
        document.body.style.overflow = "";
      }
    });
  }

  /* ── Heading anchors (copy link) ───────────────────────────── */
  function headingText(h) {
    var c = h.cloneNode(true);
    $all(".badge, .hanchor", c).forEach(function (n) { n.remove(); });
    return c.textContent.trim();
  }
  $all(".darticle h2[id], .darticle h3[id]").forEach(function (h) {
    var a = document.createElement("a");
    a.className = "hanchor";
    a.href = "#" + h.id;
    a.textContent = "#";
    a.setAttribute("aria-label", "Link to section: " + headingText(h));
    a.addEventListener("click", function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(location.origin + location.pathname + "#" + h.id).catch(function () {});
      }
    });
    h.appendChild(a);
  });

  /* ── Code copy buttons ─────────────────────────────────────── */
  $all(".darticle pre").forEach(function (pre) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dcopy";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.style.cssText = "position:absolute;top:8px;right:8px;font:600 11px var(--font-body);color:var(--graphite);background:#fff;border-radius:8px;padding:5px 10px;box-shadow:0 2px 8px rgba(16,24,40,.12)";
    pre.style.position = "relative";
    btn.addEventListener("click", function () {
      var code = pre.querySelector("code") || pre;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code.textContent).then(function () {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1400);
        }).catch(function () {});
      }
    });
    pre.appendChild(btn);
  });

  /* ── Right-rail TOC + scrollspy ────────────────────────────── */
  var tocList = $("[data-toc]");
  var headings = $all(".darticle h2[id], .darticle h3[id]");
  if (tocList && headings.length) {
    headings.forEach(function (h) {
      var li = document.createElement("li");
      if (h.tagName === "H3") li.className = "lvl3";
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = headingText(h);
      li.appendChild(a);
      tocList.appendChild(li);
    });
    var links = $all("a", tocList);
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.id;
        links.forEach(function (l) { l.classList.toggle("active", l.getAttribute("href") === "#" + id); });
      });
    }, { rootMargin: "-72px 0px -70% 0px", threshold: 0 });
    headings.forEach(function (h) { spy.observe(h); });
  }

  /* ── Print control (whitepaper) ────────────────────────────── */
  var printBtn = $("[data-print]");
  if (printBtn) printBtn.addEventListener("click", function () { window.print(); });

  /* ── Search ────────────────────────────────────────────────── */
  var modal = $(".dsearch"), openBtn = $(".dsearch-btn");
  if (modal && openBtn) {
    var input = $("input", modal), results = $(".dsearch-results", modal);
    var emptyMsg = $(".dsearch-empty", modal), failMsg = $(".dsearch-fail", modal);
    var closeBtn = $(".dsearch-close", modal);
    var index = null, failed = false, lastFocus = null, sel = -1;

    function loadIndex() {
      if (index || failed) return Promise.resolve();
      return fetch("/docs/assets/search-index.json")
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) { index = j; })
        .catch(function () { failed = true; failMsg.hidden = false; });
    }
    function openSearch() {
      lastFocus = document.activeElement;
      modal.hidden = false;
      document.body.style.overflow = "hidden";
      input.value = ""; render([]);
      input.focus();
      loadIndex();
    }
    function closeSearch() {
      modal.hidden = true;
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function score(page, terms) {
      var t = (page.title + " " + page.section).toLowerCase();
      var h = page.headings.join(" ").toLowerCase();
      var d = (page.description + " " + page.keywords).toLowerCase();
      var s = 0;
      for (var i = 0; i < terms.length; i++) {
        var q = terms[i];
        if (t.indexOf(q) !== -1) s += 6;
        else if (h.indexOf(q) !== -1) s += 3;
        else if (d.indexOf(q) !== -1) s += 1;
        else return 0; /* every term must match somewhere */
      }
      return s;
    }
    function render(items) {
      results.innerHTML = "";
      sel = -1;
      emptyMsg.hidden = true;
      items.forEach(function (p) {
        var li = document.createElement("li");
        li.setAttribute("role", "option");
        li.innerHTML = '<a href="' + p.url + '"><em>' + p.section + "</em><strong>" + p.title + "</strong><span>" + p.description + "</span></a>";
        results.appendChild(li);
      });
    }
    function run() {
      if (failed || !index) return;
      var q = input.value.trim().toLowerCase();
      if (!q) { render([]); return; }
      var terms = q.split(/\s+/).slice(0, 6);
      var hits = index
        .map(function (p) { return { p: p, s: score(p, terms) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8)
        .map(function (x) { return x.p; });
      render(hits);
      emptyMsg.hidden = hits.length > 0;
    }
    function move(delta) {
      var items = $all("li", results);
      if (!items.length) return;
      sel = (sel + delta + items.length) % items.length;
      items.forEach(function (li, i) { li.setAttribute("aria-selected", String(i === sel)); });
      items[sel].scrollIntoView({ block: "nearest" });
    }
    openBtn.addEventListener("click", openSearch);
    closeBtn.addEventListener("click", closeSearch);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeSearch(); });
    input.addEventListener("input", run);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter" && sel >= 0) {
        var a = $all("li", results)[sel].querySelector("a");
        if (a) location.href = a.href;
      }
    });
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === "/" && !typing && modal.hidden) { e.preventDefault(); openSearch(); }
      if (e.key === "Escape") {
        if (!modal.hidden) closeSearch();
        else if (sidebar && drawerOpen()) setDrawer(false);
      }
    });
  }
})();
