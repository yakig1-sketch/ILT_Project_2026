// ILT user guides: the theme passed by the app (?theme=dark|light), the compact view inside the
// cockpit's help panel (?embed=1), and the link to the same section in the other language.
(function () {
  var q = new URLSearchParams(location.search);
  var root = document.documentElement;
  var theme = q.get('theme');
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
  if (q.get('embed') === '1') root.classList.add('embed');
  document.addEventListener('DOMContentLoaded', function () {
    var other = document.querySelector('[data-other-language]');
    if (!other) return;
    var update = function () {
      var base = other.getAttribute('data-other-language');
      other.setAttribute('href', base + location.search + location.hash);
    };
    update();
    window.addEventListener('hashchange', update);
  });
})();
