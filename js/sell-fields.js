/* Sell-form helpers: year list, make/model/trim suggestions, and a photo
   list that grows when the person picks more files. */
(function () {
  var vehicles = { makes: [], models: {}, trims: {} };
  var photos = [];
  var photoKey = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function fillYears() {
    var list = $("sell-year-list");
    if (!list || !window.CarDealsVehicles) return;
    list.replaceChildren();
    window.CarDealsVehicles.years().forEach(function (year) {
      var option = document.createElement("option");
      option.value = year;
      list.appendChild(option);
    });
  }

  function renderList(listId, items, onPick) {
    var list = $(listId);
    if (!list) return;
    list.replaceChildren();
    if (!items.length) {
      list.hidden = true;
      return;
    }
    items.slice(0, 12).forEach(function (name) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.addEventListener("mousedown", function (event) { event.preventDefault(); });
      button.addEventListener("click", function () { onPick(name); });
      item.appendChild(button);
      list.appendChild(item);
    });
    list.hidden = false;
  }

  function hideList(id) {
    var list = $(id);
    if (list) list.hidden = true;
  }

  function syncModelVisibility() {
    var wrap = $("sell-model-wrap");
    var make = $("sell-make") ? $("sell-make").value.trim() : "";
    if (wrap) wrap.hidden = !make;
  }

  function bindCombo(inputId, listId, optionsFn, onChoose) {
    var input = $(inputId);
    if (!input) return;
    function refresh() {
      var options = optionsFn();
      var shown = window.CarDealsVehicles.filterOptions(options, input.value);
      renderList(listId, shown, function (name) {
        input.value = name;
        hideList(listId);
        if (onChoose) onChoose(name);
      });
    }
    input.addEventListener("focus", refresh);
    input.addEventListener("input", refresh);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hideList(listId);
    });
    input.addEventListener("blur", function () {
      window.setTimeout(function () { hideList(listId); }, 150);
    });
  }

  function renderPhotos() {
    var list = $("sell-photo-list");
    var note = $("sell-photo-note");
    if (!list) return;
    list.replaceChildren();
    photos.forEach(function (item) {
      var li = document.createElement("li");
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = "";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.setAttribute("aria-label", "Remove photo");
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        URL.revokeObjectURL(item.url);
        photos = photos.filter(function (photo) { return photo.key !== item.key; });
        renderPhotos();
      });
      li.appendChild(img);
      li.appendChild(remove);
      list.appendChild(li);
    });
    if (note) {
      note.textContent = photos.length
        ? photos.length + " of 6 photos. Choose photos again to add more."
        : "Up to 6 photos. Choosing more adds to this list.";
    }
  }

  function addPhotoFiles(fileList) {
    var incoming = [];
    Array.prototype.forEach.call(fileList || [], function (file) {
      photoKey += 1;
      incoming.push({ key: photoKey, file: file, url: URL.createObjectURL(file) });
    });
    var merged = window.CarDealsPhotos.appendLimited(photos, incoming, 6);
    var kept = {};
    merged.items.forEach(function (item) { kept[item.key] = true; });
    incoming.forEach(function (item) {
      if (!kept[item.key]) URL.revokeObjectURL(item.url);
    });
    photos = merged.items;
    renderPhotos();
    var note = $("sell-photo-note");
    if (note && merged.dropped) {
      note.textContent = "Only 6 photos can be attached. " + photos.length + " are kept.";
    }
  }

  function bindPhotos() {
    var input = $("sell-photos");
    var button = $("sell-photos-choose");
    if (!input || !button) return;
    input.addEventListener("click", function (event) { event.stopPropagation(); });
    button.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      addPhotoFiles(input.files);
      input.value = "";
    });
    renderPhotos();
  }

  function digits(id, limit) {
    var input = $(id);
    if (!input) return;
    input.addEventListener("input", function () {
      var next = window.CarDealsVehicles.digitsOnly(input.value, limit);
      if (next !== input.value) input.value = next;
    });
  }

  function bind() {
    fillYears();
    digits("sell-year", 4);
    digits("sell-price", 7);
    digits("sell-miles", 7);
    bindCombo("sell-make", "sell-make-list", function () { return vehicles.makes || []; }, function () {
      var model = $("sell-model");
      var trim = $("sell-trim");
      if (model) model.value = "";
      if (trim) trim.value = "";
      syncModelVisibility();
    });
    var make = $("sell-make");
    if (make) {
      make.addEventListener("input", syncModelVisibility);
    }
    bindCombo("sell-model", "sell-model-list", function () {
      var typed = $("sell-make") ? $("sell-make").value : "";
      return window.CarDealsVehicles.modelsFor(vehicles, typed);
    }, function () {
      var trim = $("sell-trim");
      if (trim) trim.value = "";
    });
    bindCombo("sell-trim", "sell-trim-list", function () {
      return window.CarDealsVehicles.trimsFor(
        vehicles,
        $("sell-make") ? $("sell-make").value : "",
        $("sell-model") ? $("sell-model").value : ""
      );
    });
    bindPhotos();
    syncModelVisibility();
  }

  function load() {
    var url = new URL("data/vehicles.json", document.baseURI);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("vehicles");
      return res.json();
    }).then(function (data) {
      vehicles = data || vehicles;
    }).catch(function () {
      vehicles = { makes: [], models: {}, trims: {} };
    }).then(bind);
  }

  window.CarDealsSell = {
    files: function () { return photos.map(function (item) { return item.file; }); },
    resetPhotos: function () {
      photos.forEach(function (item) { URL.revokeObjectURL(item.url); });
      photos = [];
      renderPhotos();
    },
  };

  if (document.getElementById("sell-year")) load();
})();
