"""Estimate market value from comparable listings already in the dataset.

Nothing here is a Kelley Blue Book price. The figure is the mileage-adjusted
median of similar posts we actually collected.
"""

from __future__ import annotations

import statistics
from typing import Iterable

# Asking price at least this far under the estimate is a bargain.
# More than BAD_ABOVE_PCT over the estimate is a bad deal.
# The band in between, including exactly BAD_ABOVE_PCT over, is fair.
BARGAIN_BELOW_PCT = 0.15
BAD_ABOVE_PCT = 0.15

# Dollars of price change per extra mile. Clamped so a noisy handful of
# comps cannot invent a huge adjustment. Negative means higher miles, lower price.
MIN_SLOPE_PER_MILE = -0.12
MAX_SLOPE_PER_MILE = -0.005
DEFAULT_SLOPE_PER_MILE = -0.03

MIN_COMPS = 3


def median(values: Iterable[float]) -> float:
    return float(statistics.median(list(values)))


def mileage_slope(comps: list[dict]) -> float:
    """Least-squares slope of price on mileage, clamped to a sane band."""
    if len(comps) < 4:
        return DEFAULT_SLOPE_PER_MILE
    xs = [float(c["mileage"]) for c in comps]
    ys = [float(c["price"]) for c in comps]
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    var_x = sum((x - mean_x) ** 2 for x in xs)
    # Less than ~2,000 miles of spread: the fit is noise.
    if var_x < 4_000_000:
        return DEFAULT_SLOPE_PER_MILE
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    slope = cov / var_x
    if slope > 0:
        # More miles should not raise the estimate. Use a small default.
        return DEFAULT_SLOPE_PER_MILE
    return max(MIN_SLOPE_PER_MILE, min(MAX_SLOPE_PER_MILE, slope))


def _same_make_model(a: dict, b: dict) -> bool:
    return (
        a.get("make")
        and b.get("make")
        and a["make"].casefold() == b["make"].casefold()
        and a.get("model")
        and b.get("model")
        and a["model"].casefold() == b["model"].casefold()
    )


def _usable(row: dict) -> bool:
    return (
        isinstance(row.get("price"), int)
        and row["price"] > 0
        and isinstance(row.get("mileage"), int)
        and row["mileage"] >= 0
    )


def _adjust(listing: dict, comps: list[dict], method: str) -> tuple[int, str]:
    med_price = median(c["price"] for c in comps)
    med_miles = median(c["mileage"] for c in comps)
    slope = mileage_slope(comps)
    delta = float(listing["mileage"]) - med_miles
    estimate = med_price + slope * delta
    # Keep the adjustment from running away from the comp median.
    low = med_price * 0.65
    high = med_price * 1.35
    estimate = min(high, max(low, estimate))
    rounded = int(round(estimate))
    if rounded < 200:
        return 0, "insufficient_comps"
    return rounded, method


def estimate_market_value(listing: dict, listings: list[dict]) -> tuple[int | None, str]:
    """Return (estimate dollars, method label).

    Tiers, in order, each requiring at least three other listings:
    1. Same make and model, model year within ±2, mileage-adjusted.
    2. Same make and model, any year, mileage-adjusted.
    3. Same make and body type, mileage-adjusted.
    4. Same make, mileage-adjusted.
    """
    if not _usable(listing):
        return None, "insufficient_comps"

    others = [row for row in listings if row is not listing and row.get("id") != listing.get("id") and _usable(row)]

    def year_close(row: dict) -> bool:
        if not isinstance(listing.get("year"), int) or not isinstance(row.get("year"), int):
            return False
        return abs(row["year"] - listing["year"]) <= 2

    tiers: list[tuple[str, list[dict]]] = []
    same_mm = [row for row in others if _same_make_model(listing, row)]
    tiers.append(("median_make_model_year_pm2_mileage_adj", [row for row in same_mm if year_close(row)]))
    tiers.append(("median_make_model_mileage_adj", same_mm))
    if listing.get("body_type") and listing.get("make"):
        tiers.append(
            (
                "median_make_body_mileage_adj",
                [
                    row
                    for row in others
                    if row.get("make", "").casefold() == listing["make"].casefold()
                    and row.get("body_type") == listing.get("body_type")
                ],
            )
        )
    if listing.get("make"):
        tiers.append(
            (
                "median_make_mileage_adj",
                [row for row in others if row.get("make", "").casefold() == listing["make"].casefold()],
            )
        )

    for method, comps in tiers:
        if len(comps) >= MIN_COMPS:
            value, used = _adjust(listing, comps, method)
            if value and used != "insufficient_comps":
                return value, used
    return None, "insufficient_comps"


def rate_deal(
    price: int | None,
    estimate: int | None,
    *,
    bargain_below_pct: float = BARGAIN_BELOW_PCT,
    bad_above_pct: float = BAD_ABOVE_PCT,
) -> str:
    """bargain ≥ bargain_below_pct under; bad > bad_above_pct over; else fair.

    Missing price or estimate is unrated. Exactly `bad_above_pct` over is fair
    ("within ±15%"). Exactly `bargain_below_pct` under is a bargain.
    """
    if not isinstance(price, int) or price <= 0 or not isinstance(estimate, int) or estimate <= 0:
        return "unrated"
    # Positive when the asking price is under the estimate.
    pct_under = (estimate - price) / estimate
    if pct_under >= bargain_below_pct:
        return "bargain"
    if pct_under < -bad_above_pct:
        return "bad"
    return "fair"
