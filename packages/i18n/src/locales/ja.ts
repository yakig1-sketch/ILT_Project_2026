// Japanese (Phase 6b″): only what the tablet shows the child, and the code screen it returns to after a
// session, is translated. Staff screens are in Hebrew or English (STAFF_LANGUAGES), so every other key keeps
// the English text. DRAFT: to be checked by the owner before Japanese is enabled.
import type { LocaleShape } from '../index.js';
import { en } from './en.js';

export const ja: LocaleShape = {
  ...en,
  app: { ...en.app, kiosk: 'こどもよう たんまつ' },
  common: { ...en.common, language: 'ことば' },
  kiosk: {
    ...en.kiosk,
    camera: {
      code: 'カメラの せつぞく',
      code_help: 'カメラを この がめんに むけてください',
      frame: 'カメラの いちあわせ：わくが ぜんぶ うつるように してください',
    },
    waiting: 'せんせいが はじめるのを まっています',
    enter_pin: '6けたの ばんごうを いれてください',
    connect: 'つなぐ',
    pin_wrong: 'ばんごうが ちがいます。たしかめて もういちど いれてください',
    pin_expired: 'この ばんごうは つかえなくなりました。せんせいに あたらしい ばんごうを もらってください',
    pin_locked: 'まちがいが おおすぎます。15ふん たってから もういちど ためしてください',
    get_ready: 'じゅんびしてね…',
    paused: 'ちょっと きゅうけい',
    uploading: 'かいたものを ほぞんしています…',
    session_done: 'おわり！ よく がんばったね',
    connection_lost: 'サーバーに つながっていません。かいたものは タブレットに のこっています',
    full_screen: 'ぜんがめん',
    task_title: 'つくりもじの かだい（ILT）',
    block_of: 'ブロック {{n}} / {{total}}',
    warmup_of: 'れんしゅう {{n}} / {{total}}',
    page_of: 'ページ {{n}} / {{total}}',
    sheet_of: 'シート {{n}} / {{total}}',
    next_block: 'つぎへ',
    pen_down_note: 'おわったら、ペンを タブレットの よこの つくえに おいてね',
    video_loading: 'どうがを よみこんでいます…',
    video_failed: 'どうがを よみこめませんでした',
    tap_to_play: 'タップして どうがを みてね',
  },
};
