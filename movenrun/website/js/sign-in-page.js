(function () {
  var auth = window.MovenRunAuth;
  var params = new URLSearchParams(location.search);
  var challenge = params.get("challenge") || "";
  var status = document.getElementById("status");
  function say(text, kind) { status.textContent = text; status.className = "status" + (kind ? " " + kind : ""); }
  // Only a challenge from the app is accepted, and the code only ever goes back to the app's own link.
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    document.getElementById("not-from-app").hidden = false;
    return;
  }
  document.getElementById("from-app").hidden = false;
  var sign = document.getElementById("sign");
  if (!auth.apiReady) { sign.hidden = true; say(auth.message({ code: "unavailable" }), "error"); return; }
  if (!auth.hasWallet()) say(auth.message({ code: "no_wallet" }));
  sign.addEventListener("click", function () {
    sign.disabled = true; say("Check your wallet: sign the MovenRun message to continue.");
    auth.signInWithWallet({ handoffChallenge: challenge, chooser: document.getElementById("wallet-choice") }).then(function (handoff) {
      var code = String(handoff.code);
      var link = "movenrun://auth/wallet?code=" + encodeURIComponent(code);
      document.getElementById("step-sign").hidden = true;
      document.getElementById("step-done").hidden = false;
      document.getElementById("code").textContent = code.replace(/(....)(?=.)/g, "$1 ");
      document.getElementById("return").setAttribute("href", link);
      say("");
      location.href = link;
    }, function (err) { sign.disabled = false; say(auth.message(err), "error"); });
  });
})();
