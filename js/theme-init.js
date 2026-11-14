/* Apply the saved theme before first paint. No inline script, so a strict CSP can stay. */
(function () {
  var key = "carDealsTheme";
  var theme = null;
  try {
    theme = localStorage.getItem(key);
  } catch (err) {
    theme = null;
  }
  if (theme !== "light" && theme !== "dark") {
    var prefersLight = false;
    try {
      prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    } catch (err) {
      prefersLight = false;
    }
    theme = prefersLight ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#F4F6F8" : "#0B0F14");
})();
