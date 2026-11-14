/* Car Deals Firebase web config.
   These values ship in the browser. They are public client identifiers,
   not secret keys. Restrict the API key in Google Cloud Console
   (see FIREBASE_SETUP.md). Never put a service-account private key,
   a Gemini API key, or an App Check secret in this file.
   appCheckSiteKey is the public reCAPTCHA site key, still empty.
   storageBucket is part of the web config. This site does not upload
   to Cloud Storage while the project is on the Spark plan. Photos are
   Firestore documents. See FIREBASE_SETUP.md. */
(function () {
  window.CAR_DEALS_FIREBASE = {
    apiKey: "AIzaSyAFPj6FxI-3QvmWydvF2mHNfp_L0ki6nhU",
    authDomain: "car-deals-d0ebf.firebaseapp.com",
    projectId: "car-deals-d0ebf",
    storageBucket: "car-deals-d0ebf.firebasestorage.app",
    messagingSenderId: "530290921535",
    appId: "1:530290921535:web:571a67780ab5806cc7e88a",
    measurementId: "G-8LJXWFY0MM",
    appCheckSiteKey: "",
    appCheckProvider: "v3",
  };
})();
