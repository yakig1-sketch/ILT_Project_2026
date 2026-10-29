import type { LocaleShape } from '../index.js';

export const en: LocaleShape = {
  app: {
    name: 'ILT Research System',
    kiosk: 'Child station',
    cockpit: 'Evaluator cockpit',
    analyst: 'Analyst portal',
  },
  common: {
    language: 'Language',
    hebrew: 'עברית',
    english: 'English',
    server_status: 'Server status',
    online: 'Online',
    offline: 'Offline',
    checking: 'Checking…',
    version: 'Version',
  },
  kiosk: {
    waiting: 'Waiting for the evaluator to start',
    enter_pin: 'Type the 6-digit code',
    preview_title: 'ILT page preview at true size',
    calibration: 'Calibration: {{pxPerMm}} px per mm',
  },
  cockpit: {
    sessions: 'Sessions',
    telemetry: {
      title: 'Clinical telemetry',
      active_box: 'Active house',
      block_time: 'Block time',
      inactivity: 'Inactivity',
      pen_lifts: 'Pen lifts in block',
      internal_lifts: 'Pen lifts inside letters',
      width_outside: 'Width outside band',
      dot_b: 'Dot B hit',
      skipped: 'Skipped houses',
      avg_speed: 'Average ILT speed',
    },
  },
  analyst: {
    research_only: 'Only research sessions with consent are shown',
  },
  step: {
    video_intro: 'Intro video',
    video_notebook: 'Notebook demo video',
    warmup: 'Warm-up block',
    ilt_block: 'ILT block {{n}}',
    notebook_page: 'Notebook page {{n}}',
    paper_notebook_page: 'Paper notebook page {{n}}',
    intervention_sheet: 'Intervention sheet',
  },
  units: {
    mm: 'mm',
    mm_s: 'mm/s',
    seconds: 's',
  },
};
