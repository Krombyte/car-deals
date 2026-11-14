# Firebase setup

Project id: `car-deals-d0ebf`. The web config is already in `js/firebase-config.js`. Those values are public client identifiers. Do not commit a service-account JSON file.

## Restrict the API key

The browser key is in the repository. Restrict it before you rely on the site.

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=car-deals-d0ebf).
2. Open the API key whose value matches `apiKey` in `js/firebase-config.js`.
3. Application restrictions: **HTTP referrers**. Add:
   - `https://krombyte.github.io/*`
   - `http://localhost/*`
   - `http://127.0.0.1/*`
   - `http://localhost:8080/*`
   - `http://127.0.0.1:8080/*`
4. API restrictions: **Restrict key**. Allow only the Firebase APIs this site calls:
   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API
   - Firebase Installations API
   - Firebase App Check API (after you turn on App Check)
   - Firebase AI Logic API (after you turn on the help chat)
5. Save. Google Analytics uses the measurement ID `G-8LJXWFY0MM`, not this key.

If a call starts failing, add only the API named in the error. Do not switch the key back to unrestricted. If the key is abused, create a new browser key in the Firebase console, restrict it the same way, and replace `apiKey` in `js/firebase-config.js`.

## Authentication

Browse works even if these steps are not done. Sign-in then shows a specific error instead of a broken page.

1. Firebase console → Authentication → Sign-in method.
2. Enable **Email/Password**. Leave email link (passwordless) off.
3. Enable **Google**.
4. Authentication → Settings → Authorized domains: `krombyte.github.io` and `localhost`.

Email/Password accounts must verify their email before Sell your car will publish. Google accounts are usually already verified.

## Firestore rules

The default database exists and starts empty. Deploy the rules in this repo or every private-listing read and write is denied:

```bash
npx --yes firebase-tools@15.36.0 login
npx --yes firebase-tools@15.36.0 deploy --only firestore:rules,firestore:indexes --project car-deals-d0ebf
```

Do not run `firebase deploy --only storage` while the project is on the Spark plan. Storage provisioning requires Blaze.

## Photos

Photos are resized in the browser (longest side 1280px, WebP, at most 200 KB, up to 6) and stored as Firestore documents at `listings/{id}/photos/{0-5}`. Each document stays under the 1 MiB limit. Rules allow the owner to write and the public to read a photo only when that listing is public.

`storage.rules` is the later Cloud Storage policy (images under 5 MB, only in the uploader's path). It is not deployed yet.

## Analytics

`measurementId` is `G-8LJXWFY0MM`. The page loads Firebase Analytics, turns off Google signals and ad personalization, and sends page views, listing opens, View listing clicks, and filter names. The notice can opt out. That opt-out is stored on the device and disables collection.

## App Check

1. Create a reCAPTCHA v3 (or Enterprise) site key for `krombyte.github.io` and `localhost`.
2. Firebase console → App Check → register the web app with that provider.
3. Paste the **site** key into `appCheckSiteKey` in `js/firebase-config.js`. Leave the secret in the reCAPTCHA admin, not in git.
4. Enforce App Check for Firestore and for Firebase AI Logic after a local test. AI Logic requires enforcement.

## Help chat (Gemini on the Spark plan)

1. Firebase console → AI Services → AI Logic → Get started.
2. Choose the **Gemini Developer API** (the no-cost provider). Do not choose the Agent Platform / Vertex provider; that one requires Blaze.
3. Do not copy the Gemini key into the site. Firebase AI Logic calls `firebasevertexai.googleapis.com` with the Firebase app and App Check.
4. The model name is `HELP_MODEL` in `js/firebase-client.js` (`gemini-3.8-flash`).

Until App Check and AI Logic are on, Help still opens the FAQ and says the assistant is not available. It does not invent prices.

## Switching photos to Cloud Storage later

After you upgrade to the Blaze plan:

1. Create the default bucket in `us-central1` so it can use the [Cloud Storage Always Free](https://cloud.google.com/storage/pricing) quota (5 GB-months Standard storage, 5,000 Class A operations, 50,000 Class B operations, and 100 GB of North America egress per month, shared across `us-central1`, `us-east1`, and `us-west1`). There is no hard stop at those amounts.
2. Confirm `storageBucket` is `car-deals-d0ebf.firebasestorage.app`.
3. Deploy `storage.rules`.
4. Change `PHOTO_SINK` in `js/firebase-client.js` only when a Storage upload path is added. Until that code exists, leave the sink on `firestore`.
5. Add `https://firebasestorage.googleapis.com` to `connect-src` and `img-src` in `index.html`.
