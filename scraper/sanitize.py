"""Sanitize untrusted Craigslist fields before they reach the static site."""

from __future__ import annotations

import html
import re
from urllib.parse import urlsplit, urlunsplit

_CONTROL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]")
_TAG = re.compile(r"<[^>]+>")
_BREAK = re.compile(r"(?i)<\s*br\s*/?\s*>|</\s*p\s*>|</\s*div\s*>|</\s*li\s*>")
_WS = re.compile(r"[ \t\f\v]+")
_NEWLINES = re.compile(r"\n{2,}")
_CITY = re.compile(r"[^A-Za-z0-9 .,'’\-/]")
# 17-character VIN, excluding I, O, and Q. Require at least one digit so a
# shouty sentence of 17 letters is left alone.
_VIN = re.compile(r"\b(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}\b", re.I)
_QR = re.compile(r"qr code link to this post", re.I)


def strip_html(value: str) -> str:
    """Turn a fragment into plain text. Tags are removed, never interpreted."""
    if not value:
        return ""
    text = _BREAK.sub("\n", value)
    text = _TAG.sub(" ", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ").replace("\u200b", "")
    text = _CONTROL.sub("", text)
    text = _WS.sub(" ", text)
    text = _NEWLINES.sub("\n", text)
    return text.strip()


def redact_sensitive(value: str) -> str:
    """Drop VINs and Craigslist print boilerplate from stored description text."""
    text = _VIN.sub("", value or "")
    text = _QR.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip(" \n-:#")


def cap_text(value: str, limit: int) -> str:
    value = strip_html(value) if "<" in value or "&" in value else _CONTROL.sub("", value or "")
    value = value.replace("\xa0", " ").strip()
    if len(value) <= limit:
        return value
    clipped = value[:limit].rstrip()
    # Don't end on a sliced surrogate-looking fragment; plain str is fine in py3.
    return clipped.rstrip(" ,;:-") 


def clean_city(value: str) -> str:
    text = cap_text(strip_html(value), 48)
    text = _CITY.sub("", text)
    return re.sub(r"\s+", " ", text).strip(" ,")


def clean_state(value: str) -> str:
    letters = re.sub(r"[^A-Za-z]", "", value or "")
    if len(letters) < 2:
        return ""
    return letters[:2].upper()


def clean_http_url(value: str, *, allowed_hosts: tuple[str, ...] | None = None) -> str | None:
    """Allow only http(s) URLs. Reject javascript:, data:, and credentialed URLs.

    allowed_hosts, when set, is an exact-host allowlist. Hosts may also match
    a leading-dot suffix entry such as ".craigslist.org".
    """
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw or len(raw) > 500:
        return None
    if raw.lower().startswith(("javascript:", "data:", "vbscript:", "blob:", "file:")):
        return None
    # Scheme-relative and whitespace tricks.
    if raw.startswith("//") or any(ch.isspace() for ch in raw):
        return None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    scheme = (parts.scheme or "").lower()
    if scheme not in ("http", "https"):
        return None
    if parts.username or parts.password:
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    if not host or host == "localhost":
        return None
    if allowed_hosts is not None and not _host_allowed(host, allowed_hosts):
        return None
    # Rebuild without userinfo. Drop fragments.
    netloc = host
    if parts.port:
        netloc = f"{host}:{parts.port}"
    path = parts.path or "/"
    return urlunsplit((scheme, netloc, path, parts.query, ""))


def _host_allowed(host: str, allowed_hosts: tuple[str, ...]) -> bool:
    for rule in allowed_hosts:
        rule = rule.lower()
        if rule.startswith("."):
            if host.endswith(rule) or host == rule[1:]:
                return True
        elif host == rule:
            return True
    return False
