# GH#504 — ProPresenter song synchronization and lyric following

Design baseline: `origin/dev` at `97dca1e2c7d9e9a70cf2a2aae5f9144a1d50c5c8`, 2026-11-13.
Tracking: [#504](https://github.com/ozzzmond/GTAR/issues/504). Documentation only; implementation requires a subsequent directive.

## Evidence and decision status

- **VERIFIED_CODE** means inspected at the baseline above; it does not mean executed or device tested in this task.
- **OWNER_TESTED** means historical owner evidence recorded on GitHub, limited to its stated environment.
- **REQUIREMENT** means the active owner decisions in this task.
- **PROPOSED** means implementation design, including thresholds and types; not shipped behavior.
- **BLOCKED_SAMPLE** means real 7.13 payloads/behavior are needed before enabling the affected automation.

Everything after the evidence inventory is PROPOSED unless explicitly labelled otherwise. Historical plans contain superseded pending statements; current code and latest GitHub comments take precedence.

REQUIREMENT: Each device connects directly, GET-only, with no relay or ProPresenter control. Integration defaults OFF and remains optional/lazy. Android Chrome is first; iOS/iPadOS remains unavailable. Normal songbook and editor stay manual. Following operates only inside song fullscreen; leaving pauses navigation, and re-entry requires fresh verified matching. Slide-level highlighting marks all matching lyrics together, keeps chords visible, and stays subtle. Manual scrolling pauses automatic scrolling until explicit resume while highlighting continues. Disconnection preserves the last position and GTAR usability. Preserve ORIGINAL_KEY, CHART_KEY, PERFORMANCE_KEY, TRANSPOSE_OFFSET, chart contents and `{original_key}`; no key inference or chart writes. Slide text is memory-only, excluded from logs and backups.

### Canonical sources

- [#415 final owner QA/closure](https://github.com/ozzzmond/GTAR/issues/415#issuecomment-6827766000): OWNER_TESTED Android Chrome tablet against E14 ProPresenter 7.13 demo; follower delivered through [PR#502](https://github.com/ozzzmond/GTAR/pull/502), merged `1ed66e8`. Church network, iOS and newer ProPresenter versions remain untested.
- [#438 decisions and contract result](https://github.com/ozzzmond/GTAR/issues/438#issuecomment-6827668528): same repository/lazy chunks; settings excluded from backup; no events API until a consumer. Freeze status is not inferred: this comment also says final freeze decision pending.
- [Real slide_index correction](https://github.com/ozzzmond/GTAR/issues/415#issuecomment-6827515235): `presentation_index`, not Swagger's `presentation` alias.
- [Android browser evidence](https://github.com/ozzzmond/GTAR/issues/415#issuecomment-6826096139): TLPADPRO1, Android 15 settings, Chrome 157.0.8103.78, HTTPS PR#500 preview, Local Network Access allowed. Readable initial snapshot and subsequent/backward updates. This does not establish every later recovery case.
- Existing [#415 feasibility](415-propresenter-feasibility.md) and [#438 contract](438-extension-contract-rnd.md) supply history; this document proposes only the consumer needed by #504.

### Reusable implementation inventory — VERIFIED_CODE

| Existing boundary | Current behavior | Reuse / required seam |
|---|---|---|
| `web/src/extensions/propresenter-follower/index.ts` | Two concurrent GET streams: `/v1/status/slide?chunked=true` and `/v1/presentation/slide_index?chunked=true`; fixed HTTP port 1025. No polling fallback implemented | Retain request validation, no-store, credentials omit, redirect error, incremental `ObjectFrames` decoder and 1 MiB frame limit |
| Same follower | `Slides` retains only current/next `{uuid,text}`; requires incoming `notes` string but discards it. `presentationName()` retains name only | Add validated UUID/index projection; do not parse identity out of panel strings |
| Same follower | Consecutive current/next UUID-pair dedupe; A→B→A survives. Same-UUID text edits suppressed. Separate stream health, stale last display, jittered retry capped at 30 s, generation guards, hidden-page pause/restart, abort/dispose | Reuse lifecycle; consumer needs coherent identity/slide revisions and content-aware dedupe, not pair-only delivery |
| `web/src/extensions/contract/index.ts` | Event capability names exist; context has settings, status, log, panel and abort signal, no event API | Add only two observation subscriptions and one narrowly typed follower output seam described below |
| `web/src/extensions/host/ExtensionHost.ts`, `useExtensionHost.ts` | Host refuses all `events:*` capabilities; available host capabilities currently `ui:panel`, `net:lan`; lazy enable, generation isolation, disable disposal | Add only approved capabilities and lifecycle-bound forwarding; no global extension bus |
| `web/src/extensions/host/settings.ts`, `registry.ts` | Local `gtar_ext_<id>_v1` scalar settings, OFF default, host validation, fixed port, iOS excluded | Preserve existing follower configuration; separate local link records from scalar manifest settings |
| `web/src/App.tsx` | Owns songs/current selection, stage/editor/songbook views and setlist/library queues. `handleSelectLibrarySong` also switches queue to library | App owns guarded selection; do not invoke this handler blindly for setlist following |
| `web/src/components/StageView.tsx` | Native `isFullscreen` distinct from focus/distraction-free `isPerformanceMode`; parses via `parseGtarSong`, owns scroll container, rate autoscroll, section controls, keyboard/swipe navigation, BandSync and Stage Cast hooks | Gate on actual song fullscreen, not the broader header-hiding callback. Reuse scroll container and section geometry, not continuous speed loop |
| Same StageView | Song identity change resets scroll to top and cancels rate scrolling; scroll handler broadcasts to Stage Cast and sometimes BandSync | Apply matched-line scroll only after new song render/reset. Prevent follower-originated effects from broadcasting into other sync features |
| `web/src/utils/songParser.ts`, `web/src/types/gtar.ts` | Parsed `SongLine` variants include LYRIC, CHORD_PRO, CHORD_ROW, SECTION_HEADER, TAB, EMPTY; `parseChordProLine()` returns chord/text segments | Extract read-only lyric projection from parsed lines. Never use parser key inference to establish ORIGINAL_KEY |
| `web/src/components/SongLineRenderer.tsx` | `data-stage-line`, `data-line-index`, section attributes. Chord-over-lyric pair renders at chord-row index and hides following LYRIC wrapper; anchored inline chord/lyric spans wrap visually | Add optional presentation-only active IDs and a global line offset. Current indices restart in each of two columns; not globally unique |
| `web/src/utils/songParser.ts` | `splitSongLinesForColumns()` preserves chord/lyric pairs and returns slices | Carry original parsed-line IDs through both slices; don't match via DOM textContent containing chords |

### Available ProPresenter metadata

OWNER_TESTED fixture, also in `web/tests/proPresenterFollower.test.cjs`:

```json
{"presentation_index":{"index":0,"presentation_id":{"uuid":"b84615d0-1d75-4f8d-ac64-d09543b7a641","name":"Amazing Grace (My Chains Are Gone)","index":0}}}
```

| Data | Evidence / limit |
|---|---|
| Presentation UUID/title | Present in real 7.13 `presentation_index.presentation_id`; code currently validates only name. UUID and numeric indices need new validation |
| Slide index | Real fixture contains outer `index:0`; its zero/one base, meaning across groups and transition ordering need multi-slide samples. Inner presentation_id.index is not assumed to be a slide index |
| Current/next slide UUID/text | Real `/v1/status/slide` contract and historical owner QA; empty next at final slide is valid. Notes/unknown fields must not be retained |
| No active presentation | Current parser accepts `presentation_index:null` and clears name; consumer must invalidate identity and highlight rather than reuse previous song |
| `/v1/presentation/active` | #415 body reports UUID/name, ordered groups, six slides and lyric text from home POC. Exact nested payload is not checked into the inspected fixture, and follower URL builder explicitly rejects this path today. CSP includes the path but is not runtime authorization |
| Slide UUID → presentation/group membership | BLOCKED_SAMPLE: no verified exact active-presentation schema or mapping. No atomic sequence token joins the two current streams |

Do not implement from Swagger aliases or invent group/slide field paths. Read-only access to the already contemplated active endpoint needs explicit runtime allowlist/test coverage in the later implementation PR; no CSP expansion is proposed.

## Ownership and minimum contract

```text
ProPresenter GET streams
  -> lazy follower: validated, correlated external snapshot
  -> extension host: ephemeral typed output, abort/generation isolation
  -> optional core song-follow coordinator: library projection + matching
  -> App: fullscreen/modal/conflict guard + song selection
  -> StageView: active lyric IDs + independent scroll controller
  -> SongLineRenderer: decorative line highlighting
```

The extension imports contract types only, never App, storage, parser or components. Core imports host only. Core coordinator can use its existing parser/library without exposing chart bodies to extensions. No matching inside `setPanel`, no DOM scraping and no callable core setters passed into extension context.

### Proposed observations: `events:song` and `events:section`

These retain #438's meaning: extension observations of core state, not commands from ProPresenter. Add `ctx.events.on('song.changed' | 'section.changed', listener)` with capability checks, unsubscribe and cleanup on abort. Only enable these two names; keep setlist/transpose event capabilities unavailable. Initial snapshot plus change notifications must share a revision and avoid a subscribe/read race. Frozen plain data, asynchronous isolated delivery, no replay queue after disable.

| Event | Minimum payload | Ownership / trigger |
|---|---|---|
| `song.changed` (`events:song`) | `{songId: string|number|null, view: 'songbook'|'stage'|'editor', fullscreen: boolean, revision: number, origin: 'manual'|'propresenter'|'core'}` | App/Stage seam emits after displayed identity or view/fullscreen changes. No title/chart/key fields needed for this consumer |
| `section.changed` (`events:section`) | `{songId, chartRevision: number, sectionLineId: number|null, activeLineIds: readonly number[], revision: number, origin}` | Stage commits logical followed selection or explicit section navigation. Null/empty means none/cleared; scrolling through a heading alone is not an authoritative external section change |

For inputs, add only `ctx.publishFollowSnapshot(snapshot)` scoped to the ProPresenter registration, delivered to a host subscriber while enabled. This is a distinct ephemeral data observation, not an `events:song` navigation API. Suggested contract payload:

```ts
type FollowSnapshot = Readonly<{
  generation: number; revision: number;
  health: 'connecting' | 'live' | 'stale' | 'offline';
  presentation: null | Readonly<{ uuid: string; title: string; slideIndex: number | null }>;
  current: Readonly<{ uuid: string; text: string }>;
  coherence: 'unverified' | 'verified';
}>;
```

Host accepts output only from the registered follower while its generation is live; the extension cannot publish another source ID. No arbitrary named events, plugin RPC, dynamic registry, network transport framework or command capability. This additive contract revision requires focused #438 review before code; existing panel-only extensions continue unchanged. Core never echoes its selection back to ProPresenter. Origin tags prevent feedback loops; observation callbacks cannot navigate.

## Coherence before navigation

Independent streams can produce new slide/old title or old slide/new title. Receipt time proximity, an index value, or two consecutive matching names does not prove they belong together.

1. On presentation UUID change, stream restart, host change or index/schema inconsistency: invalidate coherence, increment correlation generation, clear live highlight and cancel pending navigation/scroll. Keep displayed song/scroll position.
2. With verified active-presentation samples, read active metadata on identity change and recovery, not each animation frame. Bound it with the existing frame limit, a 10-second timeout and one in-flight active read; cancel superseded work. A non-chunked GET here is a proposed allowlist addition, not current behavior.
3. Verify active UUID matches identity feed and current slide UUID belongs to that presentation. Recheck the latest identity revision before publishing. A UUID shared across multiple groups can verify song membership without verifying group occurrence.
4. Only publish coherent song+slide snapshots. On rapid A→B→C, discard A/B responses after generation change. On reconnect obtain fresh identity, active membership and slide snapshots even if UUID pair equals the old pair.
5. Reused slide UUIDs across presentations or conflicting membership leave coherence unverified unless the real payload provides a trustworthy disambiguator. Do not navigate based on timing. Suppress duplicate effects using `(generation, presentationUuid, currentUuid, currentText, chartRevision)` equality; retain text only in memory. Next-slide changes alone do not move the highlight.

BLOCKED_SAMPLE: If 7.13 cannot establish membership reliably, automatic cross-song navigation stays unavailable. Offer explicit confirmation of the current presentation/song inside fullscreen and exact-text following for that confirmed session; mark this assisted mode, invalidate confirmation on any identity transition or disconnect. Confirmation cannot make an ambiguous slide occurrence scroll-safe. Never silently degrade to title-only automatic jumps.

## Presentation → GTAR song matching

Match across live personal Songbook songs, excluding Trash. Preserve ID type; numeric `1` and string `"1"` are not interchangeable. Do not choose by library order, recent use, current setlist, artist guess or key.

| Priority | Deterministic rule | Result |
|---|---|---|
| 1 UUID link | Exact `(local source profile, presentation UUID)` resolves to one valid song ID | Verified identity; title may change without breaking link |
| 2 Title fallback | No link exists: normalize both titles with NFKC, lowercase, trim/collapse whitespace, canonicalize curly apostrophes and dash variants; retain punctuation, parenthetical version names and numerals | One candidate is offered for explicit fullscreen confirmation; zero = unmatched, multiple = ambiguous. Confirmation establishes session verification and may save UUID link |
| Manual link | User chooses candidate in fullscreen and confirms presentation title/UUID plus GTAR title | Save UUID link only by explicit action; duplicate/conflicting records require repair, not overwrite |

No fuzzy title auto-navigation. An existing link pointing to a missing/deleted song blocks fallback and offers relink. A UUID conflict never falls through to a title guess. Blank title cannot match. When UUID is absent/invalid, support a session-only confirmed title match, never a durable title binding. Cross-song auto-navigation requires coherent current identity plus a valid link/session confirmation.

Persistence: first slice uses session links only. Later durable links use a separate versioned local store, e.g. `gtar_ext_propresenter_links_v1`, scoped by local account/library identity and user-created source profile. Store only source ID, presentation UUID and GTAR song ID; no slide text, lyrics, chart content or title copies. Do not put UUID fields into SongEntity/ChordPro or synced library/backup. One source can link many presentations to one GTAR song; each source/presentation pair has one target. Host/IP edits invalidate session coherence and require source-profile confirmation so DHCP changes do not silently bind a different installation. Storage errors leave links session-only and show that they were not saved. Account switch/restore invalidates session and revalidates IDs; no automatic link recreation. Existing generic scalar settings are unsuitable for link tables; add a bounded dedicated host-side store only when durable linking ships.

Selection preserves setlist context if the current entry is already the matched song. Otherwise select its unique occurrence in the active setlist; repeated occurrences require user choice (keep current if already selected). If absent, show a fullscreen suggestion to switch to library; do not silently change queue. App applies selection only after rechecking latest generation, active view, native fullscreen, overlays and matching. Song selection reads the selected song's existing TRANSPOSE_OFFSET; it never copies the outgoing song's offset or calls transpose mutation handlers.

## Slide → lyric lines: deterministic conservative matcher

Build a read-only lyric index once per song/content revision. IDs are original parsed-line indices plus chart revision. Do not use visual wraps as lines.

- LYRIC: use lyrics; if parser-compatible inline chord markup is present, use `parseChordProLine(...).map(segment => segment.text).join('')`.
- CHORD_PRO: join segment text only. Never include chord tokens.
- CHORD_ROW followed by LYRIC with `isOverLyric`: index that lyric once, with visible anchor at the preceding chord-row index. Standalone chord rows are excluded.
- SECTION_HEADER: section boundary/label only; TAB/EMPTY, directives and metadata are not lyric candidates.
- Keep an explicit projection `{lyricLineId, renderedAnchorId, sectionLineId, normalizedTokens}`. For column two add the slice's global offset; don't query the first matching local `data-line-index`.

Normalize slide and chart lyrics identically: NFKC; normalize CRLF/CR to LF; Unicode lowercase; canonicalize apostrophes/dashes, then treat punctuation as token separators except apostrophes within words (remove those); collapse Unicode whitespace. Preserve Unicode letters, combining marks, diacritics, numbers and token order. Never stem, translate, strip accents or expand abbreviations. Ignore empty normalized lines. Do not guess that a line is a copyright label or section cue: unexplained extra tokens fail full coverage. Owner samples may later justify explicit rules.

Candidate algorithm (exact first slice):

```text
slideTokens = normalized tokens from CURRENT slide only
for each section (or whole song when no headings):
  flatten lyric tokens while retaining token -> parsed-line mapping
  find every exact contiguous occurrence of slideTokens
  accept only occurrences whose start/end coincide with complete lyric-line boundaries
  reject ranges crossing an explicit section boundary
candidateRanges = all accepted occurrences (do not choose the first)
highlightIds = union of lyric lines in candidateRanges
```

This allows slide wrapping to differ from chart line wrapping, and one slide to match multiple chart lines. Minimum automatic match: 100% slide token coverage and at least four tokens containing at least 12 letters/numbers in total. Shorter exact text can highlight all exact full-line occurrences when the song identity is verified, but cannot choose a scrolling target. These are conservative proposed thresholds, not measured precision. Blank slides clear live highlighting without scrolling. A nonblank unmatched slide clears highlighting, shows “Slide not matched”, and retains position; it must not keep presenting the previous highlight as current.

Repeated sections and duplicate lines: highlight **all** accepted occurrences simultaneously, including duplicate choruses in separate sections. Do not force one occurrence merely to scroll. If one candidate range exists and meets the minimum, scroll target is verified. If multiple exist, use a sample-verified slide UUID/group occurrence mapping plus a session-confirmed group→chart-section mapping to resolve the target. Group label equality or “nearest forward occurrence” alone is insufficient; backwards and repeated navigation are legitimate. Without that evidence retain viewport and display “Position ambiguous”. A section containing a literal “repeat chorus” does not expand into invented lyric lines.

Fuzzy alternative: token edit-distance similarity `1 - distance/max(tokenCounts)` could rank suggestions at score ≥0.90, runner-up margin ≥0.15, at least eight tokens, without crossing sections. These thresholds are hypotheses only; fuzzy candidates never auto-select songs, highlight or scroll in the first delivery. Exact matching is the recommended minimum; curated real samples must establish false-positive behavior before broadening it. Manual song linking proves song identity, not a particular fuzzy lyric range.

## Fullscreen follow state machine

Use orthogonal state, not a single connection boolean:

```text
enabled: OFF | ON
transport: CONNECTING | LIVE | STALE | OFFLINE
scope: OUTSIDE | FULLSCREEN | SUSPENDED (overlay/other sync owner)
follow: PAUSED | AUTO | ASSISTED | MANUAL_OVERRIDE
songMatch: UNVERIFIED | VERIFIED | UNMATCHED | AMBIGUOUS
scroll: AUTO | MANUAL_PAUSED
```

AUTO and ASSISTED are explicit per-device choices inside fullscreen; default follow is PAUSED even when the text follower is enabled. ASSISTED displays a matching suggestion and requires confirmation before song changes. Both modes require the same lyric/coherence gates. No browser fullscreen request originates from a network callback.

| Transition | Required behavior |
|---|---|
| Disabled | Dispose output subscriptions, matching caches, highlights, timers, readers and retries; zero follow effects. Core stays usable |
| Enter native song fullscreen | Take fresh coherent snapshot, revalidate matching. Resume prior explicit mode only if verified; otherwise keep current song/position and show suggestion/status |
| Leave fullscreen, Escape, change to songbook/editor | Pause selection and scrolling immediately; cancel deferred work, hide highlight. Do not queue missed song changes |
| New coherent presentation in AUTO | Re-run match and queue policy; only verified target may navigate. Render selected song with saved transpose, then calculate lyric match and scroll |
| New coherent presentation in ASSISTED | Show confirmable suggestion in fullscreen; no selection until user accepts |
| Unmatched/ambiguous presentation | Keep displayed song/position; no highlight from a different song. Manual chooser inside fullscreen only |
| Manual song/queue navigation | MANUAL_OVERRIDE; cancel pending effects, clear unrelated highlight. Explicit “Resume following” rechecks current external state |
| Manual scroll/section navigation | MANUAL_PAUSED scrolling; remain on current follow mode. Continue highlighting new matching slides for the displayed verified song |
| Modal, drawer, editor intent or competing BandSync follower | SUSPENDED; no programmatic selection/scroll behind it. On return obtain fresh verification; no delayed jump |
| Hidden page/disconnect/schema failure | Mark last highlight stale, freeze viewport, invalidate coherence and cancel work. Keep chart usable; reuse follower lifecycle |
| Reconnect/visible | Reconcile fresh state, not buffered transitions. Only verified fullscreen session can resume; preserve MANUAL_PAUSED and MANUAL_OVERRIDE |

Manual scroll pause does not itself stop an explicitly enabled AUTO song change. A newly followed song still renders, but its viewport is not programmatically moved to a lyric until Resume; existing song-change reset behavior is acknowledged. A user who wants to hold a song uses Pause following or manual song navigation.

## Highlighting and scrolling are independent

StageView receives immutable active lyric IDs and one optional verified scroll range. SongLineRenderer decorates lyric spans/wrappers only; chord foreground, hit targets, line height, spacing and chord diagrams remain unchanged. Use existing theme variables for a low-opacity background and small non-color-only edge cue; check light/dark/high-contrast modes. No dimming other lyrics, blinking, word progress, repeated ARIA lyric announcements or ProPresenter markup insertion. All matched lines update in one render. Stale highlighting uses a visible “Disconnected — last position” label and a subdued treatment; disable clears it entirely.

The separate scrolling controller computes range bounds in the StageView scroll container with top/bottom control and safe-area clearance. If all active content fits and is already visible, no scroll. Otherwise make the verified range visible with minimum movement, clamped to container bounds. If taller than viewport, align its first line and retain highlight on all lines; do not restart a speed loop. Two columns use global anchors and actual DOM rectangles. Honor reduced motion; coalesce newer revisions and cancel older scheduled scrolls after font/layout changes, song changes or fullscreen exit.

Manual intent includes drag/touch movement beyond tap slop, wheel, scrollbar drag, arrow/page keys and section buttons. Touching a chord alone must not pause. Do not infer intent from `scroll` events: programmatic scrolling also fires them. Cancel in-flight smooth motion on manual intent. Show a persistent accessible “Resume auto-scroll” action; no timeout-based resumption, even across slide changes/reconnect/fullscreen re-entry during the session. Resume targets the latest verified range, never replays skipped slides.

Only one scroll owner: continuous rate scrolling and ProPresenter range scrolling cannot run together. Selecting one pauses the other explicitly. In the first implementation, suspend ProPresenter navigation/scroll whenever BandSync is connected or Stage Cast is active, with a fullscreen explanation; this conservative conflict policy avoids existing broadcast paths controlling other devices indirectly. Supporting concurrent cast/sync would need origin-aware broadcast suppression and separate tests, outside the first slice. Observation and manual GTAR use remain functional.

## Recovery, privacy and bounded work

- Preserve existing EOF/read/parse failure retry, jitter, generation cancellation and last-good display. Quiet streaming is normal; elapsed silence alone is not a stale detector. A half-open connection can remain undetected until transport reports failure: show last verified receipt time, not a guaranteed freshness claim. No unverified heartbeat or fallback polling is added.
- On either feed failure, stale both identity/position for consumer effects. Late frames from an old generation cannot select/highlight/scroll. Null identity clears live match; invalid schema preserves only stale last-known UI. Permission failure is explained without guessing CORS versus network from generic fetch errors.
- Keep slide payloads, normalized tokens, candidate ranges and dedupe values in memory only. No logger, telemetry, error payload, localStorage, IndexedDB, service-worker cache, backup, cloud sync or issue attachment receives slide text. Avoid stringify-ing snapshots into diagnostics; local UI renders plain text through React. Do not automatically capture Network response bodies during QA.
- Active metadata can include many lyrics: project only needed identity/membership in memory, discard other fields, bound response/frame and candidate work. Proposed matcher limit: 100,000 tokens per chart, 4,096 tokens per slide; over-limit yields “Too large to match”, no follow effects. Stream bytes remain capped by existing framing. Build index lazily for matched song, cache at most current song revision; release on disable/account change.
- No new dependency, backend, Google credential path, migration, Cloudflare policy, PROD operation or Android legacy code. No writes to ProPresenter, including discovery/QA. Any future version upgrade repeats real device verification.

## Implementation slices and acceptance tests

Smallest implementation-ready first slice: project validated presentation UUID/index in the existing follower, expose the scoped ephemeral snapshot seam, and build the pure exact lyric matcher with synthetic fixtures. In fullscreen only, allow a user to explicitly confirm/link the **already displayed** song for this session and see simultaneous exact highlights. Keep cross-song navigation and automatic scrolling unavailable until real stream correlation/membership evidence is supplied. This slice reuses transport without inventing active metadata; it is independently useful and fails closed on presentation changes/disconnect. No persistent schema or general events bus is needed to prove it.

Subsequent slices:

| Slice | Scope / prerequisite | Focused proof |
|---|---|---|
| A — first slice | UUID/index validation, typed ephemeral output, pure lyric projection/exact matching, same-song confirmed fullscreen highlight | Real fixture schema/null/bad values; chord-free projection, duplicates, wrapping, disabled effects, fullscreen exit |
| B — coherent identity + links | Real active samples approved; membership adapter, durable local links, two observation events only where consumed | Split streams reordered; active response arrives after new UUID; reused UUID; missing/deleted link; duplicate titles; account/source changes; no lyric storage |
| C — song navigation | AUTO/ASSISTED state machine and App queue guard; verified B | Wrong view/editor/fullscreen exit/modal/manual override; repeated setlist occurrence; no silent queue switch; fresh re-entry and reconnect |
| D — scroll visibility | Verified unique ranges; manual-intent/resume, global anchors, subtle highlight polish | Touch/wheel/keyboard/section pause, highlight continues, chord tap unchanged, oversized slide, two columns, resize, reduced motion, conflict suspension |

Add fast tests using existing TypeScript-transpile/node:test and DOM fixture patterns, without new test dependencies. Extend `proPresenterFollower.test.cjs` and `extensionHost.test.cjs`; reuse `songParser.test.cjs`, `fullscreenStageQol.test.cjs`, `stageLifecycle.test.cjs`, `stageSectionNavigationDock.test.cjs`, `stageContinuityInput.test.cjs` and `stageSessionPersistence.test.cjs` fixtures/guards rather than rewriting navigation.

Required cases include:

- Unique UUID wins despite renamed title; duplicate title, blank title, stale link and conflicting links never navigate; manual link explicit and account scoped.
- Unicode punctuation/diacritics, chord-over-lyric pairs, inline ChordPro, blanks, TAB, short “amen”, repeated chorus, duplicate lines in one section, partial/missing lyrics and backwards slides. Only current text contributes; next text never highlights early.
- Equal UUID/text after reconnect updates freshness/coherence; same UUID with edited text recomputes; final empty next is valid. Out-of-order generations cannot leak old highlights into a new song. Unknown schema fails closed.
- Highlight set independent of scroll pause; ambiguous occurrence highlights all verified ranges without moving viewport. First/second-column IDs stay distinct.
- Byte-for-byte chart/key metadata and saved TRANSPOSE_OFFSET unchanged after every follow transition. No call to chart-save/transpose setters and no extra BandSync/Stage Cast message. Songbook/editor remain manual.
- Disable before/after async load, hidden resume, storage failure, offline manual operation and no lyrics in logger/persistence/backup paths. No network requests when disabled beyond explicit disable-settings persistence; no forbidden methods/URLs.

For later application PRs run targeted tests first, then `npm test` from `web/`, full `npm run --prefix web lint`, and `npm run --prefix web lint:sync`; update catalog with `node web/scripts/test-catalog.cjs --write` if test files change. Scale/workerd/release tiers only if the implementation touches those concerns; `test:all` only when requested. This RnD PR changes no `web/` files: document scope/link/diff checks only; runtime suites and device QA are NOT RUN.

### Real samples required — BLOCKED_SAMPLE

Owner runs GET-only probes against E14 ProPresenter 7.13 demo using synthetic/licensed sample text. Inspect responses in memory; record structural facts and sanitized UUID/index mappings on GitHub, not raw church lyrics. Commit only explicitly approved synthetic structural fixtures in a later PR.

| Sample | Decision it unlocks |
|---|---|
| `/v1/presentation/active` initial and chunked shapes, null/no-active case, groups/slides/UUID paths | Actual validator and membership adapter; whether a third stream is useful or an on-change GET suffices |
| Both existing feeds plus active metadata while switching A→B→A rapidly | Stream ordering, identity/slide correspondence, clear transitions and whether coherence can actually be proven |
| Slide indices through groups, backwards steps, repeated/reused slides | Index base/meaning, group occurrence mapping and safe repeated-section scrolling |
| Same slide edited without UUID change, re-import/copy/rename presentation | Content revisions, UUID stability and durable-link expectations |
| Representative slide/chart pairs with duplicates, differing line breaks, short lines and non-lyric slides | Exact coverage/normalization limits and threshold calibration; fuzzy matching stays deferred |

### E14 + Android Chrome QA plan — NOT RUN in this task

Record DEV preview head/origin, E14 ProPresenter 7.13 demo build, tablet model, Android/Chrome versions, local-network permission and network. Use Android normal Chrome tab first, installed PWA separately. The owner changes slides in ProPresenter; GTAR only GETs. Do not visit PROD or disable browser security.

| Scenario | Expected acceptance |
|---|---|
| OFF, then enable/confirm same song in fullscreen | OFF has no follower work; confirmed exact lyrics highlight together with chords readable; songbook/editor never move |
| Two presentations; unique link, duplicate title, missing link | Verified AUTO navigates only inside fullscreen; ASSISTED waits for acceptance; ambiguity holds current song and offers manual linking |
| Forward/backward, repeated chorus, blank/title/instrumental slide, final slide | Highlight follows current text; all duplicates highlighted, ambiguous scroll held; blank/unmatched clears live highlight; final next empty accepted |
| Drag/wheel/keys/section, then several slide changes | Highlight updates but viewport stays under user control; explicit Resume moves to latest verified range only |
| Escape, editor/modal open, fullscreen re-entry | No delayed jump outside fullscreen; re-entry uses a fresh verified state |
| Tablet Wi-Fi off/on, API close/reopen, PC sleep/wake, wrong IP, permission deny/re-allow | Last position usable/stale; no unverified selection; bounded retries/cleanup; restored coherence required before effects |
| Two or more Android direct followers, then intended five-device audience | Each independently reads E14; no relay; report latency/request count and failures without extrapolating single-device success |
| Large font, landscape/two columns, dark/light/custom theme, reduced motion | Correct global line anchors, readable subtle cue, chords unaltered, controls don't obscure active range |
| Saved nonzero transpose, repeated setlist entry, BandSync/Stage Cast conflict | PERFORMANCE_KEY and TRANSPOSE_OFFSET unchanged; occurrence ambiguity explicit; first-slice follow effects suspended during other sync ownership |

Record PASS/FAIL/BLOCKED/NOT RUN per case with expected versus actual behavior and sanitized structural evidence. Historical follower QA is not song-follow QA. Church network needs its own later smoke/permission test; newer ProPresenter releases remain out of scope.

## Delivery boundary

This PR adds this document only, links #504 without closing language, stays draft against `dev`, and does not change issue status. No implementation, merge, tag, deployment or production change is authorized by the design. Full automation is ready to implement behind the explicit sample gates; those gates do not block review of this RnD or the conservative first slice.
