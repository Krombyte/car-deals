"""Parse a public Craigslist listing page into a plain dict.

The HTML is untrusted. This module never executes it. Callers still run every
string and URL through scraper.sanitize before writing JSON.
"""

from __future__ import annotations

import json
import re
from typing import Any

from scraper.sanitize import clean_city, clean_http_url, clean_state, strip_html

_JSONLD = re.compile(
    r'id="ld_posting_data"\s*>\s*(\{.*?\})\s*</script>',
    re.S,
)
_ATTR = re.compile(r'<div class="attr ([a-z0-9_]+)">([\s\S]*?)</div>', re.I)
_VALU = re.compile(r'class="valu[^"]*"[^>]*>([\s\S]*?)</span>', re.I)
_YEAR = re.compile(r'class="valu year">(\d{4})')
_MAKEMODEL = re.compile(r'class="valu makemodel">([\s\S]*?)</span>', re.I)
_TITLE = re.compile(r'id="titletextonly">([^<]*)')
_PRICE_SPAN = re.compile(r'class="price">\s*\$?\s*([^<]+)')
_POSTED = re.compile(r'<time class="date timeago" datetime="([^"]+)"')
_BODY = re.compile(r'id="postingbody"[^>]*>([\s\S]*?)</section>', re.I)
_QR = re.compile(r'<div class="print-information[\s\S]*?</div>\s*</div>', re.I)
_GEO = re.compile(r'data-latitude="([+-]?\d+(?:\.\d+)?)"\s+data-longitude="([+-]?\d+(?:\.\d+)?)"')
_MONEY = re.compile(r"(\d+(?:\.\d+)?)")
_MILES_K = re.compile(r"(\d+(?:\.\d+)?)\s*k\b", re.I)
_MILES = re.compile(r"(\d+)")

EXPIRED_MARKERS = (
    "this posting has expired",
    "this posting has been deleted",
    "this posting has been flagged",
    "this posting has been removed",
    "posting has been deleted",
)

IMAGE_HOSTS = ("images.craigslist.org",)
LISTING_HOSTS = (".craigslist.org",)

# Longer names first so "land rover" wins over a shorter token.
_MAKES = (
    "alfa romeo",
    "aston martin",
    "land rover",
    "mercedes-benz",
    "mercedes benz",
    "rolls-royce",
    "american motors",
    "harley-davidson",
    "acura",
    "audi",
    "bmw",
    "buick",
    "cadillac",
    "chevrolet",
    "chevy",
    "chrysler",
    "datsun",
    "dodge",
    "ferrari",
    "fiat",
    "ford",
    "freightliner",
    "genesis",
    "gmc",
    "honda",
    "hummer",
    "hyundai",
    "infiniti",
    "international",
    "isuzu",
    "jaguar",
    "jeep",
    "kia",
    "lexus",
    "lincoln",
    "mazda",
    "mercedes",
    "mercury",
    "mini",
    "mitsubishi",
    "nissan",
    "oldsmobile",
    "plymouth",
    "pontiac",
    "porsche",
    "ram",
    "saab",
    "saturn",
    "scion",
    "smart",
    "subaru",
    "suzuki",
    "tesla",
    "toyota",
    "volkswagen",
    "volvo",
    "vw",
    "willys",
    "packard",
    "studebaker",
    "laforza",
    "geo",
    "eagle",
    "daewoo",
    "peugeot",
    "triumph",
    "austin",
    "hudson",
    "nash",
    "edsel",
    "desoto",
    "de soto",
    "kaiser",
    "am general",
)

_MAKE_CANON = {
    "chevy": "Chevrolet",
    "chevrolet": "Chevrolet",
    "vw": "Volkswagen",
    "volkswagen": "Volkswagen",
    "mercedes": "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "mercedes-benz": "Mercedes-Benz",
    "gmc": "GMC",
    "bmw": "BMW",
    "ram": "Ram",
    "mini": "MINI",
}

_MULTI_MODELS = (
    ("grand", "cherokee"),
    ("grand", "caravan"),
    ("grand", "prix"),
    ("grand", "am"),
    ("grand", "marquis"),
    ("grand", "wagoneer"),
    ("town", "country"),
    ("land", "cruiser"),
    ("range", "rover"),
    ("model", "s"),
    ("model", "3"),
    ("model", "x"),
    ("model", "y"),
    ("crown", "victoria"),
    ("pt", "cruiser"),
    ("el", "camino"),
    ("santa", "fe"),
    ("monte", "carlo"),
    ("de", "ville"),
    ("new", "yorker"),
    ("le", "baron"),
    ("park", "avenue"),
)

_BODY_MAP = {
    "sedan": "Sedan",
    "suv": "SUV",
    "coupe": "Coupe",
    "hatchback": "Hatchback",
    "truck": "Truck",
    "pickup": "Truck",
    "van": "Van",
    "mini-van": "Van",
    "minivan": "Van",
    "wagon": "Wagon",
    "convertible": "Convertible",
    "offroad": "Off-road",
    "bus": "Bus",
    "other": "Other",
}

_BODY_WORDS = (
    ("hatchback", "Hatchback"),
    ("convertible", "Convertible"),
    ("sedan", "Sedan"),
    ("coupe", "Coupe"),
    ("wagon", "Wagon"),
    ("minivan", "Van"),
    ("van", "Van"),
    ("suv", "SUV"),
    ("pickup", "Truck"),
    ("truck", "Truck"),
)


def parse_price(value: Any) -> int | None:
    if value is None:
        return None
    match = _MONEY.search(str(value).replace(",", "").replace("$", ""))
    if not match:
        return None
    amount = int(round(float(match.group(1))))
    if amount < 0 or amount > 10_000_000:
        return None
    return amount


def parse_miles(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip().lower().replace(",", "")
    if not text:
        return None
    k = _MILES_K.search(text)
    if k:
        miles = int(round(float(k.group(1)) * 1000))
    else:
        match = _MILES.search(text)
        if not match:
            return None
        miles = int(match.group(1))
    if miles < 0 or miles > 2_000_000:
        return None
    return miles


def _canon_make(name: str) -> str:
    key = name.casefold()
    if key in _MAKE_CANON:
        return _MAKE_CANON[key]
    return " ".join(part.capitalize() for part in name.split())


# Whole-string names Craigslist sometimes files without a separate make.
_BARE = {
    "cimarron": ("Cadillac", "Cimarron", ""),
    "laforza": ("Laforza", "", ""),
}


def split_make_model(makemodel: str) -> tuple[str, str, str]:
    """Return (make, model, trim) from a Craigslist 'make model trim' string."""
    text = strip_html(makemodel)
    text = re.sub(r"\s+", " ", text).strip(" -")
    if not text:
        return "", "", ""
    lowered = text.casefold()
    if lowered in _BARE:
        return _BARE[lowered]
    if lowered == "mgb" or lowered.startswith("mgb "):
        return "MG", "MGB", text[3:].strip(" -")
    found = ""
    for make in _MAKES:
        if lowered == make or lowered.startswith(make + " "):
            found = make
            break
    if not found:
        return "", "", ""
    make = _canon_make(found)
    rest = text[len(found) :].strip()
    model, trim = _split_model_trim(rest)
    return make, model, trim


def _split_model_trim(rest: str) -> tuple[str, str]:
    if not rest:
        return "", ""
    words = rest.split()
    if words[0].casefold() == "model" and len(words) > 1:
        return _tidy_model(" ".join(words[:2])), " ".join(words[2:])
    lowered = [w.casefold().replace("&", "") for w in words]
    # "town & country" collapses the ampersand into its own token.
    if lowered[:3] == ["town", "", "country"] or (
        len(words) >= 3 and words[0].casefold() == "town" and words[1] in ("&", "and") and words[2].casefold() == "country"
    ):
        return "Town & Country", " ".join(words[3:])
    for phrase in _MULTI_MODELS:
        if tuple(lowered[: len(phrase)]) == phrase:
            model = " ".join(words[: len(phrase)])
            trim = " ".join(words[len(phrase) :])
            return _tidy_model(model), trim
    model_words = [words[0]]
    rest_words = words[1:]
    if rest_words and re.fullmatch(r"\d{2,4}[A-Za-z]?", rest_words[0]):
        model_words.append(rest_words[0])
        rest_words = rest_words[1:]
    return _tidy_model(" ".join(model_words)), " ".join(rest_words)


def _tidy_model(model: str) -> str:
    if re.fullmatch(r"[A-Za-z]+-\d{2,3}", model):
        return model.upper()
    # Keep tokens like CR-V, CX-5, F-150, MX-5.
    parts = []
    for part in model.split():
        if re.search(r"\d", part) and len(part) <= 6:
            parts.append(part.upper())
        elif part.isupper() and len(part) <= 4:
            parts.append(part)
        else:
            parts.append(part[:1].upper() + part[1:])
    return " ".join(parts)


def infer_body(*chunks: str) -> str:
    blob = " ".join(chunks).casefold()
    for word, label in _BODY_WORDS:
        if re.search(rf"\b{re.escape(word)}\b", blob):
            return label
    return ""


def map_body(raw: str) -> str:
    key = (raw or "").strip().casefold()
    return _BODY_MAP.get(key, "")


def posting_id(url: str) -> str:
    path = url.split("?", 1)[0].rstrip("/")
    token = path.rsplit("/", 1)[-1]
    token = re.sub(r"[^A-Za-z0-9_-]", "", token)
    return token[:80]


def is_expired(html: str, status: int) -> bool:
    if status in (404, 410):
        return True
    head = html[:8000].casefold()
    return any(marker in head or marker in html.casefold() for marker in EXPIRED_MARKERS)


def is_blocked(html: str, status: int) -> bool:
    if status in (401, 403, 429, 503):
        return True
    low = html[:4000].casefold()
    return "this request has been blocked" in low or "has detected unusual activity" in low


def _attrs(html: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for match in _ATTR.finditer(html):
        key = match.group(1)
        if key == "important":
            continue
        chunk = match.group(2)
        valu = _VALU.search(chunk)
        found[key] = strip_html(valu.group(1) if valu else chunk)
    return found


def _jsonld(html: str) -> dict[str, Any]:
    match = _JSONLD.search(html)
    if not match:
        return {}
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def parse_listing_html(html: str, url: str, *, status: int = 200) -> dict[str, Any] | None:
    """Return a partially trusted dict, or None if the page is expired or useless.

    URLs are restricted to http(s). VIN is intentionally not returned.
    """
    if is_expired(html, status) or is_blocked(html, status):
        return None
    data = _jsonld(html)
    attrs = _attrs(html)
    title = strip_html(_TITLE.search(html).group(1) if _TITLE.search(html) else data.get("name") or "")
    if title.casefold().startswith("wanted"):
        return None

    year_match = _YEAR.search(html)
    year = int(year_match.group(1)) if year_match else None
    if year is None:
        title_year = re.search(r"\b(19[5-9]\d|20[0-2]\d)\b", title)
        year = int(title_year.group(1)) if title_year else None

    mm = _MAKEMODEL.search(html)
    makemodel = strip_html(mm.group(1) if mm else "")
    make, model, trim = split_make_model(makemodel or title)
    if not make:
        # Title often leads with the year.
        make, model, trim = split_make_model(re.sub(r"^\d{4}\s+", "", title))

    offers = data.get("offers") if isinstance(data.get("offers"), dict) else {}
    price = parse_price(offers.get("price"))
    if price is None:
        span = _PRICE_SPAN.search(html)
        price = parse_price(span.group(1) if span else None)

    mileage = parse_miles(attrs.get("auto_miles"))
    title_status = (attrs.get("auto_title_status") or "").casefold()
    body = map_body(attrs.get("auto_bodytype") or "") or infer_body(title, trim, makemodel)

    place = offers.get("availableAtOrFrom") if isinstance(offers.get("availableAtOrFrom"), dict) else {}
    address = place.get("address") if isinstance(place.get("address"), dict) else {}
    geo = place.get("geo") if isinstance(place.get("geo"), dict) else {}
    lat = _float(geo.get("latitude"))
    lon = _float(geo.get("longitude"))
    if lat is None or lon is None:
        geo_attr = _GEO.search(html)
        if geo_attr:
            lat = _float(geo_attr.group(1))
            lon = _float(geo_attr.group(2))

    image_urls = listing_images(data.get("image"))
    image_url = image_urls[0] if image_urls else None
    body_html = ""
    body_match = _BODY.search(html)
    if body_match:
        body_html = _QR.sub("", body_match.group(1), count=1)
    posted = _POSTED.search(html)

    clean_url = clean_http_url(url, allowed_hosts=LISTING_HOSTS)
    if not clean_url:
        return None

    return {
        "id": posting_id(clean_url),
        "url": clean_url,
        "title_raw": title,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "body_type": body,
        "price": price,
        "mileage": mileage,
        "city": clean_city(str(address.get("addressLocality") or "")),
        "state": clean_state(str(address.get("addressRegion") or "")),
        "lat": lat,
        "lon": lon,
        "title_status": title_status,
        "image_url": image_url,
        "image_urls": image_urls,
        "description": strip_html(body_html),
        "posted_at": posted.group(1) if posted else "",
    }


def _float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


_PHONE = re.compile(
    r"(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}(?!\d)"
)
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")


def public_contact(text: str) -> tuple[str, str]:
    """Phone and email written in the public posting body. Empty when absent."""
    phone = ""
    email = ""
    phone_match = _PHONE.search(text or "")
    if phone_match:
        phone = phone_match.group(0)[:40]
    email_match = _EMAIL.search(text or "")
    if email_match:
        email = email_match.group(0)[:80]
    return phone, email


def listing_images(image: Any, *, limit: int = 8) -> list[str]:
    """HTTPS Craigslist image URLs. The 600x450 size is preferred."""
    candidates: list[str] = []
    if isinstance(image, str):
        candidates = [image]
    elif isinstance(image, list):
        candidates = [item for item in image if isinstance(item, str)]
    preferred: list[str] = []
    other: list[str] = []
    for candidate in candidates:
        cleaned = clean_http_url(candidate, allowed_hosts=IMAGE_HOSTS)
        if not cleaned:
            continue
        if "600x450" in cleaned:
            preferred.append(cleaned)
        else:
            other.append(cleaned)
    seen: set[str] = set()
    out: list[str] = []
    for url in preferred + other:
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= limit:
            break
    return out


def _first_image(image: Any) -> str | None:
    images = listing_images(image, limit=1)
    return images[0] if images else None
