/* Finish an email verification or password reset on this site.
   The code is applied only after a click, so a scanner that just opens
   the link does not use it up. */
(function () {
  var params = new URLSearchParams(window.location.search);
  var mode = params.get("mode") || "";
  var code = params.get("oobCode") || "";

  function text(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function show(id, on) {
    var node = document.getElementById(id);
    if (node) node.hidden = !on;
  }

  function fail(err) {
    var known = err && err.code === "auth/invalid-action-code";
    text("action-status", known
      ? "This link is invalid or already used. Request a new email from the Car Deals sign-in screen."
      : "That didn't work. Request a new email from the Car Deals sign-in screen.");
  }

  async function boot() {
    if (!code) {
      text("action-status", "This link is missing its code. Request a new email from the sign-in screen.");
      return;
    }
    var cfg = window.CAR_DEALS_FIREBASE || {};
    if (!cfg.apiKey || !cfg.projectId) {
      text("action-status", "Accounts are not connected yet.");
      return;
    }
    var appMod = await import("./vendor/firebase/13.3.0/firebase-app.js");
    var authMod = await import("./vendor/firebase/13.3.0/firebase-auth.js");
    var app = appMod.initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      appId: cfg.appId,
    });
    var auth = authMod.getAuth(app);
    if (mode === "resetPassword") {
      text("action-title", "Choose a new password");
      text("action-status", "Click save when you are ready. Opening this page does not use up the link.");
      show("action-reset", true);
      document.getElementById("action-reset").addEventListener("submit", function (event) {
        event.preventDefault();
        var password = document.getElementById("action-password").value;
        if (password.length < 8) {
          text("action-status", "Use at least 8 characters.");
          return;
        }
        authMod.confirmPasswordReset(auth, code, password).then(function () {
          text("action-status", "Password saved. You can sign in with it now.");
          show("action-reset", false);
        }).catch(fail);
      });
      return;
    }
    if (mode === "verifyEmail" || mode === "recoverEmail") {
      show("action-verify", true);
      document.getElementById("action-verify").addEventListener("click", function () {
        authMod.applyActionCode(auth, code).then(function () {
          text("action-title", "Email confirmed");
          text("action-status", "Your email is verified. Go back to Car Deals and sign in.");
          show("action-verify", false);
        }).catch(fail);
      });
      return;
    }
    text("action-status", "This link is not one Car Deals can finish. Request a new email from the sign-in screen.");
  }

  boot().catch(fail);
})();
