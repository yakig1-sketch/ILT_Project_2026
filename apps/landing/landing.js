// ILT System landing page: texts in English, Hebrew and Japanese, the Login and Language menus, About,
// and the 3-dot stroke preview. Plain script, no build step. The chosen language is kept in this browser;
// Hebrew and English are also passed on to the staff apps (same key as packages/ui), so the cockpit and
// the analyst portal open in that language.
(function () {
  'use strict';

  var LANGS = ['en', 'he', 'ja'];
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
      langName: 'English', dir: 'ltr', guides: 'en',
      title: 'Invented Letter Task (ILT) System',
      skip: 'Skip to content',
      brandTitle: 'ILT System', brandSub: 'Open-Source Research Platform',
      about: 'About', login: 'Login', language: 'Language', loginHeader: 'Select User Portal',
      'role.evaluator': 'Evaluator', 'role.analyst': 'Analyst', 'role.researcher': 'Researcher', 'role.admin': 'Sys. Admin', 'role.tablet': "Child's tablet",
      'desc.evaluator': 'Conduct live 1:1 or small-group student tablet sessions and clinical scoring.',
      'desc.analyst': 'Inspect de-identified 240Hz kinematic replays and longitudinal cohort slices.',
      'desc.researcher': 'Configure protocol timers, canonical letter models, and study governance.',
      'desc.admin': 'Manage system users, districts, templates, and infrastructure health.',
      'desc.tablet': 'The pen tablet the child writes on, paired with a session code.',
      heroBadge: 'For the children of the world',
      heroTitle: 'Invented Letter Task (ILT) System',
      heroSubtitle: 'Procedural motor skill learning',
      heroDesc: 'The ILT system is a non-commercial open-source platform designed for early screening and remediation of literacy and graphomotor difficulties in elementary school children. Grounded in over a decade of neurocognitive research on the Procedural Learning System (PLS), it transforms the validated Invented Letter Task into a precise 240Hz digital assessment accessible across languages and socioeconomic backgrounds.',
      heroAboutBtn: 'Read About the Research', heroDemoBtn: 'Preview ILT Stroke',
      creditLabel: 'Designed and created by:',
      photoAlt: 'A child writing in a notebook',
      previewTitle: 'ILT 3-Dot Continuous Stroke', previewSub: 'Learning (Day 1) → Automaticity (Week 2)', replay: 'Replay',
      advisoryHeading: 'Academic Research and Clinical Advisory',
      advisorySubheading: 'Empirical neurocognitive research & clinical leadership',
      sponsorsHeading: 'Sponsorship & Research Partners',
      sponsorsSubheading: 'Click any partner logo to view sponsorship details',
      visitWebsite: 'Visit website ↗',
      'sp.wacom': 'Pen tablets and digital pen technology for recording children\'s handwriting.',
      'sp.wondernet': 'Technology and development partner of the ILT system.',
      'sp.penflow': 'Core open-source architecture & 240Hz digital ink engineering sponsorship.',
      'sp.kaku': 'Donates EMR stylus tablets and classroom pilot hardware kits.',
      'sp.literacy': 'Funds cross-linguistic screening studies in underserved elementary schools.',
      'sp.neuro': 'Sponsors secure academic cloud hosting and de-identified Parquet analytics.',
      'sp.brightstart': 'Supports field pilot coordination across partner elementary classrooms.',
      'sp.openink': 'Sponsors multilingual localization and accessibility testing for young learners.',
      'name.yaki': 'Yaki Grossman', 'name.adijapha': 'Prof. Esther Adi-Japha', 'name.hollander': 'Dr. Chagit Hollander',
      'name.dorfberger': 'Dr. Shoshi Dorfberger', 'name.hochhauser': 'Dr. Michal Hochhauser',
      'aff.biu_edu': 'Faculty of Education, Bar-Ilan University',
      'aff.gonda': 'Gonda (Goldschmied) Multidisciplinary Brain Research Center, Bar-Ilan University',
      'aff.gordon': 'Gordon College of Education',
      'aff.ariel': 'Dept. of Occupational Therapy, Faculty of Health Sciences, Ariel University',
      footerCopyright: '© 2026 Invented Letter Task (ILT) Open-Source Initiative. Non-Commercial Educational Research Platform.',
      footerSupport: 'Support & Collaboration:', footerGuides: 'User guides',
      aboutTitle: 'About the Invented Letter Task (ILT) System', close: 'Close',
      aboutHtml:
        '<p><strong>What the Research Examined:</strong> Grounded in longitudinal research by Dr. Chagit Hollander, Prof. Esther Adi-Japha, Dr. Shoshi Dorfberger, and Dr. Michal Hochhauser (2025), the Invented Letter Task (ILT) isolates pure <em>procedural motor skill learning</em>—the ability to acquire and stabilize a novel writing movement across time.</p>' +
        '<p><strong>Key Scientific Findings:</strong> Across 124 second-grade students from low-SES schools, Day 1 skill acquisition (<em>Learning phase</em>) and 2-week post-training retention (<em>Automaticity phase</em>) significantly predicted end-of-year reading comprehension (R² = 36%) and written expression (R² = 49%), as well as early risk for literacy impairments.</p>' +
        '<p><strong>Digital Ecological Validity:</strong> Built as an open-source, non-commercial platform, the ILT system captures 240Hz digital ink kinematics while preserving authentic classroom notebook layouts across Hebrew, English, and Japanese.</p>'
    },
    he: {
      langName: 'עברית', dir: 'rtl', guides: 'he',
      title: 'מערכת Invented Letter Task (ILT)',
      skip: 'דילוג לתוכן',
      brandTitle: 'מערכת ILT', brandSub: 'פלטפורמת מחקר בקוד פתוח',
      about: 'אודות', login: 'התחברות', language: 'שפה', loginHeader: 'בחירת עמדת משתמש',
      'role.evaluator': 'בוחן / מאבחן', 'role.analyst': 'אנליסט מחקר', 'role.researcher': 'חוקר ראשי', 'role.admin': 'מנהל מערכת', 'role.tablet': 'טאבלט הילד/ה',
      'desc.evaluator': 'ניהול מפגשי אבחון חיים בטאבלט (1:1 או קבוצה קטנה) ומילוי קריטריונים.',
      'desc.analyst': 'שחזור קינמטי מלא של כתיבה ב-240Hz וניתוח חיתוכי נתונים מותממים.',
      'desc.researcher': 'הגדרת פרוטוקולי מחקר, טיימרים, מודלי אותיות ומשילות מערכת.',
      'desc.admin': 'ניהול משתמשים, מחוזות, תבניות כתיבה ותשתית המערכת.',
      'desc.tablet': 'הטאבלט שעליו הילד/ה כותב/ת בעט, מצומד למפגש בקוד.',
      heroBadge: 'למען ילדי העולם',
      heroTitle: 'מערכת Invented Letter Task (ILT)',
      heroSubtitle: 'למידה פרוצדורלית של מיומנות מוטורית',
      heroDesc: 'מערכת ILT היא פלטפורמה אקדמית לא-מסחרית בקוד פתוח, המיועדת לאיתור מוקדם ולמניעת לקויות קריאה וכתיבה בקרב ילדי בית הספר היסודי. המערכת מבוססת על למעלה מעשור של מחקר נוירו-קוגניטיבי על מערכת הלמידה הפרוצדורלית (PLS), וממירה את משימת האות המומצאת לאבחון דיגיטלי מדויק בקצב 240Hz הנגיש במגוון שפות ורקעים.',
      heroAboutBtn: 'קראו עוד על המחקר', heroDemoBtn: 'הדגמת משיכת ILT',
      creditLabel: 'אפיון, עיצוב ופיתוח:',
      photoAlt: 'ילד כותב במחברת',
      previewTitle: 'משיכת עט רציפה ב-3 נקודות', previewSub: 'למידה (יום 1) ← אוטומטיות (שבוע 2)', replay: 'נגן שוב',
      advisoryHeading: 'מחקר אקדמי וייעוץ קליני',
      advisorySubheading: 'הובלה מדעית ומחקר נוירו-קוגניטיבי אמפירי',
      sponsorsHeading: 'נותני חסות ושותפי מחקר',
      sponsorsSubheading: 'לחצו על כל לוגו לצפייה בפרטי החסות ובקישור לאתר',
      visitWebsite: 'לאתר השותף ↗',
      'sp.wacom': 'טאבלטים ועטים דיגיטליים לתיעוד כתב היד של הילדים.',
      'sp.wondernet': 'שותף טכנולוגי ופיתוח של מערכת ILT.',
      'sp.penflow': 'חסות הנדסית לארכיטקטורת הקוד הפתוח וללכידת דיו דיגיטלי ב-240Hz.',
      'sp.kaku': 'תרומת טאבלטים עם עט EMR וערכות חומרה לפיילוטים בכיתות.',
      'sp.literacy': 'מימון מחקרי איתור רב-לשוניים בבתי ספר יסודיים מוחלשים.',
      'sp.neuro': 'חסות לאירוח ענן מחקרי מאובטח ולניתוח נתונים מותממים.',
      'sp.brightstart': 'סיוע בתיאום פיילוטים בשטח מול בתי ספר יסודיים שותפים.',
      'sp.openink': 'תמיכה בהתאמת שפות ונגישות עבור תלמידים צעירים.',
      'name.yaki': 'יקי גרוסמן', 'name.adijapha': 'פרופ׳ אסתר עדי-יפה', 'name.hollander': 'ד״ר חגית הולנדר',
      'name.dorfberger': 'ד״ר שושי דורפברגר', 'name.hochhauser': 'ד״ר מיכל הוכהאוזר',
      'aff.biu_edu': 'הפקולטה לחינוך, אוניברסיטת בר-אילן',
      'aff.gonda': 'המרכז הרב-תחומי לחקר המוח ע״ש גונדה (גולדשמיד), אוניברסיטת בר-אילן',
      'aff.gordon': 'המכללה האקדמית לחינוך גורדון',
      'aff.ariel': 'המחלקה לריפוי בעיסוק, הפקולטה למדעי הבריאות, אוניברסיטת אריאל',
      footerCopyright: '© 2026 יוזמת הקוד הפתוח ILT. פלטפורמת מחקר חינוכית לא-מסחרית.',
      footerSupport: 'תמיכה ושיתופי פעולה:', footerGuides: 'מדריכים למשתמש',
      aboutTitle: 'אודות מערכת ILT והמחקר המדעי', close: 'סגירה',
      aboutHtml:
        '<p><strong>מה בחן המחקר:</strong> בהסתמך על מחקר האורך של ד"ר חגית הולנדר, פרופ\' אסתר עדי-יפה, ד"ר שושי דורפברגר וד"ר מיכל הוכהאוזר (2025), משימת האות המומצאת (ILT) מבודדת <em>למידה מוטורית פרוצדורלית</em> נקייה — היכולת לרכוש ולייצב מיומנות כתיבה חדשה לאורך זמן.</p>' +
        '<p><strong>ממצאים מרכזיים:</strong> במעקב אחר 124 תלמידי כיתה ב\' מרקע סוציו-אקונומי נמוך, הישגי היום הראשון (<em>שלב הלמידה</em>) והביצוע לאחר שבועיים (<em>שלב האוטומטיות</em>) ניבאו באופן מובהק את הבנת הנקרא (R² = 36%) וההבעה בכתב (R² = 49%) בסוף השנה, וכן סיכון מוקדם ללקויות אוריינות.</p>' +
        '<p><strong>תקפות אקולוגית דיגיטלית:</strong> כפלטפורמת קוד פתוח לא-מסחרית, המערכת דוגמת תנועות עט בקצב 240Hz תוך שמירה על תבניות מחברת אותנטיות בעברית, באנגלית וביפנית.</p>'
    },
    ja: {
      langName: '日本語', dir: 'ltr', guides: 'en',
      title: 'Invented Letter Task (ILT) システム',
      skip: '本文へ移動',
      brandTitle: 'ILT システム', brandSub: 'オープンソース研究プラットフォーム',
      about: 'システムについて', login: 'ログイン', language: '言語', loginHeader: 'ユーザーポータルを選択',
      'role.evaluator': '検査者 (Evaluator)', 'role.analyst': '分析者 (Analyst)', 'role.researcher': '研究者 (Researcher)', 'role.admin': 'システム管理者', 'role.tablet': '子ども用タブレット',
      'desc.evaluator': '1対1または少人数でのタブレット検査と行動チェックリストを管理します。',
      'desc.analyst': '匿名化された240Hz筆跡データの再生とコホート分析を行います。',
      'desc.researcher': 'タイマー設定、基準文字モデル、研究ガバナンスを管理します。',
      'desc.admin': 'ユーザー権限、地域ドメイン、テンプレート設定を管理します。',
      'desc.tablet': '子どもがペンで書くタブレット（セッションコードで接続）。',
      heroBadge: '世界の子どもたちのために',
      heroTitle: 'Invented Letter Task (ILT) システム',
      heroSubtitle: '手続き的運動スキル学習（Procedural motor skill learning）',
      heroDesc: 'ILTシステムは、小学生の読み書き・書字運動の困難を早期に発見し支援するための、非営利・オープンソースの教育研究プラットフォームです。手続き的学習システム（PLS）に関する10年以上の神経認知研究に基づき、新奇文字課題（ILT）を240Hzの高精度デジタルインク評価として実現しました。',
      heroAboutBtn: '研究の背景を読む', heroDemoBtn: 'ILTストロークを見る',
      creditLabel: '設計・開発:',
      photoAlt: 'ノートに字を書く子ども',
      previewTitle: 'ILT 3点連続ストローク', previewSub: '学習期（1日目）→ 自動化期（2週間後）', replay: '再生',
      advisoryHeading: '学術研究・臨床アドバイザリー',
      advisorySubheading: '実証的神経認知研究および臨床監修チーム',
      sponsorsHeading: 'スポンサー・研究パートナー',
      sponsorsSubheading: 'ロゴをクリックすると協賛内容と公式サイトへのリンクが表示されます',
      visitWebsite: '公式サイトへ ↗',
      'sp.wacom': '子どもの筆跡を記録するペンタブレットとデジタルペン技術。',
      'sp.wondernet': 'ILTシステムの技術・開発パートナー。',
      'sp.penflow': 'オープンソース基盤設計および240Hzデジタルインク技術の支援。',
      'sp.kaku': 'EMRスタイラス対応タブレットおよび小学校パイロット用機材の寄贈。',
      'sp.literacy': '低SES地域の小学校における多言語スクリーニング研究への助成。',
      'sp.neuro': '安全な研究用クラウド環境と匿名化Parquet分析基盤の提供。',
      'sp.brightstart': '協力小学校でのフィールドパイロット実施・調整の支援。',
      'sp.openink': '多言語ローカライズおよび年少児童向けアクセシビリティ検証の支援。',
      'name.yaki': 'Yaki Grossman', 'name.adijapha': 'Prof. Esther Adi-Japha', 'name.hollander': 'Dr. Chagit Hollander',
      'name.dorfberger': 'Dr. Shoshi Dorfberger', 'name.hochhauser': 'Dr. Michal Hochhauser',
      'aff.biu_edu': 'バル＝イラン大学 教育学部',
      'aff.gonda': 'バル＝イラン大学 ゴンダ（ゴールドシュミット）学際的脳研究センター',
      'aff.gordon': 'ゴードン教育大学',
      'aff.ariel': 'アリエル大学 健康科学部 作業療法学科',
      footerCopyright: '© 2026 Invented Letter Task (ILT) オープンソース・イニシアチブ（非営利教育研究基盤）',
      footerSupport: 'お問い合わせ・サポート:', footerGuides: '利用ガイド（英語）',
      aboutTitle: 'ILTシステムと背景研究について', close: '閉じる',
      aboutHtml:
        '<p><strong>研究の目的:</strong> Hollander, Adi-Japha, Dorfberger, Hochhauser (2025) の縦断研究に基づき、新奇文字課題（ILT）は既存の文字知識に左右されない純粋な<em>手続き的運動スキル学習</em>（新しい書字運動の獲得と定着）を測定します。</p>' +
        '<p><strong>主な研究成果:</strong> 低SES地域の小学2年生124名を対象とした研究では、1日目の学習達成度（<em>学習期</em>）と2週間後の保持（<em>自動化期</em>）が、学年末の読解力（R² = 36%）および作文表現力（R² = 49%）と読み書き困難のリスクを有意に予測しました。</p>' +
        '<p><strong>生態学的妥当性の確保:</strong> 非営利のオープンソース基盤として、ヘブライ語・英語・日本語（縦書き・国語マス目）の自然なノート形式を保ちながら、240Hzのペン軌跡データを記録します。</p>'
    }
  };

  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode: not kept */ } }
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function initialLang() {
    var q = (location.search.match(/[?&]lang=(he|en|ja)\b/) || [])[1];
    if (q) return q;
    var s = read(STORE);
    if (s && T[s]) return s;
    var nav = (navigator.languages || [navigator.language || 'en']).map(function (l) { return String(l).slice(0, 2).toLowerCase(); });
    for (var i = 0; i < nav.length; i++) { if (nav[i] === 'iw') return 'he'; if (T[nav[i]]) return nav[i]; }
    return 'en';
  }

  var $ = function (id) { return document.getElementById(id); };
  var current = 'en';

  function apply(lang) {
    var t = T[lang] || T.en;
    current = T[lang] ? lang : 'en';
    document.documentElement.lang = current;
    document.documentElement.dir = t.dir;
    document.title = t.title;
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var v = t[el.getAttribute('data-t')];
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-t-label]').forEach(function (el) { el.setAttribute('aria-label', t[el.getAttribute('data-t-label')]); });
    document.querySelectorAll('[data-t-alt]').forEach(function (el) { el.setAttribute('alt', t[el.getAttribute('data-t-alt')]); });
    document.querySelectorAll('#login-menu [data-role]').forEach(function (a) { a.title = t['desc.' + a.getAttribute('data-role')]; });
    document.querySelector('#login-menu .mi-tablet').title = t['desc.tablet'];
    $('lang-flag').innerHTML = flag(current);
    $('lang-name').textContent = t.langName;
    $('lang-btn').setAttribute('aria-label', t.language + ': ' + t.langName);
    $('about-body').innerHTML = t.aboutHtml;
    $('guides-link').href = '/cockpit/help/' + t.guides + '/index.html';
    document.querySelectorAll('#lang-menu button').forEach(function (b) {
      b.setAttribute('aria-current', b.getAttribute('data-lang') === current ? 'true' : 'false');
    });
    store(STORE, current);
    // The staff apps speak Hebrew and English only; Japanese leaves their language as it was.
    if (current === 'he' || current === 'en') store(STAFF_STORE, current);
  }

  // Menus: Login and Language. Click or Enter opens; Escape, a click outside or Tab away closes.
  function closeAll(except) {
    document.querySelectorAll('.menu-list').forEach(function (m) {
      if (m === except) return;
      m.hidden = true;
      var b = document.querySelector('[aria-controls="' + m.id + '"]');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }
  function items(menu) { return Array.prototype.slice.call(menu.querySelectorAll('a, button')); }
  function toggle(btn, focusFirst) {
    var menu = $(btn.getAttribute('aria-controls'));
    var open = menu.hidden;
    closeAll(menu);
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && focusFirst) items(menu)[0].focus();
  }
  ['login-btn', 'lang-btn'].forEach(function (id) {
    $(id).addEventListener('click', function (e) { e.stopPropagation(); toggle($(id), e.detail === 0); });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu')) closeAll(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('.menu-list:not([hidden])');
    if (open) { closeAll(); document.querySelector('[aria-controls="' + open.id + '"]').focus(); }
  });
  document.querySelectorAll('.menu-list').forEach(function (menu) {
    menu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      var list = items(menu);
      var i = list.indexOf(document.activeElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
    });
    menu.addEventListener('focusout', function (e) { if (!menu.parentNode.contains(e.relatedTarget)) closeAll(); });
  });

  LANGS.forEach(function (l) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('data-lang', l);
    b.setAttribute('lang', l);
    b.innerHTML = '<span class="flag">' + flag(l) + '</span><span class="mi-label">' + T[l].langName + '</span>';
    b.addEventListener('click', function () { apply(l); closeAll(); $('lang-btn').focus(); });
    $('lang-menu').appendChild(b);
  });

  // Sponsors: a logo button each; a click opens a small card with the details and the website.
  var SPONSORS = [
    { id: 'wacom', label: 'Wacom', name: 'Wacom', url: 'https://www.wacom.com/en-us', real: true, logo: 'sponsors/wacom.png', w: 242, h: 38, color: '#16324f',
      icon: '<rect x="3" y="8" width="19" height="15" rx="2.5"/><path d="M28.5 4.5L18.5 18.5"/><path d="M18.5 18.5L17.5 21.5L20.2 19.8"/>' },
    { id: 'wondernet', label: 'WonderNet', name: 'WonderNet', url: 'https://www.wondernet.co.il/about/', real: true, logo: 'sponsors/wondernet.png', w: 480, h: 164, color: '#0369a1',
      icon: '<circle cx="16" cy="16" r="3"/><circle cx="6" cy="8" r="2.5"/><circle cx="26" cy="8" r="2.5"/><circle cx="6" cy="24" r="2.5"/><circle cx="26" cy="24" r="2.5"/><path d="M8 9.5L13.5 14M24 9.5L18.5 14M8 22.5L13.5 18M24 22.5L18.5 18"/>' },
    { id: 'penflow', label: 'PenFlow Org', name: 'PenFlow Foundation', url: 'https://penflow.com', color: '#16324f',
      icon: '<path d="M22 4L28 10L12 26H6V20L22 4Z"/><path d="M18 8L24 14"/>' },
    { id: 'kaku', label: 'Kaku EduTech', name: 'Kaku EduTech', url: 'https://example.org/kaku-edutech', color: '#d97706',
      icon: '<rect x="5" y="5" width="22" height="22" rx="4"/><line x1="16" y1="5" x2="16" y2="27" stroke-dasharray="2 2"/><line x1="5" y1="16" x2="27" y2="16" stroke-dasharray="2 2"/>' },
    { id: 'literacy', label: 'Global Literacy', name: 'Global Literacy Fund', url: 'https://example.org/global-literacy', color: '#0369a1',
      icon: '<circle cx="16" cy="16" r="11"/><ellipse cx="16" cy="16" rx="5" ry="11"/><line x1="5" y1="16" x2="27" y2="16"/>' },
    { id: 'neuro', label: 'NeuroLearn Labs', name: 'NeuroLearn Labs', url: 'https://example.org/neurolearn', color: '#047857',
      icon: '<circle cx="8" cy="16" r="3"/><circle cx="24" cy="9" r="3"/><circle cx="24" cy="23" r="3"/><line x1="11" y1="15" x2="21" y2="10"/><line x1="11" y1="17" x2="21" y2="22"/>' },
    { id: 'brightstart', label: 'BrightStart', name: 'BrightStart Schools', url: 'https://example.org/brightstart', color: '#4338ca',
      icon: '<path d="M4 14L16 6L28 14"/><path d="M7 13V26H25V13"/><rect x="13" y="18" width="6" height="8"/>' },
    { id: 'openink', label: 'OpenInk', name: 'OpenInk Alliance', url: 'https://example.org/openink', color: '#be123c',
      icon: '<path d="M16 5C10 12 8 17 8 21a8 8 0 0 0 16 0c0-4-2-9-8-16Z"/>' }
  ];
  function closeSponsors(except) {
    document.querySelectorAll('.sponsor-pop').forEach(function (p) {
      if (p === except) return;
      p.hidden = true;
      p.parentNode.querySelector('.sponsor-btn').setAttribute('aria-expanded', 'false');
    });
  }
  SPONSORS.forEach(function (s) {
    var item = document.createElement('div');
    item.className = 'sponsor';
    item.innerHTML =
      '<button type="button" class="sponsor-btn' + (s.real ? ' real' : '') + '" aria-expanded="false" aria-controls="sp-' + s.id + '">' +
        (s.logo
          ? '<img class="sp-logo" src="' + s.logo + '" width="' + s.w + '" height="' + s.h + '" alt="' + s.name + '">'
          : '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" style="color:' + s.color + '" aria-hidden="true">' + s.icon + '</svg>' +
            '<span class="sp-label">' + s.label + '</span>') + '</button>' +
      '<div class="sponsor-pop" id="sp-' + s.id + '" role="dialog" aria-label="' + s.name + '" hidden>' +
        '<div class="sp-head"><span class="sp-name">' + s.name + '</span><button type="button" class="sp-x" data-t-label="close">×</button></div>' +
        '<p class="sp-desc" data-t="sp.' + s.id + '"></p>' +
        '<a class="sp-link" href="' + s.url + '" target="_blank" rel="noopener noreferrer" data-t="visitWebsite">Visit website ↗</a></div>';
    var btn = item.querySelector('.sponsor-btn');
    var pop = item.querySelector('.sponsor-pop');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = pop.hidden;
      closeAll();
      closeSponsors(pop);
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        // Open towards the side with room, so the card stays on screen.
        var r = btn.getBoundingClientRect();
        var rtl = document.documentElement.dir === 'rtl';
        var roomAfter = rtl ? r.right : window.innerWidth - r.left;
        pop.classList.toggle('at-start', roomAfter >= 272);
        pop.classList.toggle('at-end', roomAfter < 272);
      }
    });
    item.querySelector('.sp-x').addEventListener('click', function () { closeSponsors(); btn.focus(); });
    $('sponsor-grid').appendChild(item);
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.sponsor')) closeSponsors(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('.sponsor-pop:not([hidden])');
    if (open) { closeSponsors(); open.parentNode.querySelector('.sponsor-btn').focus(); }
  });

  // About
  var dlg = $('about');
  function openAbout() {
    closeAll();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    $('about-body').scrollTop = 0;
  }
  function closeAbout() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  $('about-btn').addEventListener('click', openAbout);
  $('cta-about').addEventListener('click', openAbout);
  $('about-x').addEventListener('click', closeAbout);
  $('about-close').addEventListener('click', closeAbout);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeAbout(); });

  // The 3-dot stroke preview: one continuous stroke through the three dots of the ILT letter.
  var canvas = $('stroke-canvas');
  var ctx = canvas.getContext && canvas.getContext('2d');
  var pts = [{ x: 58, y: 14 }, { x: 24, y: 34 }, { x: 58, y: 54 }];
  var anim = null;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setupCanvas() {
    var r = window.devicePixelRatio || 1;
    canvas.width = 84 * r; canvas.height = 68 * r;
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }
  function drawBase() {
    ctx.clearRect(0, 0, 84, 68);
    pts.forEach(function (p) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#16324f'; ctx.fill();
    });
  }
  function drawStroke(progress) {
    drawBase();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    var a = progress <= 0.5 ? 0 : 1;
    var k = progress <= 0.5 ? progress / 0.5 : (progress - 0.5) / 0.5;
    if (a === 1) ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[a].x + (pts[a + 1].x - pts[a].x) * k, pts[a].y + (pts[a + 1].y - pts[a].y) * k);
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }
  function play() {
    if (!ctx) return;
    if (anim) cancelAnimationFrame(anim);
    if (reduced) { drawStroke(1); return; }
    var progress = 0;
    (function step() {
      progress = Math.min(1, progress + 0.025);
      drawStroke(progress);
      anim = progress < 1 ? requestAnimationFrame(step) : null;
    })();
  }
  if (ctx) { setupCanvas(); drawBase(); setTimeout(play, 400); }
  $('replay').addEventListener('click', play);
  $('cta-stroke').addEventListener('click', function () {
    var card = $('stroke-card');
    var r = card.getBoundingClientRect();
    if (r.top < 64 || r.bottom > window.innerHeight) card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
    setTimeout(function () { card.classList.remove('flash'); }, 1600);
    play();
  });

  apply(initialLang());
  if (location.hash === '#about') openAbout();
})();
