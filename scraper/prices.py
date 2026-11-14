"""Reject placeholder and bait asking prices before they reach the site.

The floor and the cap are collection limits. The page's min and max boxes
are a separate, free choice and are not applied here.
"""

from __future__ import annotations

import re

# Asking prices under this are not offers. $1, $12, $111, and $999 fall here.
MIN_ASKING = 500
# Craigslist search cap. Documented in the README. Inclusive.
MAX_ASKING = 60_000

# Odometers under this are the "1" sellers type when a number is required.
MIN_MILES = 50
# Not a market filter. Stops a garbage odometer from entering the file.
MAX_MILES_PLAUSIBLE = 1_000_000

_DISCLAIMER = (
    "call for price",
    "call for the price",
    "call for pricing",
    "price on request",
    "contact for price",
    "contact me for price",
    "email for price",
    "trade only",
    "trades only",
    "for trade only",
    "swap only",
    "not for sale",
    "price is not real",
    "price isn't real",
    "price is fake",
    "fake price",
    "placeholder price",
    "not the actual price",
    "not the real price",
    "price shown is not",
)

# "obo" / "make offer" only rejects the row when the number is also bait.
_OFFER = re.compile(
    r"\b(?:obo|or best offer|make an offer|make offer|make me an offer|best offer)\b",
    re.I,
)


def is_placeholder_price(price: int) -> bool:
    """Repeated digits, strict sequences, and short repeating blocks.

    5000, 10000, and 1999 are ordinary asking prices and return False.
    1111, 1234, 12345, and 1212 return True.
    """
    if not isinstance(price, int) or price < 0:
        return True
    if price in (1, 12):
        return True
    text = str(price)
    if len(text) < 3:
        return False
    if len(set(text)) == 1:
        return True
    diffs = [int(text[i + 1]) - int(text[i]) for i in range(len(text) - 1)]
    if all(diff == 1 for diff in diffs) or all(diff == -1 for diff in diffs):
        return True
    for size in range(2, len(text) // 2 + 1):
        if len(text) % size:
            continue
        block = text[:size]
        if block * (len(text) // size) == text:
            return True
    return False


def price_rejection(price: object, description: str = "") -> str | None:
    """Return a reason code, or None when the asking price can be kept."""
    if not isinstance(price, int):
        return "invalid"
    if price < MIN_ASKING:
        return "below_floor"
    if price > MAX_ASKING:
        return "above_cap"
    blob = description or ""
    folded = blob.casefold()
    if any(phrase in folded for phrase in _DISCLAIMER):
        return "disclaimer"
    bait = is_placeholder_price(price)
    if bait and _OFFER.search(blob):
        return "offer_with_bait"
    if bait:
        return "placeholder"
    return None
