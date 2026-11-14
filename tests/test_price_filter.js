"use strict";

var assert = require("assert");
var filters = require("../js/price-filter.js");
var photos = require("../js/photos.js");

assert.strictEqual(filters.matchesPrice(4000, "", ""), true);
assert.strictEqual(filters.matchesPrice(4000, "1000", "5000"), true);
assert.strictEqual(filters.matchesPrice(4000, "5000", ""), false);
assert.strictEqual(filters.matchesPrice(9000, "", "5000"), false);
assert.strictEqual(filters.matchesPrice(3000, "8000", "2000"), true);
assert.strictEqual(filters.presetMax("under5k"), "5000");
assert.strictEqual(filters.presetMax("under10k"), "10000");
assert.strictEqual(filters.presetMax("under20k"), "20000");
assert.strictEqual(filters.presetMax("under60k"), "60000");
assert.strictEqual(filters.activePreset("", "5000"), "under5k");
assert.strictEqual(filters.activePreset("", "10000"), "under10k");
assert.strictEqual(filters.activePreset("1000", "5000"), "");
assert.strictEqual(filters.activePreset("", "12345"), "");
assert.strictEqual(filters.digitsOnly("$12a000"), "12000");
assert.strictEqual(filters.parseBound(""), null);
assert.strictEqual(filters.parseBound("2500"), 2500);

[1, 12, 1111, 1234, 12345, 9999, 1212, 4321].forEach(function (price) {
  assert.strictEqual(filters.isPlaceholderPrice(price), true, String(price));
});
[500, 1999, 2500, 5000, 10000, 15500, 60000].forEach(function (price) {
  assert.strictEqual(filters.isPlaceholderPrice(price), false, String(price));
});

assert.deepStrictEqual(photos.fittedSize(4000, 2000, 1280), { width: 1280, height: 640 });
assert.deepStrictEqual(photos.fittedSize(800, 600, 1280), { width: 800, height: 600 });
assert.deepStrictEqual(photos.fittedSize(100, 3000, 1280), { width: 43, height: 1280 });
assert.strictEqual(photos.MAX_PHOTOS, 6);
assert.strictEqual(photos.MAX_EDGE, 1280);
assert.strictEqual(photos.MAX_BYTES, 200 * 1024);
assert.strictEqual(photos.PHOTO_TYPE, "image/webp");

console.log("price filter and photo limits ok");
