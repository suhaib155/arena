/* Progressive enhancement only: the <details> mobile menu works without JS;
   this closes it after a link is chosen or on Escape / outside click. */
(function () {
  var menu = document.getElementById("navMobile");
  if (!menu) return;
  menu.addEventListener("click", function (e) {
    if (e.target.closest("a")) menu.removeAttribute("open");
  });
  document.addEventListener("click", function (e) {
    if (menu.hasAttribute("open") && !menu.contains(e.target)) menu.removeAttribute("open");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu.hasAttribute("open")) {
      menu.removeAttribute("open");
      menu.querySelector("summary").focus();
    }
  });
})();
