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

  function apiPost(path, body, token) {
    var headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    return fetch(config.api + path, { method: "POST", headers: headers, body: JSON.stringify(body) });
  }

  function failure(code) {
    var err = new Error(code);
    err.code = code;
    return err;
  }

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
          if (!r.ok) throw failure((body && body.error) || "sign_in_failed");
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

  function hasWallet() {
    return typeof window.ethereum === "object" && window.ethereum !== null && typeof window.ethereum.request === "function";
  }

  /* Wallet: address, the API's message, one signature, then the API checks it.
     With `handoffChallenge` (from the app) the API answers with a one-time
     code for the app instead of a session for this page. */
  function signInWithWallet(options) {
    if (!apiReady) return Promise.reject(failure("unavailable"));
    if (!hasWallet()) return Promise.reject(failure("no_wallet"));
    var address;
    return window.ethereum.request({ method: "eth_requestAccounts" }).then(function (accounts) {
      address = accounts && accounts[0];
      if (typeof address !== "string") throw failure("no_account");
      return apiPost("/identity/auth/wallet/begin", { address: address });
    }).then(function (r) {
      if (!r.ok) throw failure(r.status === 429 ? "too_many_attempts" : "sign_in_failed");
      return r.json();
    }).then(function (begin) {
      return window.ethereum.request({ method: "personal_sign", params: [hexUtf8(begin.message), address] }).then(function (signature) {
        var body = { message: begin.message, signature: signature };
        if (options.handoffChallenge) body.handoffChallenge = options.handoffChallenge;
        else body.deviceLabel = options.deviceLabel;
        return apiPost("/identity/auth/wallet/complete", body);
      }, function () { throw failure("signature_declined"); });
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) throw failure((body && body.error) || "sign_in_failed");
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
  };
})();
