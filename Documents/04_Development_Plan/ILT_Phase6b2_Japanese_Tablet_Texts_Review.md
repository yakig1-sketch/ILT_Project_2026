# ILT — Japanese tablet texts for review (Phase 6b″)

**Status:** DRAFT, written by Claude, to be checked by the owner before Japanese is enabled
**Date:** 2026-11-18 · **Source:** `packages/i18n/src/locales/ja.ts`

Only the texts the child sees on the tablet (and the code screen the tablet returns to after a Japanese session) are translated; staff screens stay in Hebrew and English. Style: hiragana with spaces between phrases (分かち書き), as in grade 1–2 readers; numbers as digits; せんせい = the evaluator. The tablet shows no furigana, so the texts use no kanji.

Points to check first:
- **`task_title` つくりもじの かだい** ("invented letter task"): the least certain term; the Japanese team should choose it.
- **`next_block` つぎへ** comes from the proposal. The same button serves the notebook pages; the proposal's つぎのページ there needs a small addition if wanted.

Write corrections in the last column (or ✓).

| # | Key (`kiosk.` unless shown) | English | Hebrew | Japanese (draft) | Correction / ✓ |
|---|---|---|---|---|---|
| 1 | `waiting` | Waiting for the evaluator to start | מחכים שהבוחנת תתחיל | せんせいが はじめるのを まっています | |
| 2 | `get_ready` | Get ready… | מתכוננים… | じゅんびしてね… | |
| 3 | `paused` | Short break | הפסקה קצרה | ちょっと きゅうけい | |
| 4 | `uploading` | Saving your writing… | שומרים את הכתיבה… | かいたものを ほぞんしています… | |
| 5 | `session_done` | All done! Well done | סיימנו! כל הכבוד | おわり！ よく がんばったね | |
| 6 | `connection_lost` | No connection to the server. Writing is kept on the tablet | אין חיבור לשרת. הכתיבה נשמרת בטאבלט | サーバーに つながっていません。かいたものは タブレットに のこっています | |
| 7 | `full_screen` | Full screen | מסך מלא | ぜんがめん | |
| 8 | `task_title` | Invented Letter Task (ILT) | משימת האות המומצאת (ILT) | つくりもじの かだい（ILT） | |
| 9 | `block_of` | Block {{n}} of {{total}} | בלוק {{n}} מתוך {{total}} | ブロック {{n}} / {{total}} | |
| 10 | `warmup_of` | Warm-up {{n}} of {{total}} | חימום {{n}} מתוך {{total}} | れんしゅう {{n}} / {{total}} | |
| 11 | `page_of` | Page {{n}} of {{total}} | עמוד {{n}} מתוך {{total}} | ページ {{n}} / {{total}} | |
| 12 | `sheet_of` | Sheet {{n}} of {{total}} | דף {{n}} מתוך {{total}} | シート {{n}} / {{total}} | |
| 13 | `next_block` | Next block | לבלוק הבא | つぎへ | |
| 14 | `pen_down_note` | Place pen on table beside tablet upon block completion | בסיום הבלוק, הניחו את העט על השולחן ליד הטאבלט | おわったら、ペンを タブレットの よこの つくえに おいてね | |
| 15 | `video_loading` | Loading the video… | טוענים את הסרטון… | どうがを よみこんでいます… | |
| 16 | `video_failed` | The video could not be loaded | לא הצלחנו לטעון את הסרטון | どうがを よみこめませんでした | |
| 17 | `tap_to_play` | Tap to play the video | הקישו כדי להפעיל את הסרטון | タップして どうがを みてね | |
| 18 | `enter_pin` | Type the 6-digit code | הקלידו את הקוד בן 6 הספרות | 6けたの ばんごうを いれてください | |
| 19 | `connect` | Connect | התחברות | つなぐ | |
| 20 | `pin_wrong` | The code is wrong. Check it and try again | הקוד שגוי. בדקו אותו ונסו שוב | ばんごうが ちがいます。たしかめて もういちど いれてください | |
| 21 | `pin_expired` | This code has expired. Ask the evaluator for a new code | תוקף הקוד פג. בקשו מהבוחן/ת קוד חדש | この ばんごうは つかえなくなりました。せんせいに あたらしい ばんごうを もらってください | |
| 22 | `pin_locked` | Too many attempts. Try again in 15 minutes | יותר מדי ניסיונות. נסו שוב בעוד 15 דקות | まちがいが おおすぎます。15ふん たってから もういちど ためしてください | |
| 23 | `camera.code` | Camera pairing | צימוד מצלמה | カメラの せつぞく | |
| 24 | `camera.code_help` | Point the camera at this screen | כוונו את המצלמה אל המסך הזה | カメラを この がめんに むけてください | |
| 25 | `camera.frame` | Camera positioning: the whole frame should be in view | מיקום המצלמה: כל המסגרת צריכה להיראות | カメラの いちあわせ：わくが ぜんぶ うつるように してください | |
| 26 | `app.kiosk` | Child station | עמדת הילד | こどもよう たんまつ | |
| 27 | `common.language` | Language | שפה | ことば | |
| 28 | `rotate.PORTRAIT` | Turn the tablet upright (portrait) to continue | סובבו את הטאבלט לאורך (עומד) כדי להמשיך | タブレットを たてむきに してください | |
| 29 | `rotate.LANDSCAPE` | Turn the tablet on its side (landscape) to continue | סובבו את הטאבלט לרוחב (שוכב) כדי להמשיך | タブレットを よこむきに してください | |
