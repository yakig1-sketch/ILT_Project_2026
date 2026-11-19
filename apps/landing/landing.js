// ILT System landing page: texts in Hebrew, English and Japanese, the language and login menus, and About.
// Plain script, no build step. The chosen language is kept in this browser; Hebrew and English are also
// passed on to the staff apps (same key as packages/ui), so the cockpit and portal open in that language.
(function () {
  'use strict';

  var LANGS = ['he', 'en', 'ja'];
  var STORE = 'ilt.landing_language';
  var STAFF_STORE = 'ilt.ui_language';
  var uid = 0;

  function flag(lang) {
    var id = 'f' + (++uid);
    if (lang === 'he') {
      return '<svg viewBox="0 0 220 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="220" height="160" fill="#fff"/>' +
        '<rect y="15" width="220" height="25" fill="#0038b8"/><rect y="120" width="220" height="25" fill="#0038b8"/>' +
        '<g fill="none" stroke="#0038b8" stroke-width="5.5"><path d="M110 50 L136 95 L84 95 Z"/><path d="M110 110 L84 65 L136 65 Z"/></g></svg>';
    }
    if (lang === 'ja') {
      return '<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="300" height="200" fill="#fff"/><circle cx="150" cy="100" r="60" fill="#bc002d"/></svg>';
    }
    return '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<clipPath id="' + id + 's"><path d="M0,0 v30 h60 v-30 z"/></clipPath>' +
      '<clipPath id="' + id + 't"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>' +
      '<g clip-path="url(#' + id + 's)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/>' +
      '<path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>' +
      '<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#' + id + 't)" stroke="#C8102E" stroke-width="4"/>' +
      '<path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></g></svg>';
  }

  var T = {
    en: {
      name: 'English', dir: 'ltr', title: 'ILT System',
      'nav.about': 'About', 'nav.login': 'Login', 'nav.language': 'Language',
      'login.head': 'Sign in as',
      'role.evaluator': 'Evaluator', 'role.researcher': 'Researcher', 'role.analyst': 'Analyst', 'role.admin': 'System administrator', 'role.tablet': 'Child tablet',
      'hero.title': 'Invented Letter Task (ILT) System',
      'hero.subtitle': 'Procedural motor skill learning',
      'hero.tagline': 'For the children of the world',
      'hero.lead': 'The ILT system is a non-commercial, open-source platform for early screening and support of handwriting and learning difficulties. A child writes an invented letter again and again on a pen tablet, and the system measures how the new motor skill is learned and kept, in speed, accuracy and pen lifts, from Day 1 to Day 14. It also supports a follow-up intervention program with real letters.',
      'cta.login': 'Sign in', 'cta.about': 'About the system',
      'roles.title': 'One system, every role',
      'desc.evaluator': 'Runs sessions with the child on the tablet and watches the writing live.',
      'desc.researcher': 'Plans participants and sessions, and reviews results and summaries.',
      'desc.analyst': 'Works with de-identified research data: dashboards, replay and exports.',
      'desc.admin': 'Manages settings, canvases, users and the action log.',
      'card.go': 'Sign in',
      'team.title': 'Team', 'team.creator': 'Designed and created by', 'team.advisory': 'Academic research and clinical advisory',
      'name.yaki': 'Yaki Grossman', 'name.adijapha': 'Prof. Esther Adi-Japha', 'name.hollander': 'Dr. Chagit Hollander',
      'name.dorfberger': 'Dr. Shoshi Dorfberger', 'name.hochhauser': 'Dr. Michal Hochhauser',
      'aff.biu_edu': 'Faculty of Education, Bar-Ilan University',
      'aff.gonda': 'Gonda (Goldschmied) Multidisciplinary Brain Research Center, Bar-Ilan University',
      'aff.gordon': 'Gordon College of Education',
      'aff.ariel': 'Department of Occupational Therapy, Faculty of Health Sciences, Ariel University',
      'foot.copy': '© 2026 ILT System · Open source and non-commercial',
      'foot.support': 'Support:', 'foot.guides': 'User guides', guides: 'en',
      'about.title': 'About the ILT system', 'about.close': 'Close',
      about:
        '<h3>The Invented Letter Task</h3>' +
        '<p>In the Invented Letter Task (ILT), a child learns to write a letter that belongs to no alphabet: a simple shape that joins three dots. The child writes it again and again on a page of 15 boxes, in short blocks over three sessions (Day 1, Day 2 and Day 14). Because the letter is new to every child, it shows how quickly a new motor skill is learned and how well it is kept. This procedural learning is closely linked to learning to read and write.</p>' +
        '<h3>What the system measures</h3>' +
        '<p>The child writes with a pen on a tablet, and every pen sample is recorded. Each block is scored for speed, accuracy (passing through the dots in order) and pen lifts, with a combined score and the learning curve across the days. A replay shows exactly how each letter was written.</p>' +
        '<h3>Who uses it</h3>' +
        '<ul><li><b>Evaluators</b> run the sessions with the child and watch the writing live.</li>' +
        '<li><b>Researchers</b> plan participants and sessions and review the results.</li>' +
        '<li><b>Analysts</b> work with de-identified research data and export it for analysis.</li>' +
        '<li><b>System administrators</b> manage settings, canvases and users.</li></ul>' +
        '<h3>Intervention</h3>' +
        '<p>After screening, the system supports an intervention program with real letters, with suggested marks that the evaluator confirms.</p>' +
        '<h3>Privacy and ethics</h3>' +
        '<p>Research use requires a valid ethics approval and parental consent. Analysts see only de-identified data, and school names are never stored.</p>' +
        '<h3>Open and non-commercial</h3>' +
        '<p>The ILT system is open source and non-commercial, made for schools, clinics and researchers, with a focus on children from low socio-economic backgrounds. It works in Hebrew and English; Japanese is in preparation.</p>'
    },
    he: {
      name: 'עברית', dir: 'rtl', title: 'מערכת ILT',
      'nav.about': 'אודות', 'nav.login': 'כניסה', 'nav.language': 'שפה',
      'login.head': 'כניסה בתור',
      'role.evaluator': 'בוחן/ת', 'role.researcher': 'חוקר/ת', 'role.analyst': 'אנליסט/ית', 'role.admin': 'מנהל/ת מערכת', 'role.tablet': 'טאבלט הילד/ה',
      'hero.title': 'מערכת משימת האות המומצאת (ILT)',
      'hero.subtitle': 'למידה של מיומנות מוטורית פרוצדורלית',
      'hero.tagline': 'לילדי העולם',
      'hero.lead': 'מערכת ILT היא פלטפורמה ללא מטרות רווח ובקוד פתוח, לאיתור מוקדם ולתמיכה בקשיי כתיבה ולמידה. הילד/ה כותב/ת שוב ושוב אות מומצאת בעט על טאבלט, והמערכת מודדת איך המיומנות המוטורית החדשה נלמדת ונשמרת, במהירות, בדיוק ובהרמות העט, מיום 1 ועד יום 14. היא תומכת גם בתוכנית התערבות עם אותיות אמיתיות.',
      'cta.login': 'כניסה', 'cta.about': 'אודות המערכת',
      'roles.title': 'מערכת אחת, לכל תפקיד',
      'desc.evaluator': 'מנהל/ת מפגשים עם הילד/ה בטאבלט וצופה בכתיבה בזמן אמת.',
      'desc.researcher': 'מתכנן/ת משתתפים ומפגשים, וסוקר/ת תוצאות וסיכומים.',
      'desc.analyst': 'עובד/ת עם נתוני מחקר ללא פרטים מזהים: סקירה, הצגה חוזרת וייצוא.',
      'desc.admin': 'מנהל/ת הגדרות, קנבסים, משתמשים ויומן פעולות.',
      'card.go': 'כניסה',
      'team.title': 'הצוות', 'team.creator': 'תכנון ופיתוח', 'team.advisory': 'ייעוץ אקדמי, מחקרי וקליני',
      'name.yaki': 'יקי גרוסמן', 'name.adijapha': 'פרופ׳ אסתר עדי-יפה', 'name.hollander': 'ד״ר חגית הולנדר',
      'name.dorfberger': 'ד״ר שושי דורפברגר', 'name.hochhauser': 'ד״ר מיכל הוכהאוזר',
      'aff.biu_edu': 'הפקולטה לחינוך, אוניברסיטת בר-אילן',
      'aff.gonda': 'המרכז הרב-תחומי לחקר המוח ע״ש גונדה (גולדשמיד), אוניברסיטת בר-אילן',
      'aff.gordon': 'המכללה האקדמית לחינוך גורדון',
      'aff.ariel': 'המחלקה לריפוי בעיסוק, הפקולטה למדעי הבריאות, אוניברסיטת אריאל',
      'foot.copy': '© 2026 מערכת ILT · קוד פתוח, ללא מטרות רווח',
      'foot.support': 'תמיכה:', 'foot.guides': 'מדריכים למשתמש', guides: 'he',
      'about.title': 'אודות מערכת ILT', 'about.close': 'סגירה',
      about:
        '<h3>משימת האות המומצאת</h3>' +
        '<p>במשימת האות המומצאת (ILT) הילד/ה לומד/ת לכתוב אות שאינה שייכת לשום אלפבית: צורה פשוטה המחברת שלוש נקודות. הילד/ה כותב/ת אותה שוב ושוב בדף של 15 בתים, בבלוקים קצרים לאורך שלושה מפגשים (יום 1, יום 2 ויום 14). מכיוון שהאות חדשה לכל ילד/ה, היא מראה כמה מהר נלמדת מיומנות מוטורית חדשה וכמה טוב היא נשמרת. למידה פרוצדורלית זו קשורה הדוקות ללמידת הקריאה והכתיבה.</p>' +
        '<h3>מה המערכת מודדת</h3>' +
        '<p>הילד/ה כותב/ת בעט על טאבלט, וכל דגימה של העט נשמרת. כל בלוק מקבל ציון למהירות, לדיוק (מעבר בנקודות לפי הסדר) ולהרמות העט, עם ציון משוקלל ועקומת למידה לאורך הימים. הצגה חוזרת מראה בדיוק איך נכתבה כל אות.</p>' +
        '<h3>מי משתמש במערכת</h3>' +
        '<ul><li><b>בוחנים</b> מנהלים את המפגשים עם הילד/ה וצופים בכתיבה בזמן אמת.</li>' +
        '<li><b>חוקרים</b> מתכננים משתתפים ומפגשים וסוקרים את התוצאות.</li>' +
        '<li><b>אנליסטים</b> עובדים עם נתוני מחקר ללא פרטים מזהים ומייצאים אותם לניתוח.</li>' +
        '<li><b>מנהלי מערכת</b> מנהלים הגדרות, קנבסים ומשתמשים.</li></ul>' +
        '<h3>התערבות</h3>' +
        '<p>אחרי האיתור, המערכת תומכת בתוכנית התערבות עם אותיות אמיתיות, עם סימונים מוצעים שהבוחן/ת מאשר/ת.</p>' +
        '<h3>פרטיות ואתיקה</h3>' +
        '<p>שימוש מחקרי מחייב אישור אתיקה בתוקף והסכמת הורים. אנליסטים רואים רק נתונים ללא פרטים מזהים, ושמות בתי ספר לעולם אינם נשמרים.</p>' +
        '<h3>פתוחה וללא מטרות רווח</h3>' +
        '<p>מערכת ILT היא בקוד פתוח וללא מטרות רווח, ונבנתה לבתי ספר, למרפאות ולחוקרים, עם דגש על ילדים מרקע חברתי-כלכלי נמוך. היא פועלת בעברית ובאנגלית; יפנית בהכנה.</p>'
    },
    ja: {
      name: '日本語', dir: 'ltr', title: 'ILTシステム',
      'nav.about': '概要', 'nav.login': 'ログイン', 'nav.language': '言語',
      'login.head': 'ログインする立場',
      'role.evaluator': '評価者', 'role.researcher': '研究者', 'role.analyst': 'アナリスト', 'role.admin': 'システム管理者', 'role.tablet': '子ども用タブレット',
      'hero.title': 'つくった文字の課題（ILT）システム',
      'hero.subtitle': '手続き的な運動スキルの学習',
      'hero.tagline': '世界の子どもたちのために',
      'hero.lead': 'ILTシステムは、書字と学習のつまずきを早期に見つけ、支援するための非営利・オープンソースのプラットフォームです。子どもはペンタブレットで「つくった文字」をくり返し書き、システムは新しい運動スキルがどのように身につき、保たれるかを、速さ・正確さ・ペンの持ち上げ回数で、1日目から14日目まで測定します。実際の文字を使った支援プログラムにも対応しています。',
      'cta.login': 'ログイン', 'cta.about': 'システムの概要',
      'roles.title': 'ひとつのシステム、それぞれの役割',
      'desc.evaluator': 'タブレットで子どもとのセッションを行い、書く様子をリアルタイムで見守ります。',
      'desc.researcher': '参加者とセッションを計画し、結果とまとめを確認します。',
      'desc.analyst': '個人を特定できない研究データを扱います：概要、再生、エクスポート。',
      'desc.admin': '設定、キャンバス、ユーザー、操作ログを管理します。',
      'card.go': 'ログイン',
      'team.title': 'チーム', 'team.creator': '設計・開発', 'team.advisory': '学術研究・臨床アドバイザー',
      'name.yaki': 'Yaki Grossman', 'name.adijapha': 'Prof. Esther Adi-Japha', 'name.hollander': 'Dr. Chagit Hollander',
      'name.dorfberger': 'Dr. Shoshi Dorfberger', 'name.hochhauser': 'Dr. Michal Hochhauser',
      'aff.biu_edu': 'バル＝イラン大学 教育学部',
      'aff.gonda': 'バル＝イラン大学 ゴンダ（ゴールドシュミット）学際的脳研究センター',
      'aff.gordon': 'ゴードン教育大学',
      'aff.ariel': 'アリエル大学 健康科学部 作業療法学科',
      'foot.copy': '© 2026 ILTシステム・オープンソース、非営利',
      'foot.support': 'サポート：', 'foot.guides': '利用ガイド（英語）', guides: 'en',
      'about.title': 'ILTシステムの概要', 'about.close': '閉じる',
      about:
        '<h3>つくった文字の課題（ILT）</h3>' +
        '<p>ILTでは、子どもはどのアルファベットにも属さない文字、つまり3つの点を結ぶシンプルな形を書くことを学びます。子どもは15のマスがあるページにこの文字をくり返し書き、短いブロックに分けて3回のセッション（1日目、2日目、14日目）で取り組みます。どの子どもにとっても新しい文字なので、新しい運動スキルがどれだけ早く身につき、どれだけ保たれるかがわかります。この手続き的な学習は、読み書きの習得と深く関わっています。</p>' +
        '<h3>システムが測定すること</h3>' +
        '<p>子どもはタブレットにペンで書き、ペンのすべてのデータが記録されます。各ブロックは、速さ、正確さ（点を順番に通ること）、ペンの持ち上げ回数で採点され、総合スコアと日ごとの学習曲線が示されます。再生機能で、それぞれの文字がどのように書かれたかを正確に確認できます。</p>' +
        '<h3>利用者</h3>' +
        '<ul><li><b>評価者</b>：子どもとのセッションを行い、書く様子をリアルタイムで見守ります。</li>' +
        '<li><b>研究者</b>：参加者とセッションを計画し、結果を確認します。</li>' +
        '<li><b>アナリスト</b>：個人を特定できない研究データを扱い、分析のためにエクスポートします。</li>' +
        '<li><b>システム管理者</b>：設定、キャンバス、ユーザーを管理します。</li></ul>' +
        '<h3>支援プログラム</h3>' +
        '<p>スクリーニングの後、実際の文字を使った支援プログラムに対応し、評価者が確認する採点の提案を行います。</p>' +
        '<h3>プライバシーと倫理</h3>' +
        '<p>研究での利用には、有効な倫理審査の承認と保護者の同意が必要です。アナリストが見るのは個人を特定できないデータだけで、学校名は保存されません。</p>' +
        '<h3>オープンで非営利</h3>' +
        '<p>ILTシステムはオープンソースかつ非営利で、学校、クリニック、研究者のためにつくられ、社会経済的に恵まれない家庭の子どもたちに重点を置いています。現在はヘブライ語と英語に対応し、日本語は準備中です。</p>'
    }
  };

  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode: not kept */ } }
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function initialLang() {
    var saved = read(STORE);
    if (LANGS.indexOf(saved) >= 0) return saved;
    var nav = (navigator.language || 'en').toLowerCase();
    if (nav.indexOf('he') === 0 || nav.indexOf('iw') === 0) return 'he';
    if (nav.indexOf('ja') === 0) return 'ja';
    return 'en';
  }

  var $ = function (id) { return document.getElementById(id); };
  var current = 'en';

  function apply(lang) {
    var t = T[lang];
    current = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
    document.title = t.title;
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var v = t[el.getAttribute('data-t')];
      if (v !== undefined) el.textContent = v;
    });
    document.querySelectorAll('[data-t-label]').forEach(function (el) {
      el.setAttribute('aria-label', t[el.getAttribute('data-t-label')]);
    });
    $('about-body').innerHTML = t.about;
    $('lang-flag').innerHTML = flag(lang);
    $('lang-btn').setAttribute('aria-label', t['nav.language'] + ': ' + t.name);
    $('guides-link').href = '/cockpit/help/' + t.guides + '/index.html';
    document.querySelectorAll('#lang-menu button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-lang') === lang));
    });
    store(STORE, lang);
    // The staff apps speak Hebrew and English: pass the choice on (same origin, packages/ui key).
    if (lang === 'he' || lang === 'en') store(STAFF_STORE, lang);
  }

  // ----- menus -----
  function closeAll(except) {
    document.querySelectorAll('.menu-list').forEach(function (m) {
      if (m === except) return;
      m.hidden = true;
      var b = document.querySelector('[aria-controls="' + m.id + '"]');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }
  function toggle(btn, focusFirst) {
    var menu = $(btn.getAttribute('aria-controls'));
    var open = menu.hidden;
    closeAll(menu);
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open && focusFirst) { var first = menu.querySelector('a, button'); if (first) first.focus(); }
  }
  ['login-btn', 'lang-btn'].forEach(function (id) {
    $(id).addEventListener('click', function (e) { e.stopPropagation(); toggle($(id), e.detail === 0); });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu')) closeAll(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('.menu-list:not([hidden])');
    if (open) { closeAll(); var b = document.querySelector('[aria-controls="' + open.id + '"]'); if (b) b.focus(); }
  });
  document.querySelectorAll('.menu-list').forEach(function (menu) {
    menu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      var items = Array.prototype.slice.call(menu.querySelectorAll('a, button'));
      var i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
  });

  var langMenu = $('lang-menu');
  LANGS.forEach(function (l) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('data-lang', l);
    b.setAttribute('lang', l);
    b.innerHTML = '<span class="flag">' + flag(l) + '</span><span>' + T[l].name + '</span>';
    b.addEventListener('click', function () { apply(l); closeAll(); $('lang-btn').focus(); });
    langMenu.appendChild(b);
  });

  $('cta-login').addEventListener('click', function (e) {
    e.stopPropagation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if ($('login-menu').hidden) toggle($('login-btn'), true);
  });

  // ----- About -----
  var dlg = $('about');
  function openAbout() { closeAll(); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); $('about-body').scrollTop = 0; }
  $('about-btn').addEventListener('click', openAbout);
  $('cta-about').addEventListener('click', openAbout);
  $('about-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', function () { if (location.hash === '#about') history.replaceState(null, '', location.pathname); });

  apply(initialLang());
  if (location.hash === '#about') openAbout();
})();
