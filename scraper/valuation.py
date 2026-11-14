"""Market-value providers.

The default provider is the mileage-adjusted median in scraper.market.
A licensed book (Kelley Blue Book, Black Book, or MarketCheck) can be
selected later with GitHub Actions secrets. This module does not call
those services and does not scrape them.
"""

from __future__ import annotations

import os

ALLOWED_LICENSED = ("marketcheck", "blackbook", "kbb")

_METHOD_TEXT = {
    "median_year_make_model_mileage_adj": "same year, make, and model",
    "median_nearby_year_make_model_mileage_adj": "same make and model, nearby years (±2)",
    "median_make_model_mileage_adj": "same make and model, any year",
}


def valuation_label(source: str, method: str, count: int, estimate: int | None) -> str:
    """Plain sentence stored on the listing. Not a Kelley Blue Book value."""
    if not estimate:
        return "No comparable estimate. This is not a Kelley Blue Book value."
    if source and source != "comparable_listings":
        return (
            f"Licensed estimate from {source}, mileage-adjusted. "
            "Not computed from the listings on this page."
        )
    how = _METHOD_TEXT.get(method, "similar listings")
    noun = "comparable listing" if count == 1 else "comparable listings"
    return (
        f"Estimate from {count} {noun} ({how}), adjusted for mileage. "
        "Not a Kelley Blue Book value."
    )


class LicensedValuationProvider:
    """Slot for a paid valuation API. The key stays in the environment.

    VALUATION_PROVIDER: marketcheck, blackbook, or kbb
    VALUATION_API_KEY: the provider key (GitHub Actions secret)

    Kelley Blue Book has no public API and forbids scraping. Nothing here
    fetches a book site. _call_official_api is the function to replace
    when a real adapter is added. Until then it returns None and the
    comparable-listing estimate is used.
    """

    def __init__(self, provider: str | None = None, api_key: str | None = None):
        raw_provider = provider if provider is not None else os.environ.get("VALUATION_PROVIDER", "")
        raw_key = api_key if api_key is not None else os.environ.get("VALUATION_API_KEY", "")
        self.provider = (raw_provider or "").strip().lower()
        self.api_key = (raw_key or "").strip()

    def enabled(self) -> bool:
        return self.provider in ALLOWED_LICENSED and bool(self.api_key)

    def estimate(self, listing: dict) -> tuple[int | None, str, int] | None:
        if not self.enabled():
            return None
        return self._call_official_api(listing)

    def _call_official_api(self, listing: dict) -> tuple[int | None, str, int] | None:
        del listing
        return None
