# Development

Product copy lives in the root README. Firebase project steps live in [FIREBASE_SETUP.md](../FIREBASE_SETUP.md). This file keeps the build, data, and layout notes that used to sit in the README.

## Look at it locally

From the repository root:

```bash
python3 -m http.server 8080
```

Open http://127.0.0.1:8080/

The page loads `data/listings.json` with a relative URL, so the same files work locally and at `https://krombyte.github.io/car-deals/`.

Filters, the Mustang and Saved tabs, and the sort order are stored in the query string. Hearts and the theme are stored in the browser only until someone signs in, when saved cars also sync to Firestore.

The default theme is teal on a dark navy canvas. The sun/moon control switches to an off-white page with a navy accent. The first visit follows `prefers-color-scheme` when nothing has been saved yet.

## GitHub Pages

The live URL is **https://krombyte.github.io/car-deals/** once Pages is pointed at the Actions workflow.

1. On GitHub, open **Settings → Pages** for this repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. A push to `main` that touches the site files runs **Deploy GitHub Pages**. You can also run that workflow by hand (**Actions → Deploy GitHub Pages → Run workflow**).

The workflow copies `index.html`, `privacy.html`, `robots.txt`, `sitemap.xml`, `FAQ.md`, `css/`, `js/`, `fonts/`, `assets/`, `data/`, and `.nojekyll` into a Pages artifact. It does not publish the scraper or this docs folder.

A push made with the repository's built-in `GITHUB_TOKEN` does **not** start other workflows. Listing updates therefore deploy from the **Update listings** workflow's own deploy job, after the JSON commit lands. Ordinary pushes to `main` still deploy through **Deploy GitHub Pages** when a site path changed.

## How the data is updated

`data/listings.json` is the scraped database. A scheduled workflow (`.github/workflows/scrape.yml`) runs every four hours, and you can run it by hand.

Locally:

```bash
python3 -m unittest tests.test_scrape -v
python3 -m scraper --delay 1.6
```

`--delay` is the pause between posting-page fetches, plus a little jitter. Values under 0.8 seconds are rejected. `--cache .cache/listings` keeps raw HTML so a parser change can be re-run without fetching again. The cache is gitignored.

What the scraper does:

- Reads public Craigslist search and posting pages for cars and trucks around Madison, WI 53703. Regions: Madison (300-mile search), plus Madison, Milwaukee, Chicago, Rockford, Dubuque, Appleton, Green Bay, La Crosse, Eau Claire, Minneapolis, and the Quad Cities. Each region is queried twice: once for every car, and once with `query=mustang`, because Craigslist caps each result window.
- Keeps posts that are still up, priced from $500 through $60,000, with a clean title, and a map pin within 300 miles of 53703. There is no mileage cap. Under 120,000 miles is only a chip on the page. Odometers under 50 or over 1,000,000 are dropped as junk. Placeholder prices (`$1234`, `$1111`, and similar) and posts that say the price is not real are dropped. Expired and 404 posts are dropped. Cross-posts are deduped. Financing spam, lease takeovers, and parts posts are skipped. VINs are removed from the stored description.
- Facebook Marketplace is not collected. It requires a login and forbids automated collection. Other large listing sites were checked and not added because their robots.txt or terms do not clearly allow it.
- Sends `CarDealsBot` with a link to this repository. It does not log in, does not hit paths `robots.txt` disallows (`/reply`, `/flag`, `/mailflag`, and the rest of that list), and stops if Craigslist answers 403 or 429 repeatedly. A partial run does not overwrite a good JSON file.
- Estimates market value only from other rows in the same file. It never claims a Kelley Blue Book number. A licensed provider can be plugged in later with the `VALUATION_PROVIDER` and `VALUATION_API_KEY` secrets. See `scraper/valuation.py`.

The browser refetches the JSON every three minutes. New rows that match the current filters show a toast (`N new deals — show`) instead of jumping the grid. Dismiss it and the count stays on the **N new deals — show** control until you accept them.

Private listings are not in this file. Signed-in sellers write them to Firestore. See [FIREBASE_SETUP.md](../FIREBASE_SETUP.md).

## Market value

`est_market_value` is a mileage-adjusted median of comparable listings in this file. Tiers, each needing at least three other cars:

1. Same year, make, and model.
2. Same make and model, model year within ±2.
3. Same make and model, any year.

Make-only and body-type medians are not used. The mileage slope is a least-squares fit on those comps, clamped so a few odd posts cannot swing the number. The method label is stored in `market_value_method`, and the count is stored in `market_comp_count`. Fewer than three comps produces `unrated` and no dollar estimate.

Ratings, also stored on each row so the page does not invent them:

| Rating | Rule |
|---|---|
| `bargain` | Asking price is **at least 15% under** the estimate |
| `fair` | Asking price is **within ±15%** (exactly 15% over is still fair) |
| `bad` | Asking price is **more than 15% over** the estimate |
| `unrated` | No estimate |

Thresholds live in `scraper/market.py` (`BARGAIN_BELOW_PCT`, `BAD_ABOVE_PCT`) and are copied into `rating_thresholds` in the JSON.

## Listing schema

`data/listings.json` is one object. `listings` is the array. Extra metadata (`schema_version`, `generated_at`, `origin`, `criteria`, `rating_thresholds`, `source_note`) describes the file.

Each scraped listing:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Craigslist posting id |
| `title` | string | Year, make, model, trim |
| `year` | number | Model year |
| `make`, `model`, `trim` | string | Parsed from the posting |
| `body_type` | string | Sedan, SUV, Truck, Coupe, Hatchback, or another body Craigslist named |
| `price` | number | Asking price in dollars |
| `mileage` | number | Odometer |
| `city`, `state` | string | Where the post says the car is |
| `distance_mi` | number or null | Miles from Madison 53703 |
| `source` | string | `Craigslist` |
| `url` | string | Original posting, https only |
| `image_url` | string or null | First photo on `images.craigslist.org`, or null |
| `image_urls` | array | Up to eight allowed photo URLs |
| `description` | string | Plain text, capped |
| `title_status` | string | `clean` |
| `est_market_value` | number or null | Estimated market average in dollars |
| `market_value_method` | string | Which comp tier produced the estimate |
| `market_comp_count` | number | How many other listings that tier used |
| `valuation_source` | string | `comparable_listings`, or a licensed provider name later |
| `valuation_label` | string | Sentence shown to people. Not a book value. |
| `deal_rating` | string | `bargain`, `fair`, `bad`, or `unrated` |
| `seller_type` | string | `craigslist` |
| `seller_name`, `seller_phone`, `seller_email` | string | Public contact text, often empty |
| `contact_note` | string | How to reach the seller |
| `first_seen` | string | UTC timestamp of the first scrape that kept this id |
| `last_checked` | string | UTC timestamp of the latest successful check |
| `posted_at` | string | Timestamp Craigslist printed on the post, when present |

`first_seen` is preserved across runs. A row that disappears from Craigslist is removed on the next successful scrape.

There is no featured listing. `js/app.js` keeps a slot that would render one card with `featured: true` after every sixth organic card. It returns nothing until that flag exists, so the grid has no empty ad tile.

## Layout

- Header: wordmark, Browse all / Mustang Picks / Saved, search (make, model, or city), Sell, Sign in, theme toggle, and `Live · N new today`.
- Filters: body-type chips, price presets, Under 120k mi, Min and Max price, and Make, Mileage, Distance, and Sort. Default sort is biggest savings.
- Cards: 3:2 photo, deal badge, heart, price, estimated market, source, View listing.
- A photo or card click opens the listing dialog on the same page.
- Help sits at the bottom right. The FAQ text is `FAQ.md`.
- One column under 640px, two until 1024px, three after that. Content is capped at 1280px.

Inter is self-hosted (`fonts/`, SIL Open Font License).

## Security

See [SECURITY.md](../SECURITY.md). Short version: no service-account keys in the repo, CSP via a meta tag, and a note about the headers GitHub Pages cannot set (`X-Content-Type-Options`, `X-Frame-Options`, CSP `frame-ancestors`). Those can be added later at Cloudflare or Netlify.

Please turn on, in the GitHub settings for this repository:

- Branch protection on `main`, with the Tests workflow required. Allow the GitHub Actions bot to push the scheduled listings commit, or that job will fail once protection is on.
- Dependabot alerts (the weekly Actions config is already in `.github/dependabot.yml`).
- Secret scanning and push protection.

## Project map

```
index.html              page
privacy.html            privacy page served with the site
FAQ.md                  help text
css/styles.css          both themes
js/                     page, Firebase client, vendored SDK
data/listings.json      generated listings
scraper/                standard-library scraper
tests/                  parser, market math, price filter, and page checks
docs/DEVELOPMENT.md     this file
FIREBASE_SETUP.md       Firebase project steps
.github/workflows/      tests, Pages deploy, scheduled scrape
```
