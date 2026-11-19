// Japanese (Phase 6b″): only what the tablet shows the child, and the code screen it returns to after a
// session, is translated. Staff screens are in Hebrew or English (STAFF_LANGUAGES), so every other key keeps
// the English text. Revised from the owner's review (Japanese Tablet Text Audit, 2026-11-19).
import type { LocaleShape } from '../index.js';
import { en } from './en.js';

export const ja: LocaleShape = {
  ...en,
  app: { ...en.app, kiosk: 'こどもよう タブレット' },
  common: { ...en.common, language: 'ことば' },
  kiosk: {
    ...en.kiosk,
    camera: {
      code: 'カメラの せつぞく',
      code_help: 'カメラを この がめんに むけて ください',
      frame: 'カメラの いちあわせ：わくが ぜんぶ うつるように して ください',
    },
    waiting: 'せんせいが はじめるのを まっています',
    enter_pin: '6つの すうじを いれて ください',
    connect: 'つなぐ',
    pin_wrong: 'ばんごうが ちがいます。たしかめて もういちど いれて ください',
    pin_expired: 'この ばんごうは つかえなくなりました。せんせいに あたらしい ばんごうを もらって ください',
    pin_locked: 'しばらく つかえません。15ふん たってから もういちど いれて ください',
    get_ready: 'じゅんびしてね…',
    paused: 'ちょっと きゅうけい',
    uploading: 'かいたものを のこしています…',
    session_done: 'おわり！ よく がんばったね',
    connection_lost: 'いま つながっていません。かいたものは だいじょうぶです',
    full_screen: 'ぜんがめん',
    task_title: 'あたらしい もじ（ILT）',
    block_of: 'ブロック {{n}} / {{total}}',
    warmup_of: 'れんしゅう {{n}} / {{total}}',
    page_of: 'ページ {{n}} / {{total}}',
    sheet_of: 'シート {{n}} / {{total}}',
    next_block: 'つぎへ',
    next_page: 'つぎのページ',
    rotate: {
      PORTRAIT: 'タブレットを たてむきに して ください',
      LANDSCAPE: 'タブレットを よこむきに して ください',
    },
    pen_down_note: 'おわったら、ペンを タブレットの よこに おいてね',
    video_loading: 'どうがを よみこんでいます…',
    video_failed: 'どうがを よみこめませんでした',
    tap_to_play: 'がめんを おして どうがを みてね',
  },
};
