/* Help button. Static FAQ when the model cannot answer. Replies are text only. */
(function () {
  var MAX_TURNS = 8;
  var history = [];
  var faqText = "";

  function plain(text, container) {
    container.replaceChildren();
    String(text || "").split("\n").forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return;
      var node = document.createElement(trimmed.charAt(0) === "#" ? "h3" : "p");
      node.textContent = trimmed.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "");
      container.appendChild(node);
    });
  }

  function note(left) {
    var node = document.getElementById("help-note");
    if (!node) return;
    var turns = history.filter(function (item) { return item.role === "user"; }).length;
    node.textContent = turns >= MAX_TURNS
      ? "That's the limit for this visit. The FAQ above still answers the common questions."
      : (MAX_TURNS - turns) + " questions left this visit. Answers are help text, not live prices.";
  }

  function addLine(role, text) {
    var log = document.getElementById("help-log");
    if (!log) return;
    var item = document.createElement("p");
    item.className = role === "user" ? "help-user" : "help-bot";
    item.textContent = (role === "user" ? "You: " : "") + text;
    log.appendChild(item);
  }

  function open() {
    var dialog = document.getElementById("help-dialog");
    var button = document.getElementById("help-btn");
    var cloud = window.CarDealsCloud;
    var chat = document.getElementById("help-chat");
    if (chat) chat.hidden = !(cloud && cloud.configured);
    if (button) button.setAttribute("aria-expanded", "true");
    if (window.CarDealsA11y) window.CarDealsA11y.open(dialog);
    note();
  }

  function loadFaq() {
    var url = new URL("FAQ.md", document.baseURI);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("faq");
      return res.text();
    }).then(function (text) {
      faqText = text;
      plain(text, document.getElementById("help-faq"));
      if (window.CarDealsCloud) window.CarDealsCloud.setFaq(text);
    }).catch(function () {
      var box = document.getElementById("help-faq");
      if (box) box.textContent = "The FAQ did not load. Refresh the page.";
    });
  }

  var button = document.getElementById("help-btn");
  if (button) button.addEventListener("click", open);
  var dialog = document.getElementById("help-dialog");
  if (dialog) {
    dialog.addEventListener("cardeals-close", function () {
      if (button) button.setAttribute("aria-expanded", "false");
    });
  }
  var form = document.getElementById("help-form");
  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("help-input");
      var send = document.getElementById("help-send");
      var question = input ? input.value.trim().slice(0, 400) : "";
      if (!question || !window.CarDealsCloud) return;
      var asked = history.filter(function (item) { return item.role === "user"; }).length;
      if (asked >= MAX_TURNS) { note(); return; }
      history.push({ role: "user", text: question });
      addLine("user", question);
      if (input) input.value = "";
      if (send) send.disabled = true;
      window.CarDealsCloud.ask(question, history.slice(0, -1)).then(function (result) {
        var reply = result && result.ok
          ? result.text
          : "The assistant isn't available yet. App Check and AI Logic still need to be turned on. Use the FAQ above. It does not invent prices.";
        history.push({ role: "assistant", text: reply });
        addLine("assistant", reply);
        note();
      }).catch(function () {
        addLine("assistant", "The assistant isn't available yet. Use the FAQ above.");
      }).then(function () {
        if (send) send.disabled = false;
      });
    });
  }
  loadFaq();
})();
