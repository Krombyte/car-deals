/* Price-box matching for the page, and the same placeholder-price
   check the sell form uses. The scraper has its own copy in scraper/prices.py. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CarDealsFilters = api;
})(typeof window !== "undefined" ? window : this, function () {
  function digitsOnly(value) {
    return String(value == null ? "" : value).replace(/\D/g, "").slice(0, 7);
  }

  function parseBound(value) {
    var digits = digitsOnly(value);
    if (!digits) return null;
    var n = parseInt(digits, 10);
    if (!isFinite(n) || n < 0 || n > 1000000) return null;
    return n;
  }

  function matchesPrice(price, minRaw, maxRaw) {
    if (typeof price !== "number" || !isFinite(price)) return false;
    var min = parseBound(minRaw);
    var max = parseBound(maxRaw);
    if (min != null && max != null && min > max) {
      var swap = min;
      min = max;
      max = swap;
    }
    if (min != null && price < min) return false;
    if (max != null && price > max) return false;
    return true;
  }

  function presetMax(name) {
    if (name === "under5k") return "5000";
    if (name === "under10k") return "10000";
    if (name === "under20k") return "20000";
    if (name === "under60k") return "60000";
    return "";
  }

  function activePreset(minRaw, maxRaw) {
    if (parseBound(minRaw) != null) return "";
    var max = parseBound(maxRaw);
    if (max === 5000) return "under5k";
    if (max === 10000) return "under10k";
    if (max === 20000) return "under20k";
    if (max === 60000) return "under60k";
    return "";
  }

  function isPlaceholderPrice(price) {
    if (typeof price !== "number" || !isFinite(price) || price < 0 || Math.round(price) !== price) return true;
    if (price === 1 || price === 12) return true;
    var text = String(price);
    if (text.length < 3) return false;
    var unique = {};
    var i;
    for (i = 0; i < text.length; i += 1) unique[text.charAt(i)] = true;
    if (Object.keys(unique).length === 1) return true;
    var up = true;
    var down = true;
    for (i = 0; i < text.length - 1; i += 1) {
      var diff = Number(text.charAt(i + 1)) - Number(text.charAt(i));
      if (diff !== 1) up = false;
      if (diff !== -1) down = false;
    }
    if (up || down) return true;
    var size;
    for (size = 2; size <= text.length / 2; size += 1) {
      if (text.length % size) continue;
      var block = text.slice(0, size);
      if (block.repeat(text.length / size) === text) return true;
    }
    return false;
  }

  return {
    digitsOnly: digitsOnly,
    parseBound: parseBound,
    matchesPrice: matchesPrice,
    presetMax: presetMax,
    activePreset: activePreset,
    isPlaceholderPrice: isPlaceholderPrice,
  };
});
