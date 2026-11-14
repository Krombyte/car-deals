"""Unit tests for sanitizing, deal math, and listing parsing. No network."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from scraper.market import estimate_market_value, rate_deal
from scraper.parse import parse_listing_html, split_make_model
from scraper.sanitize import cap_text, clean_http_url, redact_sensitive, strip_html
from scraper.__main__ import build_record, dedupe, parse_search

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "listing_min.html"


class SanitizeTests(unittest.TestCase):
    def test_strips_tags_and_scripts(self):
        raw = "Hello<br>there <script>alert(1)</script><b>friend</b>"
        self.assertEqual(strip_html(raw), "Hello\nthere alert(1) friend")

    def test_rejects_dangerous_urls(self):
        self.assertIsNone(clean_http_url("javascript:alert(1)"))
        self.assertIsNone(clean_http_url("data:text/html,hi"))
        self.assertIsNone(clean_http_url("https://user:pass@images.craigslist.org/a.jpg"))
        self.assertIsNone(clean_http_url("//images.craigslist.org/a.jpg"))
        self.assertIsNone(clean_http_url("https://evil.example/a.jpg", allowed_hosts=("images.craigslist.org",)))

    def test_allows_listing_and_image_hosts(self):
        image = clean_http_url(
            "https://images.craigslist.org/00h0h_example_600x450.jpg",
            allowed_hosts=("images.craigslist.org",),
        )
        self.assertTrue(image.startswith("https://images.craigslist.org/"))
        listing = clean_http_url(
            "https://www.craigslist.org/view/d/janesville-car/abc123",
            allowed_hosts=(".craigslist.org",),
        )
        self.assertIn("craigslist.org", listing)

    def test_redacts_vin(self):
        text = redact_sensitive("VIN# 3FA6P0HD3LR132371 and a QR Code Link to This Post")
        self.assertNotIn("3FA6P0HD3LR132371", text)
        self.assertNotIn("QR Code", text)

    def test_caps_length(self):
        self.assertLessEqual(len(cap_text("a " * 100, 20)), 20)
        self.assertGreater(len(cap_text("a " * 100, 20)), 0)


class ParseTests(unittest.TestCase):
    def test_fixture_listing(self):
        html = FIXTURE.read_text(encoding="utf-8")
        parsed = parse_listing_html(
            html,
            "https://www.craigslist.org/view/d/janesville-2013-chevy-malibu/abc123xyz",
        )
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["year"], 2013)
        self.assertEqual(parsed["make"], "Chevrolet")
        self.assertEqual(parsed["model"], "Malibu")
        self.assertEqual(parsed["price"], 1100)
        self.assertEqual(parsed["mileage"], 115000)
        self.assertEqual(parsed["title_status"], "clean")
        self.assertEqual(parsed["body_type"], "Sedan")
        self.assertEqual(parsed["city"], "Janesville")
        self.assertEqual(parsed["state"], "WI")
        self.assertNotIn("SHOULD_NOT_LEAK", json.dumps(parsed))
        self.assertNotIn("<script>", parsed["description"])
        self.assertTrue(parsed["image_url"].startswith("https://images.craigslist.org/"))
        self.assertNotIn("javascript", parsed["image_url"])

    def test_split_mustang(self):
        make, model, trim = split_make_model("Ford Mustang V6 Convertible")
        self.assertEqual((make, model), ("Ford", "Mustang"))
        self.assertIn("V6", trim)

    def test_split_odd_marque_names(self):
        self.assertEqual(split_make_model("mgb roadster")[:2], ("MG", "MGB"))
        self.assertEqual(split_make_model("Packard model 120")[:2], ("Packard", "Model 120"))
        self.assertEqual(split_make_model("Cimarron")[:2], ("Cadillac", "Cimarron"))
        self.assertEqual(split_make_model("Studebaker Hawk")[:2], ("Studebaker", "Hawk"))

    def test_expired_page_is_dropped(self):
        html = "<html><title>expired</title><body>This posting has expired.</body></html>"
        self.assertIsNone(
            parse_listing_html(html, "https://www.craigslist.org/view/d/x/abc")
        )

    def test_search_card_rejects_bad_href(self):
        html = """
        <li class="cl-static-search-result" title="ok">
          <a href="javascript:alert(1)"><div class="title">ok</div></a>
        </li>
        <li class="cl-static-search-result" title="Real &amp; car">
          <a href="https://www.craigslist.org/view/d/madison-real/goodId1">
            <div class="title">Real</div>
          </a>
        </li>
        """
        rows = parse_search(html)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "goodId1")
        self.assertIn("&", rows[0]["title"])


class MarketTests(unittest.TestCase):
    def _row(self, id_, year, price, miles, make="Ford", model="Focus", body="Sedan"):
        return {
            "id": id_,
            "year": year,
            "price": price,
            "mileage": miles,
            "make": make,
            "model": model,
            "body_type": body,
        }

    def test_thresholds(self):
        self.assertEqual(rate_deal(8500, 10000), "bargain")  # 15% under
        self.assertEqual(rate_deal(8501, 10000), "fair")
        self.assertEqual(rate_deal(11500, 10000), "fair")  # exactly 15% over
        self.assertEqual(rate_deal(11501, 10000), "bad")
        self.assertEqual(rate_deal(1000, None), "unrated")

    def test_median_of_comps_not_a_made_up_book_value(self):
        subject = self._row("s", 2014, 3000, 100000)
        comps = [
            self._row("a", 2013, 4000, 90000),
            self._row("b", 2014, 4200, 100000),
            self._row("c", 2015, 4400, 110000),
            subject,
        ]
        estimate, method = estimate_market_value(subject, comps)
        self.assertEqual(method, "median_make_model_year_pm2_mileage_adj")
        self.assertIsNotNone(estimate)
        # Median of the three comps is 4200; subject miles match the median miles.
        self.assertEqual(estimate, 4200)

    def test_higher_miles_lower_the_estimate(self):
        subject = self._row("s", 2014, 3000, 140000)
        peers = [
            self._row("a", 2014, 4500, 60000),
            self._row("b", 2014, 4000, 80000),
            self._row("c", 2014, 3500, 100000),
            self._row("d", 2014, 3000, 120000),
        ]
        low_miles = dict(subject, mileage=60000)
        high, _ = estimate_market_value(subject, peers + [subject])
        low, _ = estimate_market_value(low_miles, peers + [low_miles])
        self.assertLess(high, low)

    def test_falls_back_when_the_model_is_rare(self):
        subject = self._row("s", 2010, 2000, 90000, model="Probe")
        others = [
            self._row(str(i), 2008, 2500 + i * 100, 80000, model="Focus")
            for i in range(4)
        ]
        estimate, method = estimate_market_value(subject, others + [subject])
        self.assertEqual(method, "median_make_body_mileage_adj")
        self.assertGreater(estimate, 0)

    def test_build_record_enforces_criteria(self):
        base = {
            "id": "abc",
            "url": "https://www.craigslist.org/view/d/madison-car/abc",
            "year": 2013,
            "make": "Chevrolet",
            "model": "Malibu",
            "trim": "1LT",
            "body_type": "Sedan",
            "price": 1100,
            "mileage": 115000,
            "city": "Janesville",
            "state": "WI",
            "lat": 42.675848,
            "lon": -89.031487,
            "title_status": "clean",
            "image_url": "https://images.craigslist.org/00h0h_example_600x450.jpg",
            "description": "Clean <b>title</b>",
            "posted_at": "2026-11-13T15:52:35-0600",
        }
        kept = build_record(dict(base), now="2026-11-14T00:00:00Z", previous=None)
        self.assertIsNotNone(kept)
        self.assertEqual(kept["title_status"], "clean")
        self.assertNotIn("<b>", kept["description"])
        self.assertLess(kept["distance_mi"], 80)
        salvage = dict(base, title_status="salvage")
        self.assertIsNone(build_record(salvage, now="2026-11-14T00:00:00Z", previous=None))
        pricey = dict(base, price=9000)
        self.assertIsNone(build_record(pricey, now="2026-11-14T00:00:00Z", previous=None))
        bait = dict(
            base,
            year=2022,
            price=500,
            description="BAD CREDIT NO CREDIT EVERYBODY WITH $500 DOWN DRIVES HOME TODAY",
        )
        self.assertIsNone(build_record(bait, now="2026-11-14T00:00:00Z", previous=None))
        tiny = dict(base, price=50)
        self.assertIsNone(build_record(tiny, now="2026-11-14T00:00:00Z", previous=None))
        placeholder_miles = dict(base, mileage=1)
        self.assertIsNone(build_record(placeholder_miles, now="2026-11-14T00:00:00Z", previous=None))
        js = dict(base, image_url="javascript:alert(1)")
        record = build_record(js, now="2026-11-14T00:00:00Z", previous=None)
        self.assertIsNone(record["image_url"])

    def test_dedupe_cross_post(self):
        a = {
            "id": "1",
            "year": 2012,
            "make": "Ford",
            "model": "Focus",
            "price": 2500,
            "mileage": 90000,
            "city": "Madison",
            "title": "2012 Ford Focus",
            "description": "same car same story " * 4,
            "distance_mi": 5,
        }
        b = dict(a, id="2", city="Milwaukee", distance_mi=80)
        # Different city but same long description, price, and miles.
        kept = dedupe([b, a])
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["id"], "1")


class ClientSafetyTests(unittest.TestCase):
    def test_page_has_no_inline_handlers_or_innerhtml(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
        theme = (ROOT / "js" / "theme-init.js").read_text(encoding="utf-8")
        for needle in ("onclick=", "onerror=", "onload=", " style=", "javascript:"):
            self.assertNotIn(needle, html)
        self.assertNotIn("unsafe-inline", html)
        self.assertIn("Content-Security-Policy", html)
        for src in (js, theme):
            for needle in ("innerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
                self.assertNotIn(needle, src)


if __name__ == "__main__":
    unittest.main()
