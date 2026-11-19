# ILT — Japanese tablet texts (Phase 6b″)

**Status:** DRAFT 3, revised from the owner's review (*Japanese Tablet Text Audit*, 2026-11-19) · **Source:** `packages/i18n/src/locales/ja.ts`

Only the texts the child sees on the tablet (and the code screen it returns to after a Japanese session) are translated; staff screens stay in Hebrew and English. Hiragana with spaces between phrases (分かち書き), ください always spaced, no kanji (no furigana on the tablet), no adult jargon (ほぞん, サーバー, けた, タップ, たんまつ), and no blaming words in the lockout message.

Changes in draft 3 (14 texts): rows 4, 6, 8 (つくった もじ, the owner's choice of the two proposals), 15, 18, 19, 21–23, 25–26, 27–29; the notebook-page button now says *Next page* / *לדף הבא* in English and Hebrew too (and the evaluator guide says so). Rows 27–28 speak to the child (たてに してね / よこに してね, owner 2026-11-19). Row 7 stays: the evaluator taps it. Optional suggestions for rows 1, 3, 16 were left as they are.

| # | Key (`kiosk.` unless shown) | English | Hebrew | Japanese | Previous Japanese (if changed) |
|---|---|---|---|---|---|
| 1 | `waiting` | Waiting for the evaluator to start | מחכים שהבוחנת תתחיל | せんせいが はじめるのを まっています |  |
| 2 | `get_ready` | Get ready… | מתכוננים… | じゅんびしてね… |  |
| 3 | `paused` | Short break | הפסקה קצרה | ちょっと きゅうけい |  |
| 4 | `uploading` | Saving your writing… | שומרים את הכתיבה… | かいたものを のこしています… | かいたものを ほぞんしています… |
| 5 | `session_done` | All done! Well done | סיימנו! כל הכבוד | おわり！ よく がんばったね |  |
| 6 | `connection_lost` | No connection to the server. Writing is kept on the tablet | אין חיבור לשרת. הכתיבה נשמרת בטאבלט | いま つながっていません。かいたものは だいじょうぶです | サーバーに つながっていません。かいたものは タブレットに のこっています |
| 7 | `full_screen` | Full screen | מסך מלא | ぜんがめん |  |
| 8 | `task_title` | Invented Letter Task (ILT) | משימת האות המומצאת (ILT) | つくった もじ（ILT） | つくりもじの かだい（ILT） |
| 9 | `block_of` | Block {{n}} of {{total}} | בלוק {{n}} מתוך {{total}} | ブロック {{n}} / {{total}} |  |
| 10 | `warmup_of` | Warm-up {{n}} of {{total}} | חימום {{n}} מתוך {{total}} | れんしゅう {{n}} / {{total}} |  |
| 11 | `page_of` | Page {{n}} of {{total}} | עמוד {{n}} מתוך {{total}} | ページ {{n}} / {{total}} |  |
| 12 | `sheet_of` | Sheet {{n}} of {{total}} | דף {{n}} מתוך {{total}} | シート {{n}} / {{total}} |  |
| 13 | `next_block` | Next block | לבלוק הבא | つぎへ |  |
| 14 | `next_page` | Next page | לדף הבא | つぎのページ |  |
| 15 | `pen_down_note` | Place pen on table beside tablet upon block completion | בסיום הבלוק, הניחו את העט על השולחן ליד הטאבלט | おわったら、ペンを タブレットの よこに おいてね | おわったら、ペンを タブレットの よこの つくえに おいてね |
| 16 | `video_loading` | Loading the video… | טוענים את הסרטון… | どうがを よみこんでいます… |  |
| 17 | `video_failed` | The video could not be loaded | לא הצלחנו לטעון את הסרטון | どうがを よみこめませんでした |  |
| 18 | `tap_to_play` | Tap to play the video | הקישו כדי להפעיל את הסרטון | がめんを おして どうがを みてね | タップして どうがを みてね |
| 19 | `enter_pin` | Type the 6-digit code | הקלידו את הקוד בן 6 הספרות | 6つの すうじを いれて ください | 6けたの ばんごうを いれてください |
| 20 | `connect` | Connect | התחברות | つなぐ |  |
| 21 | `pin_wrong` | The code is wrong. Check it and try again | הקוד שגוי. בדקו אותו ונסו שוב | ばんごうが ちがいます。たしかめて もういちど いれて ください | ばんごうが ちがいます。たしかめて もういちど いれてください |
| 22 | `pin_expired` | This code has expired. Ask the evaluator for a new code | תוקף הקוד פג. בקשו מהבוחן/ת קוד חדש | この ばんごうは つかえなくなりました。せんせいに あたらしい ばんごうを もらって ください | この ばんごうは つかえなくなりました。せんせいに あたらしい ばんごうを もらってください |
| 23 | `pin_locked` | Too many attempts. Try again in 15 minutes | יותר מדי ניסיונות. נסו שוב בעוד 15 דקות | しばらく つかえません。15ふん たってから もういちど いれて ください | まちがいが おおすぎます。15ふん たってから もういちど ためしてください |
| 24 | `camera.code` | Camera pairing | צימוד מצלמה | カメラの せつぞく |  |
| 25 | `camera.code_help` | Point the camera at this screen | כוונו את המצלמה אל המסך הזה | カメラを この がめんに むけて ください | カメラを この がめんに むけてください |
| 26 | `camera.frame` | Camera positioning: the whole frame should be in view | מיקום המצלמה: כל המסגרת צריכה להיראות | カメラの いちあわせ：わくが ぜんぶ うつるように して ください | カメラの いちあわせ：わくが ぜんぶ うつるように してください |
| 27 | `rotate.PORTRAIT` | Turn the tablet upright (portrait) to continue | סובבו את הטאבלט לאורך (עומד) כדי להמשיך | タブレットを たてに してね | タブレットを たてむきに してください |
| 28 | `rotate.LANDSCAPE` | Turn the tablet on its side (landscape) to continue | סובבו את הטאבלט לרוחב (שוכב) כדי להמשיך | タブレットを よこに してね | タブレットを よこむきに してください |
| 29 | `app.kiosk` | Child station | עמדת הילד | こどもよう タブレット | こどもよう たんまつ |
| 30 | `common.language` | Language | שפה | ことば |  |
