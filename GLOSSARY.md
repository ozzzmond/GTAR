# GTAR Glossary

Seeded from the Domain Terms in AGENTS.md. Use these exact terms in code,
tests, PRs, and reports.

- **ORIGINAL_KEY** — verified source/original song key.
- **CHART_KEY** — key the stored chart is written in; may differ from ORIGINAL_KEY.
- **PERFORMANCE_KEY** — CHART_KEY plus applied transpose state.
- **TRANSPOSE_OFFSET** — semitone offset; TRANSPOSE_ZERO means ORIGINAL_KEY.

## Rules
- Never guess ORIGINAL_KEY; never silently change a saved PERFORMANCE_KEY.
- ChordPro `{key}` equals ORIGINAL_KEY at rest. Only transposition changes the
  key in use (PERFORMANCE_KEY); transposing never rewrites `{original_key}`.
