/* Accounts, private listings, Firestore photos, Analytics, and the help model.
   PHOTO_SINK stays "firestore" on the Spark plan. Cloud Storage is not used.
   The Gemini key stays in Firebase; this file never contains one. */
var PHOTO_SINK = "firestore";
var HELP_MODEL = "gemini-3.8-flash";
var HELP_MAX_TURNS = 8;
var HELP_MAX_CHARS = 400;
var SDK = "./vendor/firebase/13.3.0/";

function configuredConfig(cfg) {
  return ["apiKey", "authDomain", "projectId", "appId"].every(function (key) {
    var value = cfg && cfg[key];
    return typeof value === "string" && value.trim().length > 8;
  });
}

function cleanText(value, limit) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit);
}

function optedOut() {
  try { return localStorage.getItem("carDealsAnalytics") === "off"; }
  catch (err) { return false; }
}

function authMessage(code) {
  if (code === "auth/operation-not-allowed") {
    return "That sign-in method is not turned on yet. Enable Email/Password or Google in Firebase Authentication, then try again.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized for sign-in yet. Add it in Firebase Authentication settings, then try again.";
  }
  if (code === "auth/email-already-in-use") return "An account with that email already exists. Sign in instead.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password" || code === "auth/missing-password") return "Use a password of at least 8 characters.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email or password is incorrect.";
  }
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/network-request-failed" || code === "unavailable") {
    return "Could not reach Firebase. Browsing still works.";
  }
  if (code === "permission-denied") {
    return "Firestore rejected the write. Deploy the rules in FIREBASE_SETUP.md, and use a verified email if you are publishing a car.";
  }
  return "That didn't work. Try again in a moment.";
}

(function () {
  var cfg = window.CAR_DEALS_FIREBASE || {};
  var state = {
    configured: configuredConfig(cfg),
    degraded: false,
    ready: false,
    user: null,
    db: null,
    auth: null,
    analytics: null,
    ai: null,
    model: null,
    faq: "",
    photos: {},
    editing: null,
    busy: false,
    authListeners: [],
    listListeners: [],
    photoListeners: [],
    lastTrack: {},
    sawPage: false,
  };

  function publicUser() {
    if (!state.user) return null;
    return {
      uid: state.user.uid,
      email: state.user.email || "",
      displayName: state.user.displayName || "",
      emailVerified: state.user.emailVerified === true,
    };
  }

  function emitAuth() {
    var user = publicUser();
    state.authListeners.forEach(function (fn) { fn(user); });
    renderAccount();
  }

  function emitListings(rows) {
    state.listListeners.forEach(function (fn) { fn(rows); });
  }

  function emitPhotos() {
    state.photoListeners.forEach(function (fn) { fn(); });
  }

  window.CarDealsCloud = {
    configured: state.configured,
    PHOTO_SINK: PHOTO_SINK,
    user: function () { return publicUser(); },
    ready: function () { return state.ready; },
    onAuth: function (fn) { state.authListeners.push(fn); fn(publicUser()); },
    onListings: function (fn) { state.listListeners.push(fn); },
    onPhotos: function (fn) { state.photoListeners.push(fn); },
    photos: function (firestoreId) { return state.photos[firestoreId] || []; },
    loadGallery: loadGallery,
    signUp: signUp,
    signIn: signIn,
    signInGoogle: signInGoogle,
    signOut: signOutUser,
    resetPassword: resetPassword,
    sendVerification: sendVerification,
    setSaved: setSaved,
    publishListing: publishListing,
    deleteListing: deleteListing,
    report: reportListing,
    beginEdit: function (listing) { state.editing = listing; fillSell(); openDialog("sell-dialog"); },
    track: track,
    setAnalyticsOptOut: setAnalyticsOptOut,
    analyticsOptOut: optedOut,
    setFaq: function (text) { state.faq = String(text || "").slice(0, 12000); state.model = null; },
    ask: askHelp,
  };

  function openDialog(id) {
    var dialog = document.getElementById(id);
    if (dialog && window.CarDealsA11y) window.CarDealsA11y.open(dialog);
  }

  function show(id, on) {
    var node = document.getElementById(id);
    if (node) node.hidden = !on;
  }

  function text(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value || "";
  }

  function degrade(message) {
    state.degraded = true;
    state.ready = true;
    window.CarDealsCloud.configured = false;
    text("auth-soon-copy", message || "Firebase didn't start. Browsing, filters, and listing details still work.");
    show("auth-soon", true);
    show("auth-signed-out", false);
    show("auth-signed-in", false);
    show("sell-soon", true);
    show("sell-form", false);
    text("sell-soon-copy", message || "Selling a car needs Firebase. Browsing still works.");
    emitAuth();
  }

  function renderAccount() {
    var button = document.getElementById("account-btn");
    var user = publicUser();
    if (button) {
      if (!state.configured || state.degraded) button.textContent = "Sign in";
      else if (!state.ready) button.textContent = "Account";
      else if (!user) button.textContent = "Sign in";
      else button.textContent = cleanText(user.displayName || user.email || "Account", 22);
    }
    if (!state.configured || state.degraded) return;
    show("auth-soon", false);
    show("auth-signed-out", !user);
    show("auth-signed-in", Boolean(user));
    if (user) {
      text("auth-hello", (user.displayName ? user.displayName + " · " : "") + (user.email || "Signed in"));
      show("auth-verify", !user.emailVerified);
      show("auth-resend", !user.emailVerified);
    }
    fillSell();
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    text("auth-title", mode === "up" ? "Create account" : mode === "reset" ? "Reset password" : "Sign in");
    text("auth-submit", mode === "up" ? "Create account" : mode === "reset" ? "Send reset email" : "Sign in");
    show("auth-password-label", mode !== "reset");
    show("auth-name-label", mode === "up");
    show("auth-google", mode !== "reset");
    show("auth-or", mode !== "reset");
    ["in", "up", "reset"].forEach(function (name) {
      var tab = document.getElementById("auth-tab-" + name);
      if (tab) tab.setAttribute("aria-selected", name === mode ? "true" : "false");
    });
    text("auth-error", "");
  }

  function fillSell() {
    var user = publicUser();
    var soon = document.getElementById("sell-soon");
    var form = document.getElementById("sell-form");
    var gate = document.getElementById("sell-gate");
    if (!form || !gate) return;
    if (!state.configured || state.degraded || !state.ready) {
      show("sell-soon", true);
      form.hidden = true;
      gate.hidden = true;
      return;
    }
    if (soon) soon.hidden = true;
    if (!user) {
      form.hidden = true;
      gate.hidden = false;
      text("sell-gate-copy", "Sign in to list a car.");
      show("sell-verify-btn", false);
      return;
    }
    if (!user.emailVerified) {
      form.hidden = true;
      gate.hidden = false;
      text("sell-gate-copy", "Verify your email before listing a car. Check your inbox.");
      show("sell-verify-btn", true);
      return;
    }
    gate.hidden = true;
    form.hidden = false;
    text("sell-title", state.editing ? "Edit your listing" : "Sell your car");
    text("sell-submit", state.editing ? "Save changes" : "Publish listing");
    show("sell-delete", Boolean(state.editing));
    if (!state.editing) return;
    var listing = state.editing;
    setValue("sell-year", listing.year);
    setValue("sell-make", listing.make);
    setValue("sell-model", listing.model);
    setValue("sell-trim", listing.trim);
    setValue("sell-price", listing.price);
    setValue("sell-miles", listing.mileage);
    setValue("sell-title-status", "clean");
    setValue("sell-city", listing.city);
    setValue("sell-state", listing.state);
    setValue("sell-zip", listing.zip);
    setValue("sell-description", listing.description);
    setValue("sell-name", listing.seller_name);
    setValue("sell-contact-value", listing.seller_phone || listing.seller_email || "");
    var pref = listing.contact_preference || "none";
    var radio = document.querySelector('input[name="sell-contact"][value="' + pref + '"]');
    if (radio) radio.checked = true;
  }

  function setValue(id, value) {
    var node = document.getElementById(id);
    if (node && value != null) node.value = String(value);
  }

  function fieldValue(id) {
    var node = document.getElementById(id);
    return node ? node.value : "";
  }

  function listingError(data, photos) {
    var year = Number(data.year);
    var price = Number(data.price);
    var miles = Number(data.mileage);
    var nowYear = window.CarDealsVehicles ? window.CarDealsVehicles.yearMax() : new Date().getFullYear();
    var minYear = window.CarDealsVehicles ? window.CarDealsVehicles.YEAR_MIN : 1950;
    if (!Number.isInteger(year) || year < minYear || year > nowYear) {
      return "Enter a model year from " + minYear + " through " + nowYear + ".";
    }
    if (!data.make || !data.model) return "Enter the make and model.";
    if (!Number.isInteger(price) || price < 500 || price > 60000) return "Enter a price from $500 through $60,000.";
    if (window.CarDealsFilters && window.CarDealsFilters.isPlaceholderPrice(price)) {
      return "That price looks like a placeholder. Enter the real asking price.";
    }
    if (!Number.isInteger(miles) || miles < 0 || miles > 1000000) return "Enter the mileage.";
    if (data.titleStatus !== "clean") return "Car Deals only publishes clean-title vehicles.";
    if (!data.city || !/^[A-Za-z]{2}$/.test(data.state) || !/^\d{5}(-\d{4})?$/.test(data.zip)) {
      return "Enter a city, a two-letter state, and a ZIP code.";
    }
    if (data.description.length > 4000) return "Keep the description under 4,000 characters.";
    if (!data.displayName) return "Enter the name buyers should see.";
    if (data.contactPreference === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactValue)) {
      return "Enter the email you want on the listing.";
    }
    if (data.contactPreference === "phone" && data.contactValue.replace(/\D/g, "").length < 7) {
      return "Enter the phone number you want on the listing.";
    }
    if (photos && photos.length > window.CarDealsPhotos.MAX_PHOTOS) return "Use at most 6 photos.";
    return "";
  }

  function readSellForm() {
    var selected = document.querySelector('input[name="sell-contact"]:checked');
    var preference = selected ? selected.value : "none";
    return {
      year: Number(fieldValue("sell-year")),
      make: cleanText(fieldValue("sell-make"), 40),
      model: cleanText(fieldValue("sell-model"), 40),
      trim: cleanText(fieldValue("sell-trim"), 80),
      price: Number(window.CarDealsVehicles ? window.CarDealsVehicles.digitsOnly(fieldValue("sell-price"), 7) : fieldValue("sell-price")),
      mileage: Number(window.CarDealsVehicles ? window.CarDealsVehicles.digitsOnly(fieldValue("sell-miles"), 7) : fieldValue("sell-miles")),
      titleStatus: fieldValue("sell-title-status"),
      city: cleanText(fieldValue("sell-city"), 48),
      state: cleanText(fieldValue("sell-state"), 2).toUpperCase(),
      zip: cleanText(fieldValue("sell-zip"), 10),
      description: cleanText(fieldValue("sell-description"), 4000),
      displayName: cleanText(fieldValue("sell-name"), 80),
      contactPreference: preference === "email" || preference === "phone" ? preference : "none",
      contactValue: preference === "none" ? "" : cleanText(fieldValue("sell-contact-value"), 120),
    };
  }

  async function boot() {
    if (!state.configured || PHOTO_SINK !== "firestore") return;
    var appMod;
    var authMod;
    var fsMod;
    var analyticsMod;
    var aiMod;
    var checkMod;
    try {
      appMod = await import(SDK + "firebase-app.js");
      authMod = await import(SDK + "firebase-auth.js");
      fsMod = await import(SDK + "firebase-firestore.js");
      try { analyticsMod = await import(SDK + "firebase-analytics.js"); } catch (err) { analyticsMod = null; }
      try { aiMod = await import(SDK + "firebase-ai.js"); } catch (err) { aiMod = null; }
      try { checkMod = await import(SDK + "firebase-app-check.js"); } catch (err) { checkMod = null; }
    } catch (err) {
      degrade("The Firebase scripts did not load. Browsing still works.");
      return;
    }
    var app;
    try {
      app = appMod.initializeApp({
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
        messagingSenderId: cfg.messagingSenderId,
        appId: cfg.appId,
        measurementId: cfg.measurementId,
      });
    } catch (err) {
      degrade("Firebase rejected the web config. Browsing still works.");
      return;
    }
    if (cfg.appCheckSiteKey && checkMod) {
      try {
        var Provider = cfg.appCheckProvider === "enterprise" ? checkMod.ReCaptchaEnterpriseProvider : checkMod.ReCaptchaV3Provider;
        checkMod.initializeAppCheck(app, {
          provider: new Provider(cfg.appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (err) { /* App Check is optional until the site key is pasted. */ }
    }
    state.fs = fsMod;
    state.authMod = authMod;
    state.aiMod = aiMod;
    state.db = fsMod.getFirestore(app);
    state.auth = authMod.getAuth(app);
    authMod.onAuthStateChanged(state.auth, async function (user) {
      state.user = user;
      state.ready = true;
      emitAuth();
      if (user) await mergeSaved(user);
    });
    listenListings();
    startAnalytics(app, analyticsMod);
    if (aiMod) {
      try {
        var options = { backend: new aiMod.GoogleAIBackend() };
        if (cfg.appCheckSiteKey) options.useLimitedUseAppCheckTokens = true;
        state.ai = aiMod.getAI(app, options);
      } catch (err) { state.ai = null; }
    }
    state.ready = true;
    renderAccount();
  }

  function startAnalytics(app, analyticsMod) {
    if (!analyticsMod || !cfg.measurementId) return;
    analyticsMod.isSupported().then(function (ok) {
      if (!ok) return;
      if (optedOut()) window["ga-disable-" + cfg.measurementId] = true;
      try {
        state.analytics = analyticsMod.initializeAnalytics(app, {
          config: {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
          },
        });
      } catch (err) {
        try { state.analytics = analyticsMod.getAnalytics(app); } catch (again) { return; }
      }
      analyticsMod.setAnalyticsCollectionEnabled(state.analytics, !optedOut());
      state.analyticsMod = analyticsMod;
      if (!optedOut()) track("page_view", "", "load");
    }).catch(function () { /* Analytics is optional. */ });
  }

  function setAnalyticsOptOut(off) {
    try { localStorage.setItem("carDealsAnalytics", off ? "off" : "on"); } catch (err) { /* ignore */ }
    if (cfg.measurementId) window["ga-disable-" + cfg.measurementId] = Boolean(off);
    if (state.analytics && state.analyticsMod) {
      state.analyticsMod.setAnalyticsCollectionEnabled(state.analytics, !off);
    }
  }

  function track(type, listingId, detail) {
    if (optedOut() || !state.analytics || !state.analyticsMod) return;
    var allowed = { page_view: 1, listing_open: 1, view_listing: 1, filter: 1 };
    if (!allowed[type]) return;
    if (type === "page_view" && state.sawPage) return;
    var key = type + ":" + (detail || "");
    var now = Date.now();
    if (type === "filter" && state.lastTrack[key] && now - state.lastTrack[key] < 1200) return;
    state.lastTrack[key] = now;
    if (type === "page_view") state.sawPage = true;
    try {
      state.analyticsMod.logEvent(state.analytics, type === "filter" ? "filter_use" : type, {
        listing_id: cleanText(listingId, 80),
        filter_name: cleanText(detail, 40),
      });
    } catch (err) { /* ignore a blocked analytics call */ }
  }

  function listenListings() {
    var fs = state.fs;
    var q = fs.query(
      fs.collection(state.db, "listings"),
      fs.where("status", "==", "public"),
      fs.orderBy("updatedAt", "desc"),
      fs.limit(200)
    );
    fs.onSnapshot(q, function (snap) {
      var rows = [];
      snap.forEach(function (docSnap) { rows.push(toListing(docSnap)); });
      emitListings(rows);
      rows.forEach(function (row) {
        if (!state.photos[row.firestore_id]) loadCover(row.firestore_id);
      });
    }, function () {
      emitListings([]);
    });
  }

  function toListing(docSnap) {
    var data = docSnap.data() || {};
    var posted = "";
    if (data.createdAt && typeof data.createdAt.toDate === "function") {
      posted = data.createdAt.toDate().toISOString();
    }
    var preference = data.contactPreference === "email" || data.contactPreference === "phone" ? data.contactPreference : "none";
    return {
      id: "u" + docSnap.id,
      firestore_id: docSnap.id,
      owner_id: data.ownerId || "",
      seller_type: "private",
      source: "Private seller",
      title: [data.year, data.make, data.model, data.trim].filter(Boolean).join(" "),
      year: data.year,
      make: data.make || "",
      model: data.model || "",
      trim: data.trim || "",
      body_type: "",
      price: data.price,
      mileage: data.mileage,
      city: data.city || "",
      state: data.state || "",
      zip: data.zip || "",
      distance_mi: null,
      url: "",
      image_url: "",
      image_urls: [],
      description: data.description || "",
      title_status: data.titleStatus || "",
      est_market_value: null,
      market_value_method: "insufficient_comps",
      market_comp_count: 0,
      valuation_source: "comparable_listings",
      valuation_label: "Private listing. No comparable estimate is calculated in the browser. This is not a Kelley Blue Book value.",
      deal_rating: "unrated",
      seller_name: data.displayName || "",
      seller_phone: preference === "phone" ? data.contactValue || "" : "",
      seller_email: preference === "email" ? data.contactValue || "" : "",
      contact_preference: preference,
      contact_note: preference === "none" ? "This seller did not post a phone number or email." : "Contact the seller using the method they posted.",
      posted_at: posted,
      first_seen: posted,
      last_checked: posted,
    };
  }

  function blobFromPhoto(data) {
    if (!data || (data.contentType !== "image/webp" && data.contentType !== "image/jpeg") || !data.image || typeof data.image.toUint8Array !== "function") return "";
    var bytes = data.image.toUint8Array();
    if (!bytes || bytes.length < 32 || bytes.length > 200 * 1024) return "";
    return URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
  }

  function remember(firestoreId, urls) {
    var previous = state.photos[firestoreId] || [];
    previous.forEach(function (url) { URL.revokeObjectURL(url); });
    state.photos[firestoreId] = urls;
    emitPhotos();
  }

  async function loadCover(firestoreId) {
    if (!state.db || Object.prototype.hasOwnProperty.call(state.photos, firestoreId)) return;
    state.photos[firestoreId] = [];
    try {
      var snap = await state.fs.getDoc(state.fs.doc(state.db, "listings", firestoreId, "photos", "0"));
      var url = snap.exists() ? blobFromPhoto(snap.data()) : "";
      remember(firestoreId, url ? [url] : []);
    } catch (err) { /* rules may not be deployed yet */ }
  }

  async function loadGallery(firestoreId) {
    if (!state.db || !firestoreId) return [];
    var urls = [];
    var i;
    for (i = 0; i < 6; i += 1) {
      try {
        var snap = await state.fs.getDoc(state.fs.doc(state.db, "listings", firestoreId, "photos", String(i)));
        if (!snap.exists()) continue;
        var url = blobFromPhoto(snap.data());
        if (url) urls.push(url);
      } catch (err) { break; }
    }
    remember(firestoreId, urls);
    return urls;
  }

  async function mergeSaved(user) {
    var fs = state.fs;
    var remote = [];
    try {
      var snap = await fs.getDocs(fs.collection(state.db, "users", user.uid, "saved"));
      snap.forEach(function (docSnap) { remote.push(docSnap.id); });
    } catch (err) { return; }
    var local = [];
    try {
      var raw = JSON.parse(localStorage.getItem("carDealsSaved") || "[]");
      if (Array.isArray(raw)) local = raw.filter(function (id) { return typeof id === "string" && id.length < 100; });
    } catch (err) { local = []; }
    var union = Array.from(new Set(remote.concat(local))).slice(0, 200);
    var missing = union.filter(function (id) { return remote.indexOf(id) === -1; });
    var writes = missing.map(function (id) {
      return fs.setDoc(fs.doc(state.db, "users", user.uid, "saved", id), { savedAt: fs.serverTimestamp() });
    });
    try { await Promise.all(writes); } catch (err) { /* keep the local hearts */ }
    try { localStorage.setItem("carDealsSaved", JSON.stringify(union)); } catch (err) { /* ignore */ }
    document.dispatchEvent(new CustomEvent("cardeals-saved", { detail: union }));
  }

  async function setSaved(id, on) {
    var user = state.user;
    if (!user || !state.db) return;
    var ref = state.fs.doc(state.db, "users", user.uid, "saved", id);
    try {
      if (on) await state.fs.setDoc(ref, { savedAt: state.fs.serverTimestamp() });
      else await state.fs.deleteDoc(ref);
    } catch (err) { /* the heart still sticks on this device */ }
  }

  function mailSettings() {
    return {
      url: "https://krombyte.github.io/car-deals/auth-action.html",
      handleCodeInApp: true,
    };
  }

  async function signUp(email, password, name) {
    text("auth-error", "");
    if (String(password || "").length < 8) {
      text("auth-error", authMessage("auth/weak-password"));
      return;
    }
    try {
      var cred = await state.authMod.createUserWithEmailAndPassword(state.auth, cleanText(email, 120), password);
      if (name) await state.authMod.updateProfile(cred.user, { displayName: cleanText(name, 80) });
      await state.authMod.sendEmailVerification(cred.user, mailSettings());
      await state.fs.setDoc(state.fs.doc(state.db, "users", cred.user.uid), {
        displayName: cleanText(name || email, 80),
        updatedAt: state.fs.serverTimestamp(),
      }, { merge: true });
      text("auth-error", "Account created. Check your email to verify it before you list a car.");
    } catch (err) {
      text("auth-error", authMessage(err && err.code));
    }
  }

  async function signIn(email, password) {
    text("auth-error", "");
    try {
      await state.authMod.signInWithEmailAndPassword(state.auth, cleanText(email, 120), password);
    } catch (err) {
      text("auth-error", authMessage(err && err.code));
    }
  }

  async function signInGoogle() {
    text("auth-error", "");
    try {
      var provider = new state.authMod.GoogleAuthProvider();
      var cred = await state.authMod.signInWithPopup(state.auth, provider);
      await state.fs.setDoc(state.fs.doc(state.db, "users", cred.user.uid), {
        displayName: cleanText(cred.user.displayName || cred.user.email || "Seller", 80),
        updatedAt: state.fs.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      text("auth-error", authMessage(err && err.code));
    }
  }

  async function signOutUser() {
    try { await state.authMod.signOut(state.auth); } catch (err) { text("auth-error", authMessage(err && err.code)); }
  }

  async function resetPassword(email) {
    text("auth-error", "");
    try {
      await state.authMod.sendPasswordResetEmail(state.auth, cleanText(email, 120), mailSettings());
      text("auth-error", "If that inbox is registered, a reset message is on the way.");
    } catch (err) {
      text("auth-error", authMessage(err && err.code));
    }
  }

  async function sendVerification() {
    if (!state.user) return;
    try {
      await state.authMod.sendEmailVerification(state.user, mailSettings());
      text("auth-error", "Verification email sent.");
      text("sell-error", "Verification email sent.");
    } catch (err) {
      text("auth-error", authMessage(err && err.code));
    }
  }

  async function writePhotos(listingId, uid, blobs) {
    var fs = state.fs;
    var i;
    for (i = 0; i < blobs.length; i += 1) {
      var ref = fs.doc(state.db, "listings", listingId, "photos", String(i));
      var bytes = new Uint8Array(await blobs[i].arrayBuffer());
      if (bytes.length > 200 * 1024) throw new Error("size");
      var mime = blobs[i].type === "image/jpeg" ? "image/jpeg" : "image/webp";
      await fs.setDoc(ref, {
        ownerId: uid,
        listingId: listingId,
        index: i,
        contentType: mime,
        image: fs.Bytes.fromUint8Array(bytes),
        createdAt: fs.serverTimestamp(),
      });
    }
    for (i = blobs.length; i < 6; i += 1) {
      var extra = fs.doc(state.db, "listings", listingId, "photos", String(i));
      var existing = await fs.getDoc(extra);
      if (existing.exists()) await fs.deleteDoc(extra);
    }
  }

  async function freshUser() {
    if (!state.user) return null;
    await state.user.reload();
    await state.user.getIdToken(true);
    return state.user;
  }

  function writeError(step, err) {
    if (err && err.message === "size") return "A photo was over 200 KB after compression.";
    if (err && err.code === "permission-denied") {
      if (step === "photos") {
        return "Firestore rejected the photos. If you just verified your email, try again in a moment. JPEG photos also need the latest rules published.";
      }
      return "Firestore rejected the listing. Publish the Firestore rules, and use a verified email.";
    }
    return authMessage(err && err.code);
  }

  async function publishListing(blobs) {
    if (state.busy) return;
    var user = await freshUser();
    if (!user || !user.emailVerified) {
      text("sell-error", "Verify your email before listing a car. If you just verified it, wait a moment and try again.");
      return;
    }
    var data = readSellForm();
    var problem = listingError(data, blobs);
    if (problem) { text("sell-error", problem); return; }
    state.busy = true;
    text("sell-error", state.editing ? "Saving…" : "Publishing…");
    var fs = state.fs;
    var listingId = state.editing && state.editing.firestore_id;
    var step = "listing";
    try {
      if (!listingId) {
        var ref = fs.doc(fs.collection(state.db, "listings"));
        listingId = ref.id;
        await fs.setDoc(ref, Object.assign({
          ownerId: user.uid,
          status: "public",
          source: "private",
          sellerType: "private",
          photoCount: 0,
          createdAt: fs.serverTimestamp(),
          updatedAt: fs.serverTimestamp(),
        }, data));
      }
      var photoCount = state.editing ? state.editing.photo_count || 0 : 0;
      if (blobs && blobs.length) {
        step = "photos";
        text("sell-error", "Saving photos…");
        await writePhotos(listingId, user.uid, blobs);
        photoCount = blobs.length;
      }
      step = "listing";
      await fs.updateDoc(fs.doc(state.db, "listings", listingId), Object.assign({
        photoCount: photoCount,
        updatedAt: fs.serverTimestamp(),
      }, data));
      state.editing = null;
      text("sell-error", "Saved.");
      var form = document.getElementById("sell-form");
      if (form && !state.editing) form.reset();
      if (window.CarDealsSell) window.CarDealsSell.resetPhotos();
    } catch (err) {
      text("sell-error", writeError(step, err));
    } finally {
      state.busy = false;
    }
  }

  async function deleteListing(firestoreId) {
    if (!state.user || !firestoreId) return;
    var fs = state.fs;
    var i;
    for (i = 0; i < 6; i += 1) {
      try { await fs.deleteDoc(fs.doc(state.db, "listings", firestoreId, "photos", String(i))); } catch (err) { /* slot empty */ }
    }
    await fs.deleteDoc(fs.doc(state.db, "listings", firestoreId));
    state.editing = null;
  }

  async function reportListing(listingId, reason) {
    var user = state.user;
    if (!user) return { ok: false, message: "Sign in to report a listing." };
    var why = cleanText(reason, 500);
    if (why.length < 3) return { ok: false, message: "Add a short reason." };
    try {
      await state.fs.addDoc(state.fs.collection(state.db, "reports"), {
        listingId: cleanText(listingId, 128),
        reason: why,
        reporterId: user.uid,
        createdAt: state.fs.serverTimestamp(),
      });
      return { ok: true, message: "Report sent. Thank you." };
    } catch (err) {
      return { ok: false, message: authMessage(err && err.code) };
    }
  }

  function ensureModel() {
    if (!state.ai || !state.aiMod || state.model) return state.model;
    var prompt = (window.CAR_DEALS_HELP_PROMPT || "") + "\n\nFAQ:\n" + (state.faq || "");
    state.model = state.aiMod.getGenerativeModel(state.ai, {
      model: HELP_MODEL,
      systemInstruction: prompt.slice(0, 14000),
    });
    return state.model;
  }

  async function askHelp(question, history) {
    var text = cleanText(question, HELP_MAX_CHARS);
    if (!text) return { ok: false, code: "empty" };
    var turns = (history || []).filter(function (item) { return item && item.role === "user"; });
    if (turns.length >= HELP_MAX_TURNS) return { ok: false, code: "limit" };
    if (!state.ai) return { ok: false, code: "unavailable" };
    var lines = (history || []).slice(-12).map(function (item) {
      return (item.role === "user" ? "Visitor: " : "Assistant: ") + cleanText(item.text, 500);
    });
    lines.push("Visitor: " + text);
    lines.push("Assistant:");
    try {
      var result = await ensureModel().generateContent(lines.join("\n"));
      var reply = result && result.response && typeof result.response.text === "function" ? result.response.text() : "";
      reply = cleanText(reply, 2000);
      if (!reply) return { ok: false, code: "unavailable" };
      return { ok: true, text: reply };
    } catch (err) {
      return { ok: false, code: "unavailable" };
    }
  }

  document.addEventListener("click", function (event) {
    var node = event.target;
    if (!node || !node.closest) return;
    if (node.closest("#account-btn")) openDialog("auth-dialog");
    if (node.closest("#sell-btn")) {
      if (!state.editing) state.editing = null;
      fillSell();
      openDialog("sell-dialog");
    }
    if (node.closest("#auth-tab-in")) setAuthMode("in");
    if (node.closest("#auth-tab-up")) setAuthMode("up");
    if (node.closest("#auth-tab-reset")) setAuthMode("reset");
    if (node.closest("#auth-google")) signInGoogle();
    if (node.closest("#auth-signout")) signOutUser();
    if (node.closest("#auth-resend") || node.closest("#sell-verify-btn")) sendVerification();
    if (node.closest("#sell-gate-signin")) openDialog("auth-dialog");
  });

  var authForm = document.getElementById("auth-form");
  if (authForm) {
    authForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var email = fieldValue("auth-email");
      var password = fieldValue("auth-password");
      if (state.authMode === "up") signUp(email, password, fieldValue("auth-name"));
      else if (state.authMode === "reset") resetPassword(email);
      else signIn(email, password);
    });
  }
  var sellForm = document.getElementById("sell-form");
  if (sellForm) {
    sellForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var files = window.CarDealsSell ? window.CarDealsSell.files() : [];
      var blobs = [];
      var i;
      text("sell-error", "");
      try {
        for (i = 0; i < files.length; i += 1) {
          text("sell-error", "Preparing photo " + (i + 1) + " of " + files.length + "…");
          blobs.push(await window.CarDealsPhotos.compressFile(files[i]));
        }
      } catch (err) {
        text("sell-error", err && err.message === "size"
          ? "One photo could not be compressed under 200 KB. Try a different picture."
          : "Use a JPEG, PNG, WebP, or GIF photo.");
        return;
      }
      publishListing(files.length ? blobs : null);
    });
  }
  var deleteBtn = document.getElementById("sell-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async function () {
      if (!state.editing || !window.confirm("Delete this listing?")) return;
      try {
        await deleteListing(state.editing.firestore_id);
        text("sell-error", "Listing deleted.");
        if (window.CarDealsA11y) window.CarDealsA11y.close(document.getElementById("sell-dialog"));
      } catch (err) {
        text("sell-error", authMessage(err && err.code));
      }
    });
  }

  setAuthMode("in");
  renderAccount();
  if (state.configured) boot().catch(function () { degrade("Firebase didn't start. Browsing still works."); });
  else degrade("Firebase is not configured.");
})();
