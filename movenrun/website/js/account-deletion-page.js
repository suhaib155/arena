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
      if (!r.ok) { say("Your account could not be deleted right now. Please try again or email info@movenrun.xyz (Team MovenRun).", "error"); return; }
      token = ""; confirmForm.hidden = true;
      // The API reports the sign-in record at the provider as "removed", "pending" or "none".
      // Only "removed" and "none" mean the deletion is complete.
      return r.json().then(function (b) { return b && typeof b.signInRecord === "string" ? b.signInRecord : ""; }, function () { return ""; }).then(function (record) {
        if (record === "removed") say("Deletion complete. Your MovenRun account, its data and your sign-in record have been removed.", "ok");
        else if (record === "none") say("Deletion complete. Your MovenRun account and its data have been removed. There was no separate sign-in record to remove.", "ok");
        else if (record === "pending") say("Deletion requested. Your MovenRun account and its data have been erased. Removing your sign-in record at our sign-in provider is still in progress and is retried automatically. Questions: info@movenrun.xyz, Team MovenRun.", "ok");
        else say("Deletion requested. Your MovenRun account and its data have been erased, but we could not confirm the final step, removing your sign-in record. Questions: info@movenrun.xyz, Team MovenRun.", "ok");
      });
    }, function () { confirmForm.querySelector("button").disabled = false; say("We could not reach MovenRun. Please try again.", "error"); });
  });
})();
