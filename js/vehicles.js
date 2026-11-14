/* Lookups for the sell form. The lists live in data/vehicles.json. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CarDealsVehicles = api;
})(typeof window !== "undefined" ? window : this, function () {
  var YEAR_MIN = 1950;

  function yearMax() {
    return new Date().getFullYear();
  }

  function years() {
    var list = [];
    var year;
    for (year = yearMax(); year >= YEAR_MIN; year -= 1) list.push(String(year));
    return list;
  }

  function digitsOnly(value, limit) {
    return String(value == null ? "" : value).replace(/\D/g, "").slice(0, limit || 7);
  }

  function filterOptions(options, query) {
    var q = String(query || "").trim().toLowerCase();
    var source = options || [];
    if (!q) return source.slice();
    var starts = [];
    var rest = [];
    source.forEach(function (item) {
      var name = String(item).toLowerCase();
      if (name.indexOf(q) === 0) starts.push(item);
      else if (name.indexOf(q) !== -1) rest.push(item);
    });
    return starts.concat(rest);
  }

  function matchKey(keys, typed) {
    var q = String(typed || "").trim().toLowerCase();
    if (!q) return "";
    var found = "";
    (keys || []).some(function (key) {
      if (String(key).toLowerCase() === q) {
        found = key;
        return true;
      }
      return false;
    });
    return found;
  }

  function modelsFor(data, make) {
    if (!data || !data.models) return [];
    var key = matchKey(Object.keys(data.models), make);
    return key ? data.models[key].slice() : [];
  }

  function trimsFor(data, make, model) {
    if (!data || !data.trims) return [];
    var makeKey = matchKey(data.makes || Object.keys(data.models || {}), make);
    if (!makeKey) return [];
    var modelKey = matchKey(modelsFor(data, makeKey), model);
    if (!modelKey) return [];
    return (data.trims[makeKey + "|" + modelKey] || []).slice();
  }

  return {
    YEAR_MIN: YEAR_MIN,
    yearMax: yearMax,
    years: years,
    digitsOnly: digitsOnly,
    filterOptions: filterOptions,
    modelsFor: modelsFor,
    trimsFor: trimsFor,
    matchKey: matchKey,
  };
});
