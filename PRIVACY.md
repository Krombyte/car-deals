# Privacy

Car Deals is a static site at https://krombyte.github.io/car-deals/.

## On this device

The theme, saved cars, the analytics choice, and whether you dismissed the notice are stored in `localStorage`. They are not sent to the site owner unless you sign in, in which case the saved-car list is also copied to Firestore.

## Firebase project car-deals-d0ebf

The web config in `js/firebase-config.js` is a public client identifier. Sign-in uses Firebase Authentication. Saved cars, private listings, listing photos, and reports are Firestore documents. Photos are WebP bytes in a subcollection, not Cloud Storage.

## Analytics

Google Analytics for Firebase is on unless you opt out. The measurement ID is `G-8LJXWFY0MM`. The site records page views, listing opens, View listing clicks, and filter names. It does not send the search text. Advertising features and Google signals are turned off in the Analytics config. Opt out with the notice, or set `carDealsAnalytics` to `off` in local storage. That sets `ga-disable-G-8LJXWFY0MM` and disables collection.

## Help chat

When Firebase AI Logic can answer, the question and the FAQ are sent to Gemini through Firebase. The listing file and your email are not attached. If the call fails, the FAQ on the page is shown instead. No Gemini API key is in the repository.

## Other trackers

No other third-party tracker is loaded. Craigslist images are loaded from `images.craigslist.org` when a listing has a photo.
