"""Collect public Craigslist cars near Madison and write data/listings.json.

Respects robots.txt (search and listing pages are allowed; reply, flag, and
mail endpoints are not requested). One polite request at a time, a normal
descriptive user agent, and no attempt to dodge a block.

Usage:
    python3 -m scraper
    python3 -m scraper --delay 1.6 --output data/listings.json
"""

from __future__ import annotations

import argparse
import gzip
import http.cookiejar
import json
import math
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from scraper import __version__
from scraper.market import (
    BAD_ABOVE_PCT,
    BARGAIN_BELOW_PCT,
    estimate_market_value,
    rate_deal,
)
from scraper.parse import (
    LISTING_HOSTS,
    is_blocked,
    is_expired,
    listing_images,
    parse_listing_html,
    posting_id,
    public_contact,
)
from scraper.prices import MAX_ASKING, MAX_MILES_PLAUSIBLE, MIN_ASKING, MIN_MILES, price_rejection
from scraper.sanitize import cap_text, clean_http_url, redact_sensitive, strip_html
from scraper.valuation import LicensedValuationProvider, valuation_label

USER_AGENT = (
    f"CarDealsBot/{__version__} "
    "(+https://github.com/Krombyte/car-deals; personal used-car watch "
    "for Madison, WI; public pages only, low rate)"
)

# Postal 53703, the centroid Craigslist itself returns for that ZIP.
ORIGIN = {"city": "Madison", "state": "WI", "postal": "53703", "lat": 43.0775, "lon": -89.3831}

# Collection window. The page does not hard-code these into the filter boxes.
MAX_PRICE = MAX_ASKING
MIN_PRICE = MIN_ASKING
# No market mileage cap. Under 120,000 miles stays a chip on the page.
# Values under MIN_MILES or over MAX_MILES_PLAUSIBLE are dropped as junk data.
MAX_MILES_CAP = None
MAX_DISTANCE_MI = 300
MIN_YEAR = 1920
MAX_YEAR = datetime.now(timezone.utc).year + 1

REGIONS = (
    "madison",
    "milwaukee",
    "chicago",
    "rockford",
    "dubuque",
    "appleton",
    "greenbay",
    "lacrosse",
    "eauclaire",
    "minneapolis",
    "quadcities",
)

FILTERS = f"cat=cta&min_price={MIN_PRICE}&max_price={MAX_PRICE}&auto_title_status=1"

LISTING_KEYS = (
    "id",
    "title",
    "year",
    "make",
    "model",
    "trim",
    "body_type",
    "price",
    "mileage",
    "city",
    "state",
    "distance_mi",
    "source",
    "url",
    "image_url",
    "image_urls",
    "description",
    "title_status",
    "est_market_value",
    "market_value_method",
    "market_comp_count",
    "valuation_source",
    "valuation_label",
    "deal_rating",
    "seller_type",
    "seller_name",
    "seller_phone",
    "seller_email",
    "contact_note",
    "first_seen",
    "last_checked",
    "posted_at",
)

CONTACT_NOTE = (
    "Craigslist does not publish the seller's account name. "
    "Contact is through the listing."
)


class FetchError(Exception):
    def __init__(self, message: str, *, blocked: bool = False, status: int = 0):
        super().__init__(message)
        self.blocked = blocked
        self.status = status


class CraigslistRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = (urlsplit(newurl).hostname or "").lower()
        if not host.endswith("craigslist.org"):
            raise FetchError(f"refusing redirect off craigslist: {host}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def build_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), CraigslistRedirect)


def fetch(opener: urllib.request.OpenerDirector, url: str, *, timeout: float = 40) -> tuple[int, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            status = getattr(response, "status", 200) or 200
            raw = response.read()
            encoding = response.headers.get("Content-Encoding", "")
            if "gzip" in encoding:
                raw = gzip.decompress(raw)
            charset = response.headers.get_content_charset() or "utf-8"
            return status, raw.decode(charset, errors="replace")
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        if exc.code in (401, 403, 429, 503) or is_blocked(body, exc.code):
            raise FetchError(f"blocked ({exc.code}) {url}", blocked=True, status=exc.code) from exc
        if exc.code in (404, 410):
            return exc.code, body
        raise FetchError(f"http {exc.code} for {url}", status=exc.code) from exc
    except urllib.error.URLError as exc:
        raise FetchError(f"network error for {url}: {exc.reason}") from exc


def search_plan() -> list[tuple[str, str]]:
    radius = (
        "https://www.craigslist.org/search/city/madison-wi"
        f"?{FILTERS}&postal={ORIGIN['postal']}&radius={MAX_DISTANCE_MI}"
    )
    plan = [
        ("madison-radius", radius),
        ("madison-radius-mustang", radius + "&query=mustang"),
    ]
    for area in REGIONS:
        area_url = f"https://www.craigslist.org/search/area/{area}?{FILTERS}"
        plan.append((area, area_url))
        plan.append((f"{area}-mustang", area_url + "&query=mustang"))
    return plan


_RESULT = re.compile(
    r'<li class="cl-static-search-result"[^>]*title="([^"]*)">([\s\S]*?)</li>',
    re.I,
)
_HREF = re.compile(r'<a href="([^"]+)"', re.I)
_JSONLD_RESULTS = re.compile(r'id="ld_searchpage_results"\s*>\s*(\{.*?\})\s*</script>', re.S)


def parse_search(html: str) -> list[dict]:
    """Pair static result links with JSON-LD geo/image hints, by order."""
    links = []
    for match in _RESULT.finditer(html):
        href = _HREF.search(match.group(2))
        if not href:
            continue
        url = clean_http_url(html_unescape(href.group(1)), allowed_hosts=LISTING_HOSTS)
        if not url:
            continue
        links.append({"title": html_unescape(match.group(1)), "url": url, "id": posting_id(url)})
    geos = _search_geos(html)
    # Match on the posting title and consume duplicates in order. When a title
    # is missing from the JSON-LD block, the listing page is still fetched and
    # its own map pin is used. "name" is not copied onto the candidate.
    buckets: dict[str, list[dict]] = {}
    for geo in geos:
        buckets.setdefault(geo.get("name") or "", []).append(geo)
    for link in links:
        bucket = buckets.get(link["title"])
        if not bucket:
            continue
        geo = bucket.pop(0)
        link["lat"] = geo.get("lat")
        link["lon"] = geo.get("lon")
        link["city_hint"] = geo.get("city_hint") or ""
        link["state_hint"] = geo.get("state_hint") or ""
        link["image_hint"] = geo.get("image_hint")
    return links


def html_unescape(value: str) -> str:
    import html as html_lib

    return html_lib.unescape(value)


def _search_geos(html: str) -> list[dict]:
    match = _JSONLD_RESULTS.search(html)
    if not match:
        return []
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    rows = []
    for item in data.get("itemListElement") or []:
        product = item.get("item") if isinstance(item, dict) else None
        if not isinstance(product, dict):
            rows.append({})
            continue
        offers = product.get("offers") if isinstance(product.get("offers"), dict) else {}
        place = offers.get("availableAtOrFrom") if isinstance(offers.get("availableAtOrFrom"), dict) else {}
        geo = place.get("geo") if isinstance(place.get("geo"), dict) else {}
        address = place.get("address") if isinstance(place.get("address"), dict) else {}
        image = product.get("image")
        image_url = None
        if isinstance(image, list) and image:
            image_url = image[0] if isinstance(image[0], str) else None
        elif isinstance(image, str):
            image_url = image
        try:
            lat = float(geo.get("latitude"))
            lon = float(geo.get("longitude"))
        except (TypeError, ValueError):
            lat = lon = None
        rows.append(
            {
                "name": str(product.get("name") or ""),
                "lat": lat,
                "lon": lon,
                "city_hint": str(address.get("addressLocality") or ""),
                "state_hint": str(address.get("addressRegion") or ""),
                "image_hint": image_url,
                "price_hint": offers.get("price"),
            }
        )
    return rows


def haversine_mi(lat: float, lon: float, *, origin: dict = ORIGIN) -> float:
    radius = 3958.7613
    phi1 = math.radians(origin["lat"])
    phi2 = math.radians(lat)
    dphi = math.radians(lat - origin["lat"])
    dlmb = math.radians(lon - origin["lon"])
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def within_radius(lat: float | None, lon: float | None) -> bool | None:
    """True / False, or None when the page did not give a point."""
    if lat is None or lon is None:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return haversine_mi(lat, lon) <= MAX_DISTANCE_MI + 15


def _is_not_a_car_for_sale(blob: str, price: int) -> bool:
    """Financing spam, lease takeovers, and accessory posts are not car prices."""
    bait = (
        "bad credit",
        "drives home today",
        "lease takeover",
        "get approved",
        "everybody with",
    )
    if any(phrase in blob for phrase in bait):
        return True
    if "still in box" in blob:
        return True
    if price < 1500 and ("bed topper" in blob or "toolbox" in blob and "built for" in blob):
        return True
    return False


def load_previous(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rows = data.get("listings") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return {}
    return {row.get("id"): row for row in rows if isinstance(row, dict) and row.get("id")}


def build_record(parsed: dict, *, now: str, previous: dict | None) -> dict | None:
    """Apply the deal criteria and sanitize. Return None to drop the listing."""
    url = clean_http_url(parsed.get("url") or "", allowed_hosts=LISTING_HOSTS)
    if not url or not parsed.get("id"):
        return None
    year = parsed.get("year")
    if not isinstance(year, int) or not (MIN_YEAR <= year <= MAX_YEAR):
        return None
    make = cap_text(strip_html(parsed.get("make") or ""), 40)
    model = cap_text(strip_html(parsed.get("model") or ""), 40)
    trim = cap_text(strip_html(parsed.get("trim") or ""), 80)
    if not make:
        return None
    price = parsed.get("price")
    mileage = parsed.get("mileage")
    description_text = redact_sensitive(strip_html(parsed.get("description") or ""))
    if price_rejection(price, f"{parsed.get('title_raw') or ''}\n{description_text}"):
        return None
    blob = f"{parsed.get('title_raw') or ''}\n{description_text}".casefold()
    if _is_not_a_car_for_sale(blob, price if isinstance(price, int) else 0):
        return None
    if not isinstance(mileage, int) or not (0 <= mileage <= MAX_MILES_PLAUSIBLE):
        return None
    # Sellers type 1 when Craigslist requires an odometer. That is not a mileage.
    if mileage < MIN_MILES:
        return None
    if (parsed.get("title_status") or "").casefold() != "clean":
        return None
    near = within_radius(parsed.get("lat"), parsed.get("lon"))
    if near is False:
        return None
    distance = None
    if parsed.get("lat") is not None and parsed.get("lon") is not None and near is not None:
        distance = int(round(haversine_mi(parsed["lat"], parsed["lon"])))
        if distance > MAX_DISTANCE_MI:
            return None

    body = cap_text(parsed.get("body_type") or "", 24) or "Other"
    city = cap_text(parsed.get("city") or "", 48)
    state = (parsed.get("state") or "")[:2].upper()
    title_parts = [str(year), make]
    if model and model.casefold() != make.casefold():
        title_parts.append(model)
    if trim:
        title_parts.append(trim)
    elif body and body not in ("Other",):
        title_parts.append(body)
    title = cap_text(" ".join(part for part in title_parts if part), 140)
    description = cap_text(description_text, 4000)
    images = listing_images(parsed.get("image_urls") or parsed.get("image_url"))
    image = images[0] if images else None
    phone, email = public_contact(description)
    posted = cap_text(parsed.get("posted_at") or "", 40)
    first_seen = now
    if previous and isinstance(previous.get("first_seen"), str) and previous["first_seen"]:
        first_seen = previous["first_seen"]

    return {
        "id": cap_text(str(parsed["id"]), 80),
        "title": title,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "body_type": body,
        "price": price,
        "mileage": mileage,
        "city": city,
        "state": state,
        "distance_mi": distance,
        "source": "Craigslist",
        "url": url,
        "image_url": image,
        "image_urls": images,
        "description": description,
        "title_status": "clean",
        "est_market_value": None,
        "market_value_method": "insufficient_comps",
        "market_comp_count": 0,
        "valuation_source": "comparable_listings",
        "valuation_label": valuation_label("comparable_listings", "insufficient_comps", 0, None),
        "deal_rating": "unrated",
        "seller_type": "craigslist",
        "seller_name": "",
        "seller_phone": phone,
        "seller_email": email,
        "contact_note": CONTACT_NOTE,
        "first_seen": first_seen,
        "last_checked": now,
        "posted_at": posted,
    }


def dedupe(records: list[dict]) -> list[dict]:
    """Drop cross-posts. Prefer the listing closer to Madison."""
    records = sorted(records, key=lambda row: (row.get("distance_mi") is None, row.get("distance_mi") or 0, row["id"]))
    kept: list[dict] = []
    seen_ids: set[str] = set()
    seen_fp: set[tuple] = set()
    for row in records:
        if row["id"] in seen_ids:
            continue
        fingerprint = (
            row["year"],
            row["make"].casefold(),
            row["model"].casefold(),
            row["price"],
            row["mileage"],
            (row.get("city") or "").casefold(),
            (row.get("title") or "").casefold(),
        )
        loose = (
            row["year"],
            row["make"].casefold(),
            row["model"].casefold(),
            row["price"],
            row["mileage"],
            (row.get("description") or "")[:80].casefold(),
        )
        # Same words, price, and miles in the same city: a cross-post.
        # Same description opening plus price and miles: cross-posted to another city.
        if fingerprint in seen_fp or (row.get("description") and len(row["description"]) >= 40 and loose in seen_fp):
            continue
        seen_ids.add(row["id"])
        seen_fp.add(fingerprint)
        if row.get("description") and len(row["description"]) >= 40:
            seen_fp.add(loose)
        kept.append(row)
    return kept


_LICENSED_WARNED = False


def apply_market(records: list[dict]) -> None:
    global _LICENSED_WARNED
    provider = LicensedValuationProvider()
    if provider.enabled() and not _LICENSED_WARNED:
        _LICENSED_WARNED = True
        print(
            f"[valuation] {provider.provider} is selected, but no licensed adapter "
            "is implemented yet; using comparable listings",
            file=sys.stderr,
        )
    for row in records:
        licensed = provider.estimate(row)
        if licensed and licensed[0]:
            estimate, method, count = licensed
            source = provider.provider
        else:
            estimate, method, count = estimate_market_value(row, records)
            source = "comparable_listings"
        row["est_market_value"] = estimate
        row["market_value_method"] = method
        row["market_comp_count"] = count
        row["valuation_source"] = source
        row["valuation_label"] = valuation_label(source, method, count, estimate)
        row["deal_rating"] = rate_deal(row["price"], estimate)


def document(records: list[dict], *, now: str) -> dict:
    ordered = [{key: row.get(key) for key in LISTING_KEYS} for row in sorted(records, key=lambda r: r["id"])]
    return {
        "schema_version": 2,
        "generated_at": now,
        "source_note": (
            "Listings were read from public Craigslist search and posting pages. "
            "est_market_value is a mileage-adjusted median of the same year, make, "
            "and model in this file (nearby years, then any year of that make and "
            "model, when the exact year does not have enough cars). It is not a "
            "Kelley Blue Book value. A licensed provider can replace it when "
            "VALUATION_PROVIDER and VALUATION_API_KEY are set and an adapter is added."
        ),
        "origin": ORIGIN,
        "criteria": {
            "min_price": MIN_PRICE,
            "max_price": MAX_PRICE,
            "min_mileage": MIN_MILES,
            "max_mileage": MAX_MILES_CAP,
            "max_mileage_plausible": MAX_MILES_PLAUSIBLE,
            "mileage_note": (
                "No market mileage cap. Under 120,000 miles is a filter on the page. "
                "Odometers under 50 or over 1,000,000 are dropped as placeholders or implausible."
            ),
            "title_status": "clean",
            "radius_mi": MAX_DISTANCE_MI,
            "category": "cars+trucks",
            "price_note": (
                "Asking prices from $500 through $60,000. Placeholder and bait prices "
                "are dropped. The page's min and max boxes are not limited to this window."
            ),
        },
        "rating_thresholds": {
            "bargain_at_or_below_pct": BARGAIN_BELOW_PCT,
            "bad_above_pct": BAD_ABOVE_PCT,
        },
        "listing_count": len(ordered),
        "listings": ordered,
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _sleep(delay: float) -> None:
    # Jitter so the cadence is polite rather than metronomic.
    time.sleep(delay + random.uniform(0, delay * 0.35))


def collect(args: argparse.Namespace) -> int:
    opener = build_opener()
    output = Path(args.output)
    previous = load_previous(output)
    cache = Path(args.cache) if args.cache else None
    if cache:
        cache.mkdir(parents=True, exist_ok=True)

    candidates: dict[str, dict] = {}
    for name, url in search_plan():
        print(f"[search] {name}", flush=True)
        try:
            status, html = fetch(opener, url)
        except FetchError as exc:
            print(f"[search] failed {name}: {exc}", file=sys.stderr, flush=True)
            if exc.blocked:
                print("[search] stopping; Craigslist asked us to back off", file=sys.stderr)
                return 2
            continue
        if is_blocked(html, status):
            print(f"[search] blocked on {name}", file=sys.stderr)
            return 2
        found = parse_search(html)
        added = 0
        for row in found:
            if row["id"] in candidates:
                continue
            near = within_radius(row.get("lat"), row.get("lon"))
            if near is False:
                continue
            candidates[row["id"]] = row
            added += 1
        print(f"[search] {name} links={len(found)} kept_new={added} total={len(candidates)}", flush=True)
        _sleep(max(args.delay, 1.5))

    ids = list(candidates)
    if args.limit:
        ids = ids[: args.limit]
    print(f"[listings] fetching {len(ids)} posting pages", flush=True)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    records: list[dict] = []
    errors = 0
    blocked_streak = 0
    dropped = 0
    for index, listing_id in enumerate(ids, start=1):
        candidate = candidates[listing_id]
        cached = cache / f"{listing_id}.html" if cache else None
        status = 200
        html = ""
        if cached and cached.exists() and cached.stat().st_size > 500:
            html = cached.read_text(encoding="utf-8", errors="replace")
        else:
            try:
                status, html = fetch(opener, candidate["url"])
                blocked_streak = 0
            except FetchError as exc:
                errors += 1
                print(f"[listing] {index}/{len(ids)} error {exc}", file=sys.stderr, flush=True)
                if exc.blocked:
                    blocked_streak += 1
                    time.sleep(min(60, 8 * blocked_streak))
                    if blocked_streak >= 6:
                        print("[listing] too many blocks; not writing a partial file", file=sys.stderr)
                        return 2
                else:
                    blocked_streak = 0
                _sleep(args.delay)
                continue
            if cache and status == 200 and html and not is_blocked(html, status):
                cached.write_text(html, encoding="utf-8")
            _sleep(args.delay)
        if is_blocked(html, status):
            errors += 1
            blocked_streak += 1
            if blocked_streak >= 6:
                print("[listing] too many blocks; not writing a partial file", file=sys.stderr)
                return 2
            continue
        if is_expired(html, status):
            dropped += 1
            continue
        parsed = parse_listing_html(html, candidate["url"], status=status)
        if not parsed:
            dropped += 1
            continue
        # Fill gaps from the search card, still sanitized later.
        if not parsed.get("city"):
            parsed["city"] = candidate.get("city_hint") or ""
        if not parsed.get("state"):
            parsed["state"] = candidate.get("state_hint") or ""
        if parsed.get("lat") is None:
            parsed["lat"] = candidate.get("lat")
            parsed["lon"] = candidate.get("lon")
        if not parsed.get("image_url"):
            parsed["image_url"] = candidate.get("image_hint")
        record = build_record(parsed, now=now, previous=previous.get(parsed["id"]))
        if not record:
            dropped += 1
            continue
        records.append(record)
        if index % 25 == 0 or index == len(ids):
            print(
                f"[listing] {index}/{len(ids)} kept={len(records)} dropped={dropped} errors={errors}",
                flush=True,
            )

    attempted = len(ids)
    if attempted == 0:
        print("[done] no candidates; not replacing listings.json", file=sys.stderr)
        return 1
    # A partial outage should not wipe a good file.
    if errors > max(8, int(attempted * 0.25)):
        print(f"[done] error rate too high ({errors}/{attempted}); not writing", file=sys.stderr)
        return 1

    records = dedupe(records)
    apply_market(records)
    payload = document(records, now=now)
    write_json(output, payload)
    ratings: dict[str, int] = {}
    for row in records:
        ratings[row["deal_rating"]] = ratings.get(row["deal_rating"], 0) + 1
    print(
        f"[done] wrote {len(records)} listings to {output} "
        f"(dropped {dropped}, errors {errors}) ratings={ratings}",
        flush=True,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Update data/listings.json from public Craigslist pages.")
    parser.add_argument("--output", default="data/listings.json")
    parser.add_argument("--delay", type=float, default=1.25, help="Seconds between listing fetches, plus jitter.")
    parser.add_argument("--limit", type=int, default=0, help="Fetch at most this many posting pages (0 = all).")
    parser.add_argument("--cache", default=os.environ.get("SCRAPE_CACHE", ""), help="Optional HTML cache directory.")
    args = parser.parse_args(argv)
    if args.delay < 0.8:
        print("--delay below 0.8s is not allowed", file=sys.stderr)
        return 2
    return collect(args)


if __name__ == "__main__":
    raise SystemExit(main())
