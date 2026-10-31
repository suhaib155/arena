(function () {
  var auth = window.MovenRunAuth;
  var outcomes = window.MovenRunDeletionOutcome;
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
    var button = confirmForm.querySelector("button");
    button.disabled = true; say("Sending your deletion request…");
    auth.apiPost("/identity/account/delete", { confirm: "DELETE" }, token).then(function (r) {
      // Read the body for every status: the wording depends on what the server confirmed.
      return r.json().catch(function () { return null; }).then(function (body) {
        button.disabled = false;
        var outcome = outcomes.deletionOutcome(r.status, body);
        if (outcomes.endsRequest(r.status)) { token = ""; confirmForm.hidden = true; }
        say(outcome.text, outcome.kind);
      });
    }, function () { button.disabled = false; say("We could not reach MovenRun. Nothing was confirmed as deleted. Please try again.", "error"); });
  });
})();
