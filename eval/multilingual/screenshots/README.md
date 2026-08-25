# Multilingual reply screenshots

Browser evidence for the multilingual feature — captured with Playwright driving
the real app (`npm run dev`), one fresh session per query. Each shows the query
typed in the composer and the streamed restoration card authored back in the
reader's own language and register.

| File | Query | Language | Expected |
|---|---|---|---|
| `01-hindi-idli.png` | इडली | Hindi (Devanagari) | reply in Hindi, native script |
| `02-tamil-idli.png` | இட்லி | Tamil | reply in Tamil, native script |
| `03-bengali-dosa.png` | দোসা | Bengali | reply in Bengali; dish name "Dosa" kept as-is |
| `04-telugu-upma.png` | ఉప్మా | Telugu | reply in Telugu, native script |
| `05-hinglish-idli.png` | idli kaise banti hai | Hinglish | reply in Latin-script Hinglish |
| `06-english-dosa.png` | dosa | English | English baseline |
| `07-urdu-fallback.png` | بریانی | Urdu (deferred) | English reply — Urdu detected but falls back |

Regenerate: run `npm run dev`, then the Playwright script (kept out of the repo —
it uses an isolated Playwright install and the system Chrome via
`channel: "chrome"`). Terminal-side evidence for the same run is in `../report.md`
and the `RUN_REPORT.md` multilingual rows.
