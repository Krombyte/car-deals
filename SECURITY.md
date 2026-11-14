# Security

Car Deals is a static site. It has no accounts, no server, and no secrets.
The things that can go wrong are a poisoned listing file, a malicious
listing page, or a dependency we did not pin.

## Reporting

Open a GitHub issue, or email the repository owner if you believe the
report should stay private. Please include the page, the browser, and
what you expected to happen. There is no bounty program.

## What this site trusts

`data/listings.json` is produced by `python3 -m scraper` from public
Craigslist pages. Treat that file as untrusted input anyway:

- The scraper strips HTML, caps field lengths, and allows only `http:`
  and `https:` URLs. Listing links must be on `craigslist.org`. Photos
  must be on `images.craigslist.org`. `javascript:` and `data:` URLs
  are rejected. VINs are not stored.
- The browser renders every seller string with `textContent`. It does
  not assign HTML from the listing file. It checks listing and image
  URLs again before setting `href` or `src`.
- Outbound listing links use `target="_blank"` and
  `rel="noopener noreferrer"`.

Saved cars and the theme live in `localStorage` on the device. Nothing
is uploaded. There is no cookie, account, or analytics script.

## Content Security Policy

`index.html` sends a CSP with a meta tag:

- `default-src 'self'`
- scripts, styles, fonts, and `connect-src` limited to this origin
- `img-src 'self' https://images.craigslist.org`
- no inline scripts, no inline styles, no object/embed, no forms

A meta tag cannot set every header. GitHub Pages also will not let this
repository add response headers. These are **not** enforced on
`https://krombyte.github.io/car-deals/` today:

| Header | Why it is missing | What to add later |
|---|---|---|
| `Content-Security-Policy` as a real header | Pages ignores custom headers. The meta tag covers the document, but not every directive. | Put the same policy in a header. Prefer the header over the meta tag. |
| `frame-ancestors 'none'` | Ignored inside a meta tag. | Header, or `X-Frame-Options: DENY`. |
| `X-Content-Type-Options: nosniff` | No meta equivalent that browsers honor. | Header. |
| `Referrer-Policy` | A meta tag is set (`strict-origin-when-cross-origin`). A header is still stronger for non-HTML responses. | Repeat it as a header. |
| `X-Frame-Options: DENY` | Header only. | Header, if you are not using CSP `frame-ancestors`. |

To enforce those headers, put the site behind Cloudflare or Netlify
(or another host that allows a headers file) and keep GitHub as the
origin. On Netlify, a `_headers` file like this works:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://images.craigslist.org; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
```

Do not add `unsafe-inline` or a third-party script host to make a widget work.

## Repository settings to turn on

These are account settings, not files in this repo:

1. **Branch protection on `main`.** Require a pull request and the Tests
   check. The scheduled listings job pushes with the built-in
   `GITHUB_TOKEN`, so give that bot a bypass (or an exception) or the
   update commit will be rejected.
2. **Dependabot.** `.github/dependabot.yml` already asks for weekly
   GitHub Actions updates. Enable Dependabot alerts, and version
   updates if the config file alone did not turn them on.
3. **Secret scanning**, including push protection. This repo should
   never contain a key. Scanning is the backstop.

## Dependencies

The site and the scraper use the Python and browser standard libraries
only, plus the SIL Open Font License build of Inter in `fonts/`.
There is no package manager lockfile because there are no packages.
GitHub Actions are pinned to a commit SHA in `.github/workflows/`.

## Scraper

The scraper sends a descriptive user agent, waits at least 0.8 seconds
between listing fetches, and only requests Craigslist search and posting
URLs. `robots.txt` allows those paths and disallows reply, flag, and
mail endpoints, which this code does not call. If Craigslist returns
403 or 429, the run backs off and refuses to replace `data/listings.json`
with a partial file.
