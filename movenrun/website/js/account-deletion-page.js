(function () {
  var auth = window.MovenRunAuth;
  var status = document.getElementById("status");
  var signIn = document.getElementById("step-sign-in");
  var confirmForm = document.getElementById("step-confirm");
  var google = document.getElementById("google");
  var token = "";
  var LABEL = "Web deletion request";
  function say(text, kind) { status.textContent = text; status.className = "status" + (kind ? " " + kind : ""); }
  function lock(on) { google.disabled = on; document.getElementById("wallet").disabled = on; }
  function signedIn(t) { token = t; signIn.hidden = true; confirmForm.hidden = false; say(""); }
  if (!auth.apiReady) {
    signIn.hidden = true;
    say("Online deletion is not available right now. Use the app or email us; both work.");
    return;
  }
  google.hidden = !auth.googleReady;
  // Back from Google? Finish signing in.
  lock(true);
  auth.finishGoogle(LABEL).then(function (t) { lock(false); if (t) signedIn(t); },
    function (err) { lock(false); say(auth.message(err), "error"); });
  google.addEventListener("click", function () {
    lock(true); say("Opening Google…");
    auth.startGoogle().catch(function (err) { lock(false); say(auth.message(err), "error"); });
  });
  document.getElementById("wallet").addEventListener("click", function () {
    lock(true); say("Check your wallet: sign the MovenRun message to continue.");
    auth.signInWithWallet({ deviceLabel: LABEL, chooser: document.getElementById("wallet-choice") }).then(function (t) { lock(false); signedIn(t); },
      function (err) { lock(false); say(auth.message(err), "error"); });
  });
  confirmForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!token) return;
    confirmForm.querySelector("button").disabled = true; say("Deleting your account…");
    auth.apiPost("/identity/account/delete", { confirm: "DELETE" }, token).then(function (r) {
      confirmForm.querySelector("button").disabled = false;
      if (r.ok) { token = ""; confirmForm.hidden = true; say("Your MovenRun account and its data have been deleted.", "ok"); }
      else say("Your account could not be deleted right now. Please try again or email us.", "error");
    }, function () { confirmForm.querySelector("button").disabled = false; say("We could not reach MovenRun. Please try again.", "error"); });
  });
})();
