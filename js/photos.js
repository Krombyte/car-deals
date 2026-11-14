/* Resize math and browser-side WebP compression for private-seller photos.
   Results are stored in Firestore, not Cloud Storage. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CarDealsPhotos = api;
})(typeof window !== "undefined" ? window : this, function () {
  var MAX_EDGE = 1280;
  var MAX_BYTES = 200 * 1024;
  var MAX_PHOTOS = 6;
  var PHOTO_TYPE = "image/webp";

  function fittedSize(width, height, maxEdge) {
    var w = Math.max(1, Math.round(Number(width) || 1));
    var h = Math.max(1, Math.round(Number(height) || 1));
    var cap = maxEdge || MAX_EDGE;
    var edge = Math.max(w, h);
    if (edge <= cap) return { width: w, height: h };
    var scale = cap / edge;
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    };
  }

  function appendLimited(current, incoming, max) {
    var next = (current || []).slice();
    var cap = max || MAX_PHOTOS;
    var dropped = 0;
    var i;
    for (i = 0; i < (incoming || []).length; i += 1) {
      if (next.length >= cap) {
        dropped += incoming.length - i;
        break;
      }
      next.push(incoming[i]);
    }
    return { items: next, dropped: dropped };
  }

  function encode(image, edge, quality, mime) {
    var size = fittedSize(image.naturalWidth || image.width, image.naturalHeight || image.height, edge);
    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return new Promise(function (resolve) {
      if (!canvas.toBlob) {
        resolve(null);
        return;
      }
      canvas.toBlob(function (blob) { resolve(blob); }, mime, quality);
    });
  }

  function compressFile(file) {
    if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type || "")) {
      return Promise.reject(new Error("type"));
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        var edges = [1280, 960, 720, 480];
        var qualities = [0.8, 0.65, 0.5, 0.4];
        var mimes = [PHOTO_TYPE, "image/jpeg"];
        var mimeIndex = 0;
        var edgeIndex = 0;
        var qualityIndex = 0;
        function next() {
          if (mimeIndex >= mimes.length) {
            reject(new Error("size"));
            return;
          }
          encode(image, edges[edgeIndex], qualities[qualityIndex], mimes[mimeIndex]).then(function (blob) {
            var mime = mimes[mimeIndex];
            if (blob && (blob.type === mime || blob.type === "") && blob.size > 0 && blob.size <= MAX_BYTES) {
              if (blob.type === mime) {
                resolve(blob);
                return;
              }
            }
            qualityIndex += 1;
            if (qualityIndex >= qualities.length) {
              qualityIndex = 0;
              edgeIndex += 1;
            }
            if (edgeIndex >= edges.length) {
              edgeIndex = 0;
              mimeIndex += 1;
            }
            next();
          }).catch(function () { reject(new Error("encode")); });
        }
        next();
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      image.src = url;
    });
  }

  return {
    MAX_EDGE: MAX_EDGE,
    MAX_BYTES: MAX_BYTES,
    MAX_PHOTOS: MAX_PHOTOS,
    PHOTO_TYPE: PHOTO_TYPE,
    fittedSize: fittedSize,
    appendLimited: appendLimited,
    compressFile: compressFile,
  };
});
