/*
 * MovenRun sign-in for the website: "Continue with Google" and "Continue with
 * Wallet", used by the account deletion page and the wallet sign-in page.
 *
 * Both go through Supabase Auth in MovenRun's project and end at the MovenRun
 * API, which checks the result. Only public values appear here: the API URL,
 * the Supabase project URL and its publishable key, all read from <meta> tags.
 *
 * Wallet sign-in asks the wallet for its address and one personal_sign of a
 * plain-text message the API wrote. It never requests a transaction, a chain
 * switch, a token approval or a recovery phrase.
 *
 * Wallets are found by EIP-6963: each installed wallet announces itself, and
 * when there is more than one the person picks. The page never silently takes
 * whichever extension wrote window.ethereum last; that global is used only
 * when no wallet announces itself (wallet in-app browsers that predate 6963).
 */
(function () {
  "use strict";

  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    var v = el ? (el.getAttribute("content") || "").trim() : "";
    return /^\{\{.*\}\}$/.test(v) ? "" : v;
  }

  var config = {
    api: meta("movenrun-api").replace(/\/+$/, ""),
    supabaseUrl: meta("movenrun-supabase-url").replace(/\/+$/, ""),
    supabaseKey: meta("movenrun-supabase-publishable-key"),
  };

  // HTTPS only; plain HTTP is accepted for a loopback test server alone.
  function okOrigin(url) {
    return /^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  }

  var apiReady = okOrigin(config.api);
  var googleReady = apiReady && okOrigin(config.supabaseUrl) && config.supabaseKey !== "" && !/^sb_secret_/.test(config.supabaseKey);

  // The API answers errors as { error: { code } }; only a plain code string is used.
  function errorCode(body) {
    var code = body && body.error && body.error.code;
    return typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : "sign_in_failed";
  }

  function failure(code) {
    var err = new Error(code);
    err.code = code;
    return err;
  }

  // The API runs on a free host that sleeps when idle and takes up to about a
  // minute to start. Calls wait that long, then end in a retry message.
  var API_TIMEOUT_MS = 90000;

  function apiPost(path, body, token) {
    var headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);
    return fetch(config.api + path, { method: "POST", headers: headers, body: JSON.stringify(body), signal: controller.signal })
      .then(function (r) { clearTimeout(timer); return r; }, function () {
        clearTimeout(timer);
        throw failure(controller.signal.aborted ? "timeout" : "network");
      });
  }

  // Start waking the API as soon as a sign-in page opens, so it is ready by
  // the time Google or the wallet hands back. The answer is not needed.
  if (apiReady) fetch(config.api + "/health").catch(function () { /* the sign-in call reports problems */ });

  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function pkcePair() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    var verifier = b64url(bytes);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(function (d) {
      return { verifier: verifier, challenge: b64url(new Uint8Array(d)) };
    });
  }

  var VERIFIER_KEY = "movenrun.google.verifier";

  /* Google, step 1: send the browser to Supabase with a PKCE challenge. The
     verifier stays in this tab's session storage. */
  function startGoogle() {
    if (!googleReady) return Promise.reject(failure("unavailable"));
    return pkcePair().then(function (p) {
      sessionStorage.setItem(VERIFIER_KEY, p.verifier);
      var back = location.origin + location.pathname;
      location.assign(config.supabaseUrl + "/auth/v1/authorize?provider=google" +
        "&redirect_to=" + encodeURIComponent(back) +
        "&scopes=" + encodeURIComponent("openid email profile") +
        "&code_challenge=" + p.challenge + "&code_challenge_method=s256");
    });
  }

  /* Google, step 2, on return: exchange the code, prove it to MovenRun, and
     sign the short-lived Supabase session out. Resolves with the MovenRun
     access token, or null when this page load is not a Google return. */
  function finishGoogle(deviceLabel) {
    var params = new URLSearchParams(location.search);
    var verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!params.has("code") && !params.has("error")) return Promise.resolve(null);
    sessionStorage.removeItem(VERIFIER_KEY);
    history.replaceState(null, "", location.pathname);
    if (params.has("error") || !verifier || !googleReady) return Promise.reject(failure("sign_in_failed"));
    var sbHeaders = { apikey: config.supabaseKey, authorization: "Bearer " + config.supabaseKey, "content-type": "application/json" };
    return fetch(config.supabaseUrl + "/auth/v1/token?grant_type=pkce", {
      method: "POST", headers: sbHeaders,
      body: JSON.stringify({ auth_code: params.get("code"), code_verifier: verifier }),
    }).then(function (r) {
      if (!r.ok) throw failure("sign_in_failed");
      return r.json();
    }).then(function (sb) {
      var supabaseToken = sb && sb.access_token;
      if (typeof supabaseToken !== "string") throw failure("sign_in_failed");
      return apiPost("/identity/auth/google/complete", { accessToken: supabaseToken, deviceLabel: deviceLabel }).then(function (r) {
        fetch(config.supabaseUrl + "/auth/v1/logout?scope=local", {
          method: "POST", headers: { apikey: config.supabaseKey, authorization: "Bearer " + supabaseToken },
        }).catch(function () { /* It expires on its own; nothing here keeps it. */ });
        return r.json().catch(function () { return null; }).then(function (body) {
          if (!r.ok) throw failure(errorCode(body));
          return body.session.accessToken;
        });
      });
    });
  }

  function hexUtf8(text) {
    var bytes = new TextEncoder().encode(text), hex = "0x";
    for (var i = 0; i < bytes.length; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
    return hex;
  }

  function isProvider(p) {
    return typeof p === "object" && p !== null && typeof p.request === "function";
  }

  // EIP-6963 discovery: wallets answer the request event with their details.
  var announced = [];
  window.addEventListener("eip6963:announceProvider", function (event) {
    var d = event && event.detail;
    if (!d || !d.info || typeof d.info.uuid !== "string" || !isProvider(d.provider)) return;
    for (var i = 0; i < announced.length; i++) if (announced[i].info.uuid === d.info.uuid) return;
    announced.push({
      info: { uuid: d.info.uuid, name: String(d.info.name || "Wallet").slice(0, 60), rdns: String(d.info.rdns || "").slice(0, 100) },
      provider: d.provider,
    });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  function hasWallet() {
    return announced.length > 0 || isProvider(window.ethereum);
  }

  /* The wallet to use: the only one announced, the one the person picks in
     `chooser` when several are, or the legacy global when none announce. */
  function pickWallet(chooser) {
    return new Promise(function (resolve) { setTimeout(resolve, 150); }).then(function () {
      if (announced.length === 1) return announced[0].provider;
      if (announced.length === 0) {
        if (isProvider(window.ethereum)) return window.ethereum;
        throw failure("no_wallet");
      }
      if (!chooser) throw failure("choose_wallet");
      return new Promise(function (resolve, reject) {
        chooser.textContent = "";
        var label = document.createElement("p");
        label.textContent = "More than one wallet is installed. Choose the one to sign in with:";
        chooser.appendChild(label);
        announced.forEach(function (w) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "wallet-option";
          // Names are shown as text only; nothing a wallet announces is rendered as markup.
          b.textContent = w.info.name + (w.info.rdns ? " (" + w.info.rdns + ")" : "");
          b.addEventListener("click", function () { chooser.hidden = true; chooser.textContent = ""; resolve(w.provider); });
          chooser.appendChild(b);
        });
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "wallet-option secondary";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", function () { chooser.hidden = true; chooser.textContent = ""; reject(failure("signature_declined")); });
        chooser.appendChild(cancel);
        chooser.hidden = false;
      });
    });
  }

  /* Wallet: address, the API's message, one signature, then the API checks it.
     With `handoffChallenge` (from the app) the API answers with a one-time
     code for the app instead of a session for this page. */
  function signInWithWallet(options) {
    if (!apiReady) return Promise.reject(failure("unavailable"));
    var address, wallet;
    return pickWallet(options.chooser).then(function (picked) {
      wallet = picked;
      return wallet.request({ method: "eth_requestAccounts" });
    }).then(function (accounts) {
      address = accounts && accounts[0];
      if (typeof address !== "string") throw failure("no_account");
      return apiPost("/identity/auth/wallet/begin", { address: address });
    }).then(function (r) {
      if (!r.ok) throw failure(r.status === 429 ? "too_many_attempts" : "sign_in_failed");
      return r.json();
    }).then(function (begin) {
      return wallet.request({ method: "personal_sign", params: [hexUtf8(begin.message), address] }).then(function (signature) {
        var body = { message: begin.message, signature: signature };
        if (options.handoffChallenge) body.handoffChallenge = options.handoffChallenge;
        else body.deviceLabel = options.deviceLabel;
        return apiPost("/identity/auth/wallet/complete", body);
      }, function () { throw failure("signature_declined"); });
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) throw failure(errorCode(body));
        return options.handoffChallenge ? body.handoff : body.session.accessToken;
      });
    });
  }

  var MESSAGES = {
    unavailable: "Online sign-in is not available right now. Use the app or email us; both work.",
    no_wallet: "No wallet was found in this browser. Open this page in your wallet app's browser, or use a browser with a wallet extension.",
    no_account: "Your wallet did not share an address. Unlock it and try again.",
    signature_declined: "The signature was declined, so nothing happened. You can try again.",
    registration_closed: "MovenRun's first release is full, so new accounts can't be created right now.",
    too_many_attempts: "Too many attempts. Please wait a moment and try again.",
    challenge_expired: "That sign-in request expired. Please start again.",
    challenge_consumed: "That sign-in request was already used. Please start again.",
    choose_wallet: "More than one wallet is installed. Choose one to continue.",
    registration_busy: "Lots of new players are joining right now. Please try again in a little while.",
    timeout: "MovenRun took too long to answer. It may have been starting up; please try again in a moment.",
    network: "We couldn't reach MovenRun. Check your connection and try again.",
  };

  function message(err) {
    return MESSAGES[err && err.code] || "Sign-in didn't complete. Please try again, or email us.";
  }

  window.MovenRunAuth = {
    apiReady: apiReady,
    googleReady: googleReady,
    hasWallet: hasWallet,
    apiPost: apiPost,
    startGoogle: startGoogle,
    finishGoogle: finishGoogle,
    signInWithWallet: signInWithWallet,
    message: message,
    errorCode: errorCode,
  };
})();
