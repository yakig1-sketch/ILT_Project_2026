// Hebrew (default). Keys must match en.ts exactly; the i18n test fails otherwise.
export const he = {
  app: {
    name: 'מערכת המחקר ILT',
    kiosk: 'עמדת הילד',
    cockpit: 'עמדת הבוחן',
    analyst: 'פורטל אנליסטים',
  },
  common: {
    language: 'שפה',
    hebrew: 'עברית',
    english: 'English',
    server_status: 'מצב השרת',
    online: 'מחובר',
    offline: 'לא מחובר',
    checking: 'בודק…',
    version: 'גרסה',
  },
  kiosk: {
    waiting: 'מחכים שהבוחנת תתחיל',
    enter_pin: 'הקלידו את הקוד בן 6 הספרות',
    preview_title: 'תצוגת דף ILT בגודל אמיתי',
    calibration: 'כיול: {{pxPerMm}} פיקסלים למ"מ',
  },
  cockpit: {
    sessions: 'מפגשים',
    telemetry: {
      title: 'נתונים קליניים',
      active_box: 'בית פעיל',
      block_time: 'זמן בלוק',
      inactivity: 'חוסר פעילות',
      pen_lifts: 'הרמות עט בבלוק',
      internal_lifts: 'הרמות עט בתוך אות',
      width_outside: 'רוחב מחוץ לטווח',
      dot_b: 'פגיעה בנקודה B',
      skipped: 'בתים שדולגו',
      avg_speed: 'מהירות ILT ממוצעת',
    },
  },
  analyst: {
    research_only: 'מוצגים רק מפגשי מחקר עם הסכמה',
  },
  step: {
    video_intro: 'סרטון פתיחה',
    video_notebook: 'סרטון הדגמת מחברת',
    warmup: 'בלוק חימום',
    ilt_block: 'בלוק ILT {{n}}',
    notebook_page: 'דף מחברת {{n}}',
    paper_notebook_page: 'דף מחברת נייר {{n}}',
    intervention_sheet: 'דף התערבות',
  },
  units: {
    mm: 'מ"מ',
    mm_s: 'מ"מ/שנ׳',
    seconds: 'שנ׳',
  },
} as const;
