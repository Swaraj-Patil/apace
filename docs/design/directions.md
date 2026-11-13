# Apace design directions

Two original directions for Apace's interface.

**Decision, 2026-11-12:** Workbench, with page body text at 16/26 instead of 15/24. The interface sizes are unchanged. Step 12 of `docs/plan/phase-1.md` builds the shell from these tokens.

## What both directions share

- Light and dark themes come from one set of tokens. The app follows the system setting unless the person picks a theme.
- There is one accent, kept for what is live: focus, the caret, the current selection, the active page and pane, and links and mentions.
- Both meet WCAG 2.1 AA. Every text pair below is 4.5:1 or better. The focus ring is 3:1 or better against everything it can sit on, selection included. Rules (hairlines) are decorative, so any edge that identifies a control, such as a checkbox or an input, is drawn in the muted ink instead.
- Color is never the only signal. Every state also has words or a shape.
- Dark themes carry the direction's hue (deep sea blue, green graphite) rather than neutral near-black.
- Fonts are self-hosted from Fontsource's Latin subsets, because the app has to start offline. They're preloaded and use `font-display: optional`, so a slow font never repaints the page. The service worker caches them after the first visit.
- Icons are drawn in-house on a 16 px grid. Page icons default to a two-letter monogram tile. People can pick one of the app's glyphs or an emoji instead.
- Neither direction uses shadows, gradients, card grids or all-caps labels. Section labels are sentence case, set apart by weight and color.
- Speed shows on screen. The command bar shows how long the search took, and the sync indicator's details say when the last change was written.
- Keyboard behavior is shared. Ctrl+K (Cmd+K on Mac) opens the command bar from anywhere, including inside the editor. F6 moves between regions (sidebar, each pane, status). Shift+Enter opens a result in split view. Every overlay closes with Esc and returns focus to where it was.

### Sync indicator wording

| State | Words | When |
|---|---|---|
| Local | Saved on this device | Idle. Every change is written to local storage. |
| Writing | Saving… | Writes have been pending for more than 300 ms, so short writes never flicker. |
| Compatibility mode | Saved in this browser (compatibility mode) | OPFS access handles are missing, so SQLite runs in memory while IndexedDB keeps snapshots and the update log. The details say that everything is saved and startup is slower. |
| Storage blocked | Not saved: this browser blocks storage | Neither OPFS nor IndexedDB is available, as in some private windows. Edits last until the tab closes. |
| Waiting | Open in another tab, with a "Use it here" button | No `workspace-db` lock after 1.5 s. |
| Handed over | Moved to another tab, with a "Use it here" button | Another tab took the workspace. |
| Offline (Phase 3) | Offline, saved on this device | No network. Edits keep landing locally. |
| Syncing (Phase 3) | Syncing 14 changes… | Changes are uploading. |
| Sync problem (Phase 3) | Can't reach the server. Retrying in 30 s | The connection keeps failing. |

---

## Direction A: Chartwork

The workspace as a well-made nautical chart. Everything sits on one cool paper surface, and structure is drawn with hairlines rather than boxes. Numbers are set in mono, like soundings. Chart magenta, the color charts reserve for what you must not miss, marks only what is live. Reading text is a serif and controls are a sans, so content and interface are easy to tell apart.

### Color

| Light | Hex | Role |
|---|---|---|
| Paper | `#F6F8F9` | Page and sidebar background |
| Shoal | `#E3ECF1` | Tinted fills: active row, code blocks, callouts, command bar |
| Ink | `#13212B` | Text |
| Sounding | `#4A5D6B` | Secondary text, metadata, block markers, control edges |
| Contour | `#BCCAD3` | Hairline rules (decorative) |
| Magenta | `#A3166E` | Accent |

| Dark | Hex | Role |
|---|---|---|
| Deep | `#12212C` | Page and sidebar background |
| Basin | `#1A2C39` | Tinted fills |
| Foam | `#E6EEF2` | Text |
| Haze | `#9FB2BF` | Secondary text, metadata, block markers, control edges |
| Contour | `#2E4555` | Hairline rules (decorative) |
| Magenta | `#F27DBF` | Accent |

Derived, not palette colors: the selection tint is Magenta at 16% over the background (`#E9D4E3` light, `#363044` dark). Text on the accent uses the background color.

### Contrast

Computed with the WCAG 2.1 relative-luminance formula. A test in step 12 recomputes these from the token file and fails below the threshold.

| Pair | Light | Dark | Needs |
|---|---|---|---|
| Text on background (Ink on Paper, Foam on Deep) | 15.40:1 | 13.97:1 | 4.5:1 |
| Text on tint (Ink on Shoal, Foam on Basin) | 13.70:1 | 12.22:1 | 4.5:1 |
| Secondary on background (Sounding on Paper, Haze on Deep) | 6.42:1 | 7.50:1 | 4.5:1 |
| Secondary on tint (Sounding on Shoal, Haze on Basin) | 5.71:1 | 6.56:1 | 4.5:1 |
| Accent on background (links, mentions, focus ring) | 6.80:1 | 6.61:1 | 4.5:1 |
| Accent on tint | 6.05:1 | 5.78:1 | 4.5:1 |
| Background color on accent (button labels) | 6.80:1 | 6.61:1 | 4.5:1 |
| Text on selection | 11.71:1 | 10.75:1 | 4.5:1 |
| Secondary on selection | 4.88:1 | 5.77:1 | 4.5:1 |
| Focus ring on selection | 5.17:1 | 5.09:1 | 3:1 |
| Contour on background | 1.57:1 | 1.64:1 | Decorative, exempt |

### Type

The pairing is Literata for reading (page titles, headings, block text) and Atkinson Hyperlegible Next for the interface, with Atkinson Hyperlegible Mono for code, timings and shortcuts. Literata was drawn for long reading on screens. Atkinson keeps I, l and 1 apart, and O and 0, which matters in a keyboard-first interface full of short labels. The mono comes from the same family as the sans, so labels and numbers share a skeleton.

| Token | Face | Size / line height | Weight | Use |
|---|---|---|---|---|
| `title` | Literata | 38 / 44 px | 600 | Page title |
| `h1` | Literata | 30 / 36 px | 650 | Heading 1 |
| `h2` | Literata | 24 / 32 px | 600 | Heading 2 |
| `h3` | Literata | 20 / 28 px | 600 | Heading 3 |
| `body` | Literata | 17 / 28 px | 400 | Block text; quotes in italic |
| `input` | Atkinson Hyperlegible Next | 16 / 24 px | 400 | Command bar input |
| `ui` | Atkinson Hyperlegible Next | 14 / 20 px | 500 | Buttons, menus, results |
| `nav` | Atkinson Hyperlegible Next | 13 / 20 px | 400, active 600 | Sidebar rows |
| `code` | Atkinson Hyperlegible Mono | 14 / 24 px | 400 | Code blocks; inline code at 0.92 em |
| `meta` | Atkinson Hyperlegible Mono | 12 / 16 px | 500 | Timings, counts, shortcuts, block markers |

Reading sizes step up by about 1.2 from the 17 px body, and every line height sits on a 4 px grid.

### Spacing, layout and radius

| Token | Value |
|---|---|
| `--space-1` … `--space-9` | 2, 4, 8, 12, 16, 24, 32, 48, 64 px |
| `--sidebar` | 248 px wide, 28 px rows |
| `--rail` | 56 px, the sidebar collapsed to icons |
| `--measure` | 680 px reading column, centered. Full width opens it to 1,200 px with 48 px gutters |
| `--gutter` | 40 px left margin for block markers |
| `--margin-column` | 220 px on the right for the outline and backlinks, from 1,280 px wide. Narrower windows put them under the page |
| `--cover` | 96 px band inside the reading column, not full-bleed |
| `--hairline` | 1 px |
| `--radius-0` | 0 for panes, the sidebar, selections and the cover band |
| `--radius-1` | 2 px for buttons, inputs, checkboxes and the focus ring |
| `--radius-2` | 4 px for the command bar, menus and tooltips |

Overlays are Paper with a 1 px Sounding edge (Haze in dark) and no shadow or scrim, so the page stays visible behind them. The focus ring is a 2 px Magenta outline with a 2 px offset.

### Motion

| Token | Value | Used for |
|---|---|---|
| `--dur-tint` | 100 ms | Hover and selection tints |
| `--dur-move` | 160 ms, `cubic-bezier(0.2, 0, 0, 1)` | The sidebar collapsing to the rail, a dropped block or page settling into its slot, a split pane entering from the right edge |

The command bar, menus and page switches never animate. Jumps to a block or heading don't use smooth scrolling.

With reduced motion, `--dur-move` is 0 and nothing slides. The item that moved or appeared gets a static Shoal highlight for one second instead, removed without a fade. Tint changes stay, since a color change isn't motion. Drag previews still follow the pointer, because that's direct manipulation.

### Main view

```text
┌────────────────────────┬─────────────────────────────────────────────────────────────────────┐
│ Go to...        Ctrl K │  Handbook / Engineering                                             │
│                        │                                                                     │
│ Pinned                 │          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                     │
│   RM  Roadmap          │                                                                     │
│   WN  Weekly notes     │    RP    Release process                       On this page         │
│                        │          Edited 4 min ago · 1,204 words        Checklist            │
│ Pages                  │                                                Rollback             │
│ v Handbook             │    ¶     Every release starts from a green                          │
│   v Engineering        │          main and a passing gate.              Linked from 3        │
│     > Onboarding       │    H2    Checklist                             Weekly notes         │
│┃      Release process  │    [ ]   Freeze the branch                     Roadmap              │
│   > Design             │    [x]   Run the gate                          Onboarding           │
│ > Projects             │    "     Ship small, ship often.                                    │
│ > Archive              │    </>   pnpm gate                                                  │
│                        │                                                                     │
│ Trash                  │                                                                     │
│ Saved on this device   │                                                                     │
└────────────────────────┴─────────────────────────────────────────────────────────────────────┘
```

The sidebar sits on Paper behind a Contour hairline. The active page has a Shoal fill and a 2 px Magenta tick, drawn here as ┃. Block markers in the left margin appear on hover and focus; they're shown here to mark the spot. The right margin column holds the outline and backlinks from 1,280 px wide. The cover is a band inside the column.

### Split view

```text
┌──────┬───────────────────────────────────────────┬───────────────────────────────────────────┐
│ Go   │  Handbook / Engineering                   │  Projects                                 │
│      │  ━━━━━━━━━━━━━━━━━━━━━━                   │                                           │
│ RM   │                                           │                                           │
│ WN   │  RP  Release process                      │  Q3  Q3 launch                            │
│      │                                           │                                           │
│ HB   │  ¶    Every release starts from a         │  ¶    The launch window is the            │
│ PR   │       green main and a passing gate.      │       week of the 14th.                   │
│ AR   │  H2   Checklist                           │  [ ]  Confirm the date                    │
│      │  [ ]  Freeze the branch                   │  [ ]  Draft the announcement              │
│ +    │  [x]  Run the gate                        │                                           │
│ Tr   │                                           │                                           │
│Saved │                                           │                                           │
└──────┴───────────────────────────────────────────┴───────────────────────────────────────────┘
```

The sidebar is collapsed to the icon rail here. Each pane scrolls on its own. The Magenta rule under the path marks the pane with focus, and F6 moves focus between panes.

### Command bar

```text
┌──────────────────────────────────────────────────────────────┐
│ rel pro_                                                     │
├──────────────────────────────────────────────────────────────┤
│ Pages                                                        │
│┃ RP  Release process        Handbook / Engineering           │
│  RN  Release notes 2.4      Handbook / Product               │
│  PR  Process review         Archive / 2025                   │
│ Actions                                                      │
│  Open Release process in split view              Shift Enter │
│  Move Release process to...                                  │
│ Create                                                       │
│  New page "rel pro"                               Ctrl Enter │
├──────────────────────────────────────────────────────────────┤
│ 23 results · 4 ms          Up Down move · Enter open · Esc   │
└──────────────────────────────────────────────────────────────┘
```

The command bar opens over the reading column, a third of the way down, with no animation and no scrim. Results are grouped under sentence-case labels, and the selected row has a Magenta tick. The footer gives the result count and the query time in mono.

### Compact sidebar

```text
┌──────┐
│  Go  │  Command bar (Ctrl K)
│ ──── │
│  RM  │  Pinned pages as monogram tiles; the full
│  WN  │  title shows on hover and on focus
│ ──── │
│  HB  │  Top-level pages
│  PR  │
│  AR  │
│      │
│  +   │  New page
│  Tr  │  Trash
│Saved │  Sync indicator in one word; full text on hover and focus
└──────┘
```

### Sync indicator

```text
┌────────────────────────────────────────┐
│ Saved on this device                   │
│ Last change written 2 s ago            │
│ Only on this device; nothing is sent   │
│ anywhere.                              │
│ 182 MB in this browser's private files │
└────────────────────────────────────────┘
┌────────────────────────┐
│ Trash                  │
│ Saved on this device   │  Sidebar footer. Enter or click opens the details above;
└────────────────────────┘  Esc closes them. In the icon rail it reads "Saved".
```

### What Chartwork gives up

- Three font files, two of them variable, instead of one. That's more bytes on the very first visit, though it doesn't affect later starts once they're cached.
- A serif reading column is less dense. Phase 2's database views would set cells in Atkinson, so the app carries two text voices.
- With hairlines instead of planes, regions are told apart by alignment and tint. That gets harder on low-contrast displays.

---

## Direction B: Workbench

A dense, square-edged tool for people who live on the keyboard. The page is a white sheet on a gray bench: two flat planes, no shadows, and 2 px edges. The tree is drawn as track lines. Each block shows its Markdown shortcut in the margin, so the shortcuts are learned by looking. A status bar along the bottom always shows the sync state and live timings, so the speed promise is in view. The accent is patina, the green-blue that forms on worked metal, and it's kept for what is live.

### Color

| Light | Hex | Role |
|---|---|---|
| Sheet | `#FBFBFA` | Page plane |
| Bench | `#E8EBE9` | Chrome plane: sidebar, status bar, command line, code blocks |
| Graphite | `#1D2320` | Text |
| Pencil | `#535D58` | Secondary text, Markdown gutter tags, control edges |
| Scribe | `#B7C0BB` | 2 px plane edges and rules (decorative) |
| Patina | `#12704F` | Accent |

| Dark | Hex | Role |
|---|---|---|
| Sheet | `#252D2A` | Page plane |
| Bench | `#1D2421` | Chrome plane |
| Chalk | `#E4EAE6` | Text |
| Pencil | `#A9B5AF` | Secondary text, Markdown gutter tags, control edges |
| Scribe | `#3E4944` | 2 px plane edges and rules (decorative) |
| Patina | `#76C3A6` | Accent |

Derived, not palette colors: the selection tint is Patina at 14% over Sheet (`#DAE8E2` light, `#30423B` dark). Text on the accent is Sheet in light and Bench in dark.

### Contrast

| Pair | Light | Dark | Needs |
|---|---|---|---|
| Text on Sheet (Graphite, Chalk) | 15.44:1 | 11.57:1 | 4.5:1 |
| Text on Bench | 13.32:1 | 12.97:1 | 4.5:1 |
| Pencil on Sheet | 6.60:1 | 6.67:1 | 4.5:1 |
| Pencil on Bench | 5.69:1 | 7.47:1 | 4.5:1 |
| Patina on Sheet (links, mentions, focus ring) | 5.87:1 | 6.81:1 | 4.5:1 |
| Patina on Bench | 5.06:1 | 7.63:1 | 4.5:1 |
| Text on Patina (Sheet light, Bench dark) | 5.87:1 | 7.63:1 | 4.5:1 |
| Text on selection | 12.65:1 | 8.74:1 | 4.5:1 |
| Pencil on selection | 5.41:1 | 5.04:1 | 4.5:1 |
| Focus ring on selection | 4.81:1 | 5.15:1 | 3:1 |
| Scribe on Sheet | 1.80:1 | 1.51:1 | Decorative, exempt |

### Type

The pairing is the two voices of Recursive, from one variable file. Recursive Sans Linear sets the interface and the reading text. Recursive Mono Linear sets the Markdown gutter, the status bar, the command line and code. The two voices are cut from one skeleton with identical vertical metrics, so a mono tag and a sans line share a baseline in a 24 px row. One file also keeps the first paint to a single font request.

| Token | Voice | Size / line height | Weight | Use |
|---|---|---|---|---|
| `title` | Sans Linear | 29 / 36 px | 800 | Page title |
| `h1` | Sans Linear | 24 / 32 px | 750 | Heading 1 |
| `h2` | Sans Linear | 20 / 28 px | 700 | Heading 2 |
| `h3` | Sans Linear | 17 / 24 px | 700 | Heading 3 |
| `body` | Sans Linear | 16 / 26 px | 400 | Block text |
| `ui` | Sans Linear | 13 / 18 px | 500, active 600 | Sidebar rows, menus |
| `input` | Mono Linear | 14 / 20 px | 500 | Command line |
| `code` | Mono Linear | 13 / 20 px | 400 | Code blocks and inline code |
| `status` | Mono Linear | 12 / 16 px | 500 | Status bar, gutter tags, kind tags |

The axes are MONO 0 or 1, CASL 0 and slnt 0, with weight from `wght`. Body text is 16 px and headings step up from 17 to 29 px. Line heights sit on a 2 px grid for dense rows.

### Spacing, layout and radius

| Token | Value |
|---|---|
| `--space-1` … `--space-8` | 2, 4, 6, 8, 12, 16, 24, 32 px |
| `--sidebar` | 232 px wide, 24 px rows |
| `--rail` | 44 px, the sidebar collapsed to icons |
| `--status` | 24 px status bar along the bottom of the window |
| `--command-row` | 28 px rows in the command line |
| `--gutter` | 48 px left margin for Markdown tags |
| `--measure` | 760 px, left-aligned with a 32 px inset. Full width removes the cap |
| `--cover` | 64 px strip across the top of the sheet |
| `--edge` | 2 px plane edges and pane dividers |
| `--radius-0` | 0 for everything, the focus ring included |

Overlays are Bench planes with a 2 px Scribe top edge and no shadow. The focus ring is a square 2 px Patina outline with a 1 px offset.

### Motion

| Token | Value | Used for |
|---|---|---|
| `--dur-flash` | 240 ms | One Patina tint that fades from an item that just moved, appeared or was restored, so the eye finds it |
| Everything else | 0 ms | The command line, menus, sidebar collapse and split panes appear in place |

With reduced motion, the tint fade becomes a static 1 px Patina outline for 1.5 s, removed without a fade. Smooth scrolling is off in both modes. Drag previews follow the pointer, since that's direct manipulation.

### Main view

```text
┌──────────────────────────┬───────────────────────────────────────────────────────────────────┐
│ Pinned                   │ Handbook / Engineering                                            │
│   Roadmap                │                                                                   │
│   Weekly notes           │ RP  Release process                                               │
│                          │                                                                   │
│ Pages                    │        Every release starts from a green main and a passing       │
│ ├─ Handbook              │        gate.                                                      │
│ │  ├─ Engineering        │  ##    Checklist                                                  │
│ │  │  ├─ Onboarding      │  [ ]   Freeze the branch                                          │
│▌│  │  └─ Release process │  [x]   Run the gate                                               │
│ │  └─ Design             │  >     Ship small, ship often.                                    │
│ └─ Projects              │  ```   pnpm gate                                                  │
│                          │                                                                   │
│ Trash                    │ Linked from 3 pages: Weekly notes, Roadmap, Onboarding            │
├──────────────────────────┴───────────────────────────────────────────────────────────────────┤
│ Saved on this device         Release process               open 18 ms   key 3 ms   Ctrl K    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

The sidebar and status bar sit on Bench; the page is the Sheet. The active page has a Sheet fill and a 2 px Patina bar, drawn here as ▌. The gutter shows each block's Markdown shortcut in Pencil mono, always visible and blank for plain paragraphs. The status bar shows the sync state on the left, then the current page, the last page-open time, and the p95 of the last 100 keystrokes. A setting hides the timings.

### Split view

```text
┌─────┬────────────────────────────────────────────┬───────────────────────────────────────────┐
│ RM  │━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│                                           │
│ WN  │ Handbook / Release process             x   │ Projects / Q3 launch                    x │
│     │                                            │                                           │
│ HB  │ RP  Release process                        │ Q3  Q3 launch                             │
│ PR  │                                            │                                           │
│ AR  │        Every release starts from a         │        The launch window is the week      │
│     │        green main and a passing gate.      │        of the 14th.                       │
│ +   │  ##    Checklist                           │  [ ]   Confirm the date                   │
│ Tr  │  [ ]   Freeze the branch                   │  [ ]   Draft the announcement             │
├─────┴────────────────────────────────────────────┴───────────────────────────────────────────┤
│ Saved on this device     2 panes · Release process       open 18 ms   key 3 ms   Ctrl K      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

The active sheet has a 2 px Patina top edge. Each sheet has its own path strip and close button, and each scrolls on its own.

### Command line

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  ...page content...                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ new     Page "rel pro"                                                            Ctrl Enter │
│ action  Open Release process in split view                                       Shift Enter │
│ page    Process review                 Archive / 2025                                        │
│ page    Release notes 2.4              Handbook / Product                                    │
│▌page    Release process                Handbook / Engineering                          Enter │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ > rel pro_                                                                 23 results · 4 ms │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Saved on this device         Release process               open 18 ms   key 3 ms   Ctrl K    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

The command line opens at the bottom, above the status bar. Results stack upward with the best match nearest the prompt. Mono kind tags separate pages, actions and creation.

### Compact sidebar

```text
┌─────┐
│ RM  │  Pinned pages as square monogram tiles;
│ WN  │  the full title shows on hover and focus
│ ─── │
│ HB  │  Top-level pages
│ PR  │
│ AR  │
│     │
│ +   │  New page
│ Tr  │  Trash
└─────┘
```

The command line lives in the status bar, so the rail holds only pages, new page and trash.

### Sync indicator

```text
┌──────────────────────────────────────────────┐
│ Saved on this device                         │
│ Last write 2 s ago · 182 MB on disk          │
│ Only on this device; nothing is sent         │
│ anywhere.                                    │
├──────────────────────────────────────────────┴───────────────────────────────────────────────┤
│ Saved on this device         Release process               open 18 ms   key 3 ms   Ctrl K    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

The left segment of the status bar is the indicator. Enter or click opens the details panel above it, and Esc closes it.

### What Workbench gives up

- Recursive's MONO axis needs the multi-axis font file, which is larger than three single-axis files on the very first visit. Later starts read it from cache.
- A 16 px sans in a 760 px sheet is less comfortable for long-form writing than a 17 px serif in a 680 px column.
- The always-on Markdown gutter and status bar are visual noise for people who never use shortcuts. Both can be hidden, but they're on by default.

---

## Side by side

| | Chartwork | Workbench |
|---|---|---|
| Feel | Calm, editorial, precise | Dense, mechanical, immediate |
| Surfaces | One paper surface drawn with hairlines | Two flat planes, bench and sheet, square edges |
| Reading text | Literata 17 px in a centered 680 px column | Recursive Sans 16 px, left-aligned, 760 px |
| Accent | Chart magenta | Patina green |
| Command bar | Panel over the reading column | Command line docked at the bottom |
| Block markers | Left margin, on hover and focus | Always visible, as Markdown shortcuts |
| Speed on screen | Query time in the command bar, last write in the sync details | Live open and keystroke timings in the status bar |
| Sync indicator | Sidebar footer, one word in the icon rail | Status bar, left |
| Fonts | Three files | One multi-axis file |
| Motion | Short slides that show where things went | None. A one-shot tint marks what moved |

Workbench was chosen, with the body enlarged to 16/26. Its density and on-screen timings make the speed promise visible everywhere, and its type system carries straight into Phase 2's tables. Chartwork is the better reading experience.
