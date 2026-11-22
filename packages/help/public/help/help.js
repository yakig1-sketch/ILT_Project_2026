// ILT user guides: the theme passed by the app (?theme=dark|light), the compact view inside the
// cockpit's help panel (?embed=1), and the links to the same section in the other languages.
(function () {
  var q = new URLSearchParams(location.search);
  var root = document.documentElement;
  var theme = q.get('theme');
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
  if (q.get('embed') === '1') root.classList.add('embed');
  // The language of the guide being read is remembered, so the Help button opens Japanese guides for a
  // reader who chose them (the staff screens themselves are in Hebrew or English).
  try { localStorage.setItem('ilt.help_language', root.getAttribute('lang') || 'en'); } catch (e) { /* not kept */ }
  document.addEventListener('DOMContentLoaded', function () {
    var others = document.querySelectorAll('[data-other-language]');
    if (!others.length) return;
    var update = function () {
      others.forEach(function (other) {
        var base = other.getAttribute('data-other-language');
        other.setAttribute('href', base + location.search + location.hash);
      });
    };
    update();
    window.addEventListener('hashchange', update);
  });
})();
