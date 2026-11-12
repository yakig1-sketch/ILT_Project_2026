#!/usr/bin/env sh
# Re-creates the Phase 5a letter canvases from the clinical team's sheets (run from the repo root).
# Needs Python 3.12 with requirements.txt installed; PY may name that Python.
set -e
PY=${PY:-python}
SHEETS="Documents/09_Samples/Hebrew_Letter_Sheets"
OUT="Documents/05_Measures/Intervention_Letters"
"$PY" -I tools/letter-sheets/extract_letter_sheet.py "$SHEETS/3אותיות הקשת ה.pdf" --letter ה --code LETTER_HE_HE --name-he "האות ה (דף התערבות)" --name-en "Letter He (intervention sheet)" --out "$OUT"
"$PY" -I tools/letter-sheets/extract_letter_sheet.py "$SHEETS/4אותיות הקשת ח.pdf" --letter ח --code LETTER_HE_HET --name-he "האות ח (דף התערבות)" --name-en "Letter Het (intervention sheet)" --out "$OUT"
"$PY" -I tools/letter-sheets/extract_letter_sheet.py "$SHEETS/5אותיות הקשת ק.pdf" --letter ק --code LETTER_HE_QOF --name-he "האות ק (דף התערבות)" --name-en "Letter Qof (intervention sheet)" --out "$OUT"
"$PY" -I tools/letter-sheets/extract_letter_sheet.py "$SHEETS/6אותיות הקשת ת.pdf" --letter ת --code LETTER_HE_TAV --name-he "האות ת (דף התערבות)" --name-en "Letter Tav (intervention sheet)" --out "$OUT"
