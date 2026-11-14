"use strict";

var assert = require("assert");
var photos = require("../js/photos.js");
var vehicles = require("../js/vehicles.js");
var data = require("../data/vehicles.json");

var first = photos.appendLimited(["a", "b"], ["c", "d"], 6);
assert.deepStrictEqual(first.items, ["a", "b", "c", "d"]);
assert.strictEqual(first.dropped, 0);

var capped = photos.appendLimited(["a", "b", "c", "d", "e"], ["f", "g"], 6);
assert.deepStrictEqual(capped.items, ["a", "b", "c", "d", "e", "f"]);
assert.strictEqual(capped.dropped, 1);

var years = vehicles.years();
assert.strictEqual(years[0], String(new Date().getFullYear()));
assert.strictEqual(years[years.length - 1], "1950");
assert.strictEqual(vehicles.digitsOnly("$12,000 mi", 7), "12000");
assert.deepStrictEqual(vehicles.filterOptions(["Ford", "Fiat", "Honda"], "fo"), ["Ford"]);
assert.ok(vehicles.modelsFor(data, "ford").indexOf("Mustang") !== -1);
assert.ok(vehicles.trimsFor(data, "Ford", "Mustang").indexOf("GT") !== -1);
assert.deepStrictEqual(vehicles.modelsFor(data, "Not A Brand"), []);
assert.deepStrictEqual(vehicles.trimsFor(data, "Ford", "Custom Model"), []);

console.log("sell fields ok");
