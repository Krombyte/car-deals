/* Focus trap for the listing, account, sell, and help dialogs. */
(function () {
  var stack = [];

  function focusables(dialog) {
    var nodes = dialog.querySelectorAll(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    );
    return Array.prototype.filter.call(nodes, function (node) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || node.disabled) return false;
      return node.getClientRects().length > 0;
    });
  }

  function setInert() {
    var top = stack.length ? stack[stack.length - 1].dialog : null;
    Array.prototype.forEach.call(document.body.children, function (child) {
      if (child.tagName === "SCRIPT") return;
      var keep = top && (child === top || child.contains(top));
      child.inert = Boolean(top) && !keep;
    });
  }

  function open(dialog) {
    if (!dialog || stack.some(function (entry) { return entry.dialog === dialog; })) return;
    stack.push({ dialog: dialog, focus: document.activeElement });
    dialog.hidden = false;
    document.body.classList.add("modal-open");
    setInert();
    var box = dialog.querySelector("[role='dialog']") || dialog;
    var preferred = dialog.querySelector("[data-autofocus]");
    var list = focusables(box);
    var target = preferred && !preferred.disabled ? preferred : list[0] || box;
    target.focus();
  }

  function close(dialog) {
    var index = -1;
    var i;
    for (i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].dialog === dialog) index = i;
    }
    if (index < 0) return;
    var entry = stack[index];
    stack.splice(index, 1);
    dialog.hidden = true;
    dialog.dispatchEvent(new CustomEvent("cardeals-close", { bubbles: true }));
    if (!stack.length) {
      document.body.classList.remove("modal-open");
      setInert();
      if (entry.focus && typeof entry.focus.focus === "function") entry.focus.focus();
    } else {
      setInert();
    }
  }

  function closeTop() {
    if (!stack.length) return false;
    close(stack[stack.length - 1].dialog);
    return true;
  }

  document.addEventListener("click", function (event) {
    var node = event.target;
    if (!node || !node.closest) return;
    var closer = node.closest("[data-close]");
    if (!closer) return;
    var dialog = document.getElementById(closer.getAttribute("data-close") || "");
    if (dialog) close(dialog);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Tab" || !stack.length) return;
    var dialog = stack[stack.length - 1].dialog;
    var box = dialog.querySelector("[role='dialog']") || dialog;
    var list = focusables(box);
    if (!list.length) {
      event.preventDefault();
      return;
    }
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.CarDealsA11y = { open: open, close: close, closeTop: closeTop };
})();
