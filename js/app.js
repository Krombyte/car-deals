/* Car Deals browser UI.
   Every listing field is untrusted text. Nodes are created with
   createElement and filled with textContent only. */
(function () {
  var THEME_KEY = "carDealsTheme";
  var SAVED_KEY = "carDealsSaved";
  var POLL_MS = 3 * 60 * 1000;
  var BODY_FROM_URL = {
    sedan: "Sedan",
    suv: "SUV",
    truck: "Truck",
    coupe: "Coupe",
    hatchback: "Hatchback",
  };

  var state = {
    doc: null,
    listings: [],
    tab: "browse",
    query: "",
    body: "",
    under5k: false,
    under120: false,
    make: "",
    price: "",
    miles: "",
    distance: "",
    sort: "savings",
    saved: new Set(),
    knownIds: new Set(),
    hiddenNew: new Set(),
    prependIds: [],
    phase: "loading",
    booted: false,
    toastTimer: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== "") node.textContent = text;
    return node;
  }

  function svg(paths) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("aria-hidden", "true");
    paths.forEach(function (spec) {
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", spec.d);
      path.setAttribute("fill", spec.fill || "none");
      if (spec.stroke !== false) {
        path.setAttribute("stroke", spec.stroke || "currentColor");
        path.setAttribute("stroke-width", spec.width || "1.8");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
      }
      node.appendChild(path);
    });
    return node;
  }

  var moneyFmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  var numFmt = new Intl.NumberFormat("en-US");
  var dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  var dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function money(value) {
    return moneyFmt.format(value);
  }

  function chicagoDay(iso) {
    var t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return "";
    return dayKeyFmt.format(new Date(t));
  }

  function checkedLabel(iso) {
    var t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return "";
    return "Last checked " + dayFmt.format(new Date(t));
  }

  function safeUrl(value, hostOk) {
    if (typeof value !== "string" || value.length === 0 || value.length > 500) return "";
    if (/[\s]/.test(value)) return "";
    var url;
    try {
      url = new URL(value);
    } catch (err) {
      return "";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    if (hostOk && !hostOk(url.hostname.toLowerCase())) return "";
    return url.href;
  }

  function listingHostOk(host) {
    return host === "craigslist.org" || host.endsWith(".craigslist.org");
  }

  function imageHostOk(host) {
    return host === "images.craigslist.org";
  }

  function asInt(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.round(value);
  }

  function asText(value, limit) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit);
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = asText(raw.id, 80);
    var url = safeUrl(raw.url, listingHostOk);
    var price = asInt(raw.price);
    if (!id || !url || price == null || price <= 0) return null;
    var year = asInt(raw.year);
    return {
      id: id,
      title: asText(raw.title, 140) || "Listing",
      year: year,
      make: asText(raw.make, 40),
      model: asText(raw.model, 40),
      trim: asText(raw.trim, 80),
      body_type: asText(raw.body_type, 24),
      price: price,
      mileage: asInt(raw.mileage),
      city: asText(raw.city, 48),
      state: asText(raw.state, 2).toUpperCase(),
      distance_mi: asInt(raw.distance_mi),
      source: asText(raw.source, 40) || "Craigslist",
      url: url,
      image_url: safeUrl(raw.image_url, imageHostOk),
      description: asText(raw.description, 500),
      title_status: asText(raw.title_status, 24),
      est_market_value: asInt(raw.est_market_value),
      market_value_method: asText(raw.market_value_method, 80),
      deal_rating: ["bargain", "fair", "bad", "unrated"].indexOf(raw.deal_rating) >= 0 ? raw.deal_rating : "unrated",
      first_seen: asText(raw.first_seen, 40),
      last_checked: asText(raw.last_checked, 40),
      posted_at: asText(raw.posted_at, 40),
      featured: raw.featured === true,
    };
  }

  function isMustang(listing) {
    return listing.make.toLowerCase() === "ford" && listing.model.toLowerCase().indexOf("mustang") !== -1;
  }

  function isFresh(listing) {
    var iso = listing.posted_at || listing.first_seen;
    var t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < 24 * 60 * 60 * 1000;
  }

  function matches(listing) {
    if (listing.featured === true) return false;
    if (state.hiddenNew.has(listing.id)) return false;
    if (state.tab === "mustangs" && !isMustang(listing)) return false;
    if (state.tab === "saved" && !state.saved.has(listing.id)) return false;
    if (state.body && listing.body_type !== state.body) return false;
    if (state.under5k && listing.price > 5000) return false;
    if (state.under120 && (listing.mileage == null || listing.mileage > 120000)) return false;
    if (state.make && listing.make !== state.make) return false;
    if (state.price && listing.price > Number(state.price)) return false;
    if (state.miles && (listing.mileage == null || listing.mileage > Number(state.miles))) return false;
    if (state.distance && (listing.distance_mi == null || listing.distance_mi > Number(state.distance))) return false;
    if (state.query) {
      var hay = (listing.make + " " + listing.model + " " + listing.trim + " " + listing.city + " " + listing.title).toLowerCase();
      if (hay.indexOf(state.query.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function savingsPct(listing) {
    if (!listing.est_market_value || listing.est_market_value <= 0) return null;
    return (listing.est_market_value - listing.price) / listing.est_market_value;
  }

  function timeValue(listing) {
    var t = Date.parse(listing.posted_at || listing.first_seen || "");
    return Number.isFinite(t) ? t : 0;
  }

  function sortListings(rows) {
    var copy = rows.slice();
    copy.sort(function (a, b) {
      if (state.sort === "price") return a.price - b.price || a.id.localeCompare(b.id);
      if (state.sort === "miles") {
        var am = a.mileage == null ? 1e12 : a.mileage;
        var bm = b.mileage == null ? 1e12 : b.mileage;
        return am - bm || a.price - b.price || a.id.localeCompare(b.id);
      }
      if (state.sort === "newest") return timeValue(b) - timeValue(a) || a.id.localeCompare(b.id);
      var as = savingsPct(a);
      var bs = savingsPct(b);
      if (as == null && bs == null) return a.price - b.price || a.id.localeCompare(b.id);
      if (as == null) return 1;
      if (bs == null) return -1;
      return bs - as || a.price - b.price || a.id.localeCompare(b.id);
    });
    return copy;
  }

  function visibleListings() {
    var rows = sortListings(state.listings.filter(matches));
    if (!state.prependIds.length) return rows;
    var byId = new Map(rows.map(function (row) { return [row.id, row]; }));
    var prepend = [];
    state.prependIds.forEach(function (id) {
      if (byId.has(id)) prepend.push(byId.get(id));
    });
    var seen = new Set(prepend.map(function (row) { return row.id; }));
    return prepend.concat(rows.filter(function (row) { return !seen.has(row.id); }));
  }

  function filtersActive() {
    return Boolean(
      state.query || state.body || state.under5k || state.under120 || state.make ||
      state.price || state.miles || state.distance || state.sort !== "savings"
    );
  }

  function readUrl() {
    var params = new URLSearchParams(window.location.search);
    var tab = params.get("tab");
    state.tab = tab === "mustangs" || tab === "saved" ? tab : "browse";
    state.query = (params.get("q") || "").slice(0, 80);
    state.body = BODY_FROM_URL[(params.get("body") || "").toLowerCase()] || "";
    state.under5k = params.get("under5k") === "1";
    state.under120 = params.get("under120") === "1";
    state.make = (params.get("make") || "").slice(0, 40);
    state.price = ["1000", "2000", "3000", "5000"].indexOf(params.get("price") || "") >= 0 ? params.get("price") : "";
    state.miles = ["60000", "80000", "100000", "120000"].indexOf(params.get("miles") || "") >= 0 ? params.get("miles") : "";
    state.distance = ["25", "50", "100", "200", "300"].indexOf(params.get("distance") || "") >= 0 ? params.get("distance") : "";
    var sort = params.get("sort");
    state.sort = sort === "price" || sort === "newest" || sort === "miles" ? sort : "savings";
  }

  function writeUrl() {
    var params = new URLSearchParams();
    if (state.tab !== "browse") params.set("tab", state.tab);
    if (state.query) params.set("q", state.query);
    if (state.body) params.set("body", state.body.toLowerCase());
    if (state.under5k) params.set("under5k", "1");
    if (state.under120) params.set("under120", "1");
    if (state.make) params.set("make", state.make);
    if (state.price) params.set("price", state.price);
    if (state.miles) params.set("miles", state.miles);
    if (state.distance) params.set("distance", state.distance);
    if (state.sort !== "savings") params.set("sort", state.sort);
    var qs = params.toString();
    var next = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    window.history.replaceState(null, "", next);
  }

  function loadSaved() {
    try {
      var raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
      if (Array.isArray(raw)) {
        state.saved = new Set(raw.filter(function (id) { return typeof id === "string" && id.length < 100; }));
      }
    } catch (err) {
      state.saved = new Set();
    }
  }

  function persistSaved() {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(state.saved)));
    } catch (err) { /* private mode */ }
  }

  function setTheme(theme) {
    if (theme !== "light" && theme !== "dark") theme = "dark";
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) { /* ignore */ }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#F4F6F8" : "#0B0F14");
    $("theme-light").setAttribute("aria-pressed", theme === "light" ? "true" : "false");
    $("theme-dark").setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  }

  function syncHeaderOffset() {
    var header = document.querySelector(".header");
    if (!header) return;
    document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  }

  function syncControls() {
    $("q").value = state.query;
    $("price").value = state.price;
    $("miles").value = state.miles;
    $("distance").value = state.distance;
    $("sort").value = state.sort;
    if ($("make").value !== state.make) {
      var has = Array.prototype.some.call($("make").options, function (opt) { return opt.value === state.make; });
      $("make").value = has ? state.make : "";
    }
    document.querySelectorAll(".chip[data-body]").forEach(function (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute("data-body") === state.body ? "true" : "false");
    });
    $("chip-5k").setAttribute("aria-pressed", state.under5k ? "true" : "false");
    $("chip-120").setAttribute("aria-pressed", state.under120 ? "true" : "false");
    ["browse", "mustangs", "saved"].forEach(function (name) {
      $("tab-" + name).setAttribute("aria-selected", state.tab === name ? "true" : "false");
    });
    $("clear").hidden = !filtersActive();
  }

  function fillMakes() {
    var select = $("make");
    var makes = [];
    var seen = new Set();
    state.listings.forEach(function (listing) {
      if (listing.make && !seen.has(listing.make)) {
        seen.add(listing.make);
        makes.push(listing.make);
      }
    });
    makes.sort(function (a, b) { return a.localeCompare(b); });
    if (!seen.has(state.make)) state.make = "";
    select.replaceChildren();
    var any = document.createElement("option");
    any.value = "";
    any.textContent = "Make";
    select.appendChild(any);
    makes.forEach(function (make) {
      var opt = document.createElement("option");
      opt.value = make;
      opt.textContent = make;
      select.appendChild(opt);
    });
    select.value = state.make;
  }

  function badgeSpec(rating) {
    if (rating === "bargain") {
      return { cls: "badge badge-bargain", label: "Bargain", path: "M7.2 7.2h.01M3.5 12.2 11 4.7h7.2v7.2l-7.5 7.5-7.2-7.2z" };
    }
    if (rating === "fair") {
      return { cls: "badge badge-fair", label: "Fair deal", path: "M5 12h14M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" };
    }
    if (rating === "bad") {
      return { cls: "badge badge-bad", label: "Bad deal", path: "M12 4.2 20.5 19.2h-17L12 4.2zM12 10v4.2M12 16.8h.01" };
    }
    return { cls: "badge badge-unrated", label: "Unrated", path: "M5 12h14" };
  }

  function photoNode(listing, index) {
    var media = el("div", "card-media");
    if (listing.image_url) {
      var img = document.createElement("img");
      img.alt = listing.title;
      img.width = 600;
      img.height = 400;
      img.decoding = "async";
      img.loading = index < 3 ? "eager" : "lazy";
      if (index < 3) img.setAttribute("fetchpriority", "high");
      img.src = listing.image_url;
      img.addEventListener("error", function () {
        var tpl = $("photo-fallback");
        if (tpl && tpl.content) img.replaceWith(tpl.content.cloneNode(true));
      });
      media.appendChild(img);
    } else {
      var tpl = $("photo-fallback");
      if (tpl && tpl.content) media.appendChild(tpl.content.cloneNode(true));
    }
    var spec = badgeSpec(listing.deal_rating);
    var badge = el("p", spec.cls);
    badge.appendChild(svg([{ d: spec.path }]));
    badge.appendChild(document.createTextNode(spec.label));
    media.appendChild(badge);
    if (isFresh(listing)) {
      media.appendChild(el("span", "pill-new", "New"));
    }
    var heart = el("button", "heart");
    heart.type = "button";
    heart.setAttribute("aria-pressed", state.saved.has(listing.id) ? "true" : "false");
    heart.setAttribute("aria-label", (state.saved.has(listing.id) ? "Remove " : "Save ") + listing.title);
    heart.appendChild(svg([{ d: "M12 20s-7-4.4-9.2-8.2C1 8.8 2.4 5.5 5.6 5.2 7.4 5 9 6 12 8.4 15 6 16.6 5 18.4 5.2c3.2.3 4.6 3.6 2.8 6.6C19 15.6 12 20 12 20z" }]));
    heart.addEventListener("click", function () {
      toggleSaved(listing, heart);
    });
    media.appendChild(heart);
    return media;
  }

  function deltaNode(listing) {
    var estimate = listing.est_market_value;
    if (!estimate) return null;
    var delta = estimate - listing.price;
    var node = el("p", "delta");
    if (Math.abs(delta) < 50) {
      node.classList.add("at");
      node.textContent = "At market";
      return node;
    }
    if (delta > 0) {
      node.classList.add("below");
      node.appendChild(svg([{ d: "M12 5v14 M6 13l6 6 6-6" }]));
      node.appendChild(document.createTextNode(money(delta) + " below market"));
    } else {
      node.classList.add("above");
      node.appendChild(svg([{ d: "M12 19V5 M6 11l6-6 6 6" }]));
      node.appendChild(document.createTextNode(money(Math.abs(delta)) + " above market"));
    }
    return node;
  }

  function meterNode(listing) {
    var estimate = listing.est_market_value;
    if (!estimate) return null;
    var ratio = listing.price / estimate;
    var pct = Math.max(0, Math.min(100, ratio * 100));
    var over = listing.price > estimate;
    var wrap = el("div", "meter");
    var left = el("span", "meter-label", "0%");
    var right = el("span", "meter-label", "100%");
    left.setAttribute("aria-hidden", "true");
    right.setAttribute("aria-hidden", "true");
    var track = el("div", "meter-track");
    track.setAttribute("role", "img");
    track.setAttribute(
      "aria-label",
      "Asking price is " + Math.round(pct) + " percent of the estimated market"
    );
    var fill = el("span", "meter-fill");
    var knob = el("span", "meter-knob");
    var color = over ? "var(--meter-bad)" : "var(--meter)";
    fill.style.setProperty("--fill", pct + "%");
    fill.style.setProperty("--meter-color", color);
    knob.style.setProperty("--fill", pct + "%");
    knob.style.setProperty("--meter-color", color);
    track.appendChild(fill);
    track.appendChild(knob);
    wrap.appendChild(left);
    wrap.appendChild(track);
    wrap.appendChild(right);
    return wrap;
  }

  function renderCard(listing, index, featured) {
    var card = el("article", featured ? "card is-featured" : "card");
    if (state.prependIds.indexOf(listing.id) !== -1) card.classList.add("is-new");
    card.appendChild(photoNode(listing, index));
    var body = el("div", "card-body");
    if (featured) body.appendChild(el("p", "sponsored", "Sponsored"));
    var title = el("h2", null, listing.title);
    title.id = "listing-" + listing.id;
    card.setAttribute("aria-labelledby", title.id);
    body.appendChild(title);
    var bits = [];
    if (listing.mileage != null) bits.push(numFmt.format(listing.mileage) + " mi");
    var place = [listing.city, listing.state].filter(Boolean).join(", ");
    if (place) bits.push(place);
    if (listing.distance_mi != null) bits.push(numFmt.format(listing.distance_mi) + " mi away");
    if (bits.length) body.appendChild(el("p", "meta", bits.join(" · ")));
    var prices = el("div", "price-block");
    prices.appendChild(el("p", "price", money(listing.price)));
    var marketText = listing.est_market_value ? "Est. market avg " + money(listing.est_market_value) : "Est. market avg —";
    prices.appendChild(el("p", "market", marketText));
    var delta = deltaNode(listing);
    if (delta) prices.appendChild(delta);
    var meter = meterNode(listing);
    if (meter) prices.appendChild(meter);
    body.appendChild(prices);
    var foot = el("div", "card-foot");
    foot.appendChild(el("span", "source", listing.source));
    var link = el("a", "view");
    link.href = listing.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.appendChild(document.createTextNode("View listing"));
    link.appendChild(svg([{ d: "M7 17 17 7 M9 7h8v8" }]));
    var sr = el("span", "sr-only", " for " + listing.title + ", opens in a new tab");
    link.appendChild(sr);
    foot.appendChild(link);
    body.appendChild(foot);
    var checked = checkedLabel(listing.last_checked);
    if (checked) body.appendChild(el("p", "checked", checked));
    card.appendChild(body);
    return card;
  }

  /* FEATURED / SPONSORED SLOT — inactive in v1.
     After every 6th organic card, a future listing with featured === true
     would render here at the same size (gold top bar, Sponsored label).
     Nothing in the current feed sets featured, so this returns null and
     the grid never shows an empty ad tile. */
  function renderFeaturedSlot(organicIndex) {
    if ((organicIndex + 1) % 6 !== 0) return null;
    var featured = null;
    for (var i = 0; i < state.listings.length; i += 1) {
      if (state.listings[i].featured === true) {
        featured = state.listings[i];
        break;
      }
    }
    if (!featured) return null;
    return renderCard(featured, organicIndex, true);
  }

  function renderSkeletons() {
    var grid = $("deals");
    grid.replaceChildren();
    grid.hidden = false;
    grid.setAttribute("aria-busy", "true");
    for (var i = 0; i < 9; i += 1) {
      var card = el("article", "card skeleton");
      card.setAttribute("aria-hidden", "true");
      var media = el("div", "card-media");
      media.appendChild(el("div", "sk-photo"));
      var body = el("div", "card-body");
      ["w70", "w40", "w90", "w55", "w35", "w45"].forEach(function (width) {
        body.appendChild(el("div", "sk-line " + width));
      });
      card.appendChild(media);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  function setEmpty(mode) {
    var box = $("empty");
    var title = $("empty-title");
    var body = $("empty-body");
    var action = $("empty-action");
    box.hidden = false;
    $("deals").hidden = true;
    if (mode === "filters") {
      title.textContent = "No deals match these filters.";
      body.textContent = "Try widening distance, raising the mileage cap, or clearing a filter.";
      action.textContent = "Clear filters";
    } else if (mode === "saved") {
      title.textContent = "No saved cars yet.";
      body.textContent = "Use the heart on a deal to keep it here. Saved cars stay on this device only.";
      action.textContent = "Browse all";
    } else if (mode === "mustangs") {
      title.textContent = "No Mustang picks match.";
      body.textContent = "Try clearing a filter, or check back after the next update.";
      action.textContent = filtersActive() ? "Clear filters" : "Browse all";
    } else {
      title.textContent = "No listings to show right now.";
      body.textContent = "Listings appear here as they are found.";
      action.textContent = "Retry";
    }
    action.dataset.mode = mode;
  }

  function updatePendingButton() {
    var button = $("pending-btn");
    var n = 0;
    state.listings.forEach(function (listing) {
      if (!state.hiddenNew.has(listing.id)) return;
      var hidden = state.hiddenNew;
      state.hiddenNew = new Set();
      var ok = matches(listing);
      state.hiddenNew = hidden;
      if (ok) n += 1;
    });
    if (n > 0) {
      button.hidden = false;
      button.textContent = n === 1 ? "1 new deal — show" : n + " new deals — show";
    } else {
      button.hidden = true;
      button.textContent = "";
    }
  }

  function render() {
    syncControls();
    var grid = $("deals");
    if (state.phase === "loading") {
      $("count").textContent = "Loading deals near Madison…";
      $("empty").hidden = true;
      return;
    }
    if (state.phase === "error") {
      $("count").textContent = "Deals near Madison";
      setEmpty("error");
      updatePendingButton();
      return;
    }
    var rows = visibleListings();
    $("count").textContent = (rows.length === 1 ? "1 deal" : rows.length + " deals") + " near Madison";
    updatePendingButton();
    var featuredPlaced = false;
    if (!rows.length) {
      grid.replaceChildren();
      if (!state.listings.length) setEmpty("error");
      else if (state.tab === "saved") setEmpty("saved");
      else if (state.tab === "mustangs" && !filtersActive()) setEmpty("mustangs");
      else setEmpty("filters");
      return;
    }
    $("empty").hidden = true;
    grid.hidden = false;
    grid.removeAttribute("aria-busy");
    var fragment = document.createDocumentFragment();
    rows.forEach(function (listing, index) {
      fragment.appendChild(renderCard(listing, index, false));
      if (!featuredPlaced) {
        var slot = renderFeaturedSlot(index);
        if (slot) {
          featuredPlaced = true;
          fragment.appendChild(slot);
        }
      }
    });
    grid.replaceChildren(fragment);
  }

  function toggleSaved(listing, button) {
    if (state.saved.has(listing.id)) state.saved.delete(listing.id);
    else state.saved.add(listing.id);
    persistSaved();
    var saved = state.saved.has(listing.id);
    button.setAttribute("aria-pressed", saved ? "true" : "false");
    button.setAttribute("aria-label", (saved ? "Remove " : "Save ") + listing.title);
    if (state.tab === "saved") render();
  }

  function updateLive() {
    var today = chicagoDay(new Date().toISOString());
    var n = 0;
    state.listings.forEach(function (listing) {
      if (chicagoDay(listing.posted_at || listing.first_seen) === today) n += 1;
    });
    $("live-text").textContent = "Live · " + n + " new today";
  }

  function updateFooter() {
    var node = $("updated");
    var iso = state.doc && state.doc.generated_at;
    var t = Date.parse(iso || "");
    if (!Number.isFinite(t)) {
      node.textContent = "";
      return;
    }
    node.textContent = "Listings last updated " + dayFmt.format(new Date(t)) + " (Central time).";
  }

  function dismissToast() {
    window.clearTimeout(state.toastTimer);
    $("toast").replaceChildren();
  }

  function showToast(count) {
    if (!count) return;
    var region = $("toast");
    region.replaceChildren();
    var copy = el("p", "toast-copy");
    copy.appendChild(document.createTextNode(count === 1 ? "1 new deal — " : count + " new deals — "));
    var show = el("button", "toast-show", "show");
    show.type = "button";
    show.addEventListener("click", acceptPending);
    copy.appendChild(show);
    var close = el("button", "toast-x", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", dismissToast);
    region.appendChild(copy);
    region.appendChild(close);
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(dismissToast, 8000);
    updatePendingButton();
  }

  function pendingMatches() {
    var hidden = state.hiddenNew;
    state.hiddenNew = new Set();
    var rows = state.listings.filter(function (listing) {
      return hidden.has(listing.id) && matches(listing);
    });
    state.hiddenNew = hidden;
    return rows;
  }

  function acceptPending() {
    var rows = pendingMatches();
    rows.forEach(function (listing) {
      state.hiddenNew.delete(listing.id);
      state.prependIds.push(listing.id);
    });
    dismissToast();
    render();
    var first = document.querySelector(".card.is-new");
    if (first && first.scrollIntoView) first.scrollIntoView({ block: "nearest" });
  }

  function applyDocument(doc, fromPoll) {
    var next = [];
    (doc.listings || []).forEach(function (row) {
      var listing = normalize(row);
      if (listing) next.push(listing);
    });
    var fresh = [];
    if (state.booted) {
      next.forEach(function (listing) {
        if (!state.knownIds.has(listing.id)) fresh.push(listing);
      });
    }
    state.doc = doc;
    state.listings = next;
    next.forEach(function (listing) { state.knownIds.add(listing.id); });
    if (!state.booted) {
      state.booted = true;
      state.phase = "ready";
      fillMakes();
      render();
    } else if (fresh.length) {
      fresh.forEach(function (listing) { state.hiddenNew.add(listing.id); });
      var matching = pendingMatches().filter(function (listing) {
        return fresh.some(function (item) { return item.id === listing.id; });
      });
      if (matching.length) showToast(matching.length);
      else updatePendingButton();
    }
    updateLive();
    updateFooter();
    if (fromPoll) return;
  }

  function fetchDoc() {
    var url = new URL("data/listings.json", document.baseURI);
    return fetch(url, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("status");
      return res.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.listings)) throw new Error("shape");
      return data;
    });
  }

  function load() {
    state.phase = "loading";
    return fetchDoc().then(function (doc) {
      state.phase = "ready";
      applyDocument(doc, false);
    }).catch(function () {
      state.phase = "error";
      render();
    });
  }

  function poll() {
    fetchDoc().then(function (doc) {
      applyDocument(doc, true);
    }).catch(function () { /* keep the cards on screen */ });
  }

  function clearFilters() {
    state.query = "";
    state.body = "";
    state.under5k = false;
    state.under120 = false;
    state.make = "";
    state.price = "";
    state.miles = "";
    state.distance = "";
    state.sort = "savings";
    writeUrl();
    render();
  }

  function bind() {
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        state.tab = tab.id.replace("tab-", "");
        writeUrl();
        render();
      });
    });
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    tabs.forEach(function (tab, index) {
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        var next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    });
    document.querySelectorAll(".chip[data-body]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.body = chip.getAttribute("data-body") || "";
        writeUrl();
        render();
      });
    });
    $("chip-5k").addEventListener("click", function () {
      state.under5k = !state.under5k;
      writeUrl();
      render();
    });
    $("chip-120").addEventListener("click", function () {
      state.under120 = !state.under120;
      writeUrl();
      render();
    });
    ["make", "price", "miles", "distance", "sort"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state[id] = $(id).value;
        writeUrl();
        render();
      });
    });
    $("q").addEventListener("input", function () {
      state.query = $("q").value.slice(0, 80);
      writeUrl();
      render();
    });
    $("search-form").addEventListener("submit", function (event) {
      event.preventDefault();
    });
    $("clear").addEventListener("click", clearFilters);
    $("pending-btn").addEventListener("click", acceptPending);
    $("empty-action").addEventListener("click", function () {
      var mode = $("empty-action").dataset.mode;
      if (mode === "error") {
        renderSkeletons();
        $("empty").hidden = true;
        $("count").textContent = "Loading deals near Madison…";
        load();
        return;
      }
      if (mode === "saved" || (mode === "mustangs" && !filtersActive())) {
        state.tab = "browse";
        writeUrl();
        render();
        return;
      }
      clearFilters();
    });
    $("theme-light").addEventListener("click", function () { setTheme("light"); });
    $("theme-dark").addEventListener("click", function () { setTheme("dark"); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") dismissToast();
    });
    window.addEventListener("resize", syncHeaderOffset);
  }

  readUrl();
  loadSaved();
  setTheme(document.documentElement.getAttribute("data-theme") || "dark");
  syncHeaderOffset();
  bind();
  syncControls();
  load();
  window.setInterval(poll, POLL_MS);

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    window.__carDeals = {
      applyDocument: applyDocument,
      state: state,
    };
  }
})();
