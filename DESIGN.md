---
name: markdown-look
description: A read-only Markdown viewer set like a transit line diagram and a Swiss timetable.
colors:
  signal-vermilion: "oklch(58% 0.2 31)"
  vermilion-ink: "oklch(52% 0.19 30)"
  idle-track: "oklch(72% 0.012 258)"
  route-blue: "oklch(47% 0.15 256)"
  platform-ground: "oklch(97.4% 0.004 255)"
  page-surface: "oklch(99.6% 0.002 255)"
  raised-white: "oklch(100% 0 0)"
  hover-wash: "oklch(94.6% 0.006 258)"
  hairline: "oklch(91.5% 0.006 258)"
  rule-strong: "oklch(84% 0.01 258)"
  faint-ink: "oklch(63% 0.014 258)"
  muted-ink: "oklch(49% 0.018 258)"
  ink: "oklch(25% 0.02 260)"
  ink-strong: "oklch(17% 0.025 262)"
  code-ground: "oklch(97.2% 0.004 258)"
  code-head: "oklch(95.2% 0.005 258)"
  inline-code-ground: "oklch(95.4% 0.006 258)"
  inline-code-ink: "oklch(36% 0.06 290)"
  diagram-ground: "oklch(98.6% 0.003 258)"
  diagram-dot: "oklch(88% 0.008 258)"
  mark-yellow: "oklch(93% 0.09 95)"
  find-yellow: "oklch(91% 0.12 95)"
  find-current-amber: "oklch(78% 0.17 70)"
  error-ground: "oklch(95.5% 0.03 25)"
  error-ink: "oklch(42% 0.15 27)"
typography:
  display:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "2.25em"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5em"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "1.22em"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.72
    fontFeature: "\"kern\", \"liga\", \"calt\""
  ui:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Be Vietnam Pro, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  mono:
    fontFamily: "JetBrains Mono, Consolas, monospace"
    fontSize: "0.84em"
    lineHeight: 1.65
    fontFeature: "\"liga\" 0, \"calt\" 0"
rounded:
  xs: "5px"
  sm: "6px"
  md: "7px"
  btn: "9px"
  lg: "10px"
  xl: "12px"
  pill: "999px"
spacing:
  hair: "2px"
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  column-x: "56px"
  measure: "64rem"
  titlebar: "40px"
  statusbar: "30px"
  sidebar: "248px"
  rail-x: "22px"
components:
  button-primary:
    backgroundColor: "{colors.ink-strong}"
    textColor: "{colors.page-surface}"
    rounded: "{rounded.btn}"
    padding: "0 18px 0 15px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.vermilion-ink}"
    textColor: "{colors.page-surface}"
    rounded: "{rounded.btn}"
  icon-button:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.md}"
    size: "30px"
  icon-button-hover:
    backgroundColor: "{colors.hover-wash}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.md}"
  text-button:
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 9px"
    height: "26px"
  find-bar:
    backgroundColor: "{colors.raised-white}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.lg}"
    padding: "4px 4px 4px 10px"
  code-block:
    backgroundColor: "{colors.code-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: "14px 16px 16px"
  block-head:
    backgroundColor: "{colors.code-head}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    height: "32px"
    padding: "0 4px 0 14px"
  diagram-block:
    backgroundColor: "{colors.diagram-ground}"
    rounded: "{rounded.lg}"
  inline-code:
    backgroundColor: "{colors.inline-code-ground}"
    textColor: "{colors.inline-code-ink}"
    rounded: "{rounded.xs}"
    padding: "0.12em 0.38em"
  status-bar:
    backgroundColor: "{colors.platform-ground}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    height: "{spacing.statusbar}"
  title-bar:
    backgroundColor: "{colors.platform-ground}"
    textColor: "{colors.ink-strong}"
    height: "{spacing.titlebar}"
---

# Design System: markdown-look

## Overview

**Creative North Star: "The Station Signage System"**

A technical document is a line you travel. The outline is drawn as a vertical transit line with stations; the reader always knows which station they are at and how far along the line they have come. Every surface borrows from Swiss railway wayfinding: a cool near-white platform, deep blue-black ink, and a single signal vermilion that carries the line, the current station, focus, and progress. Nothing else is allowed to shout.

The chrome is quiet and dense (a single 40px toolbar with outline, title-or-tabs, and actions; a 30px status bar; 12–13px UI text) so the reading column can be calm and generous: 16px Be Vietnam Pro at a 1.72 line height on a ~100ch measure. Tables are set like timetables, diagrams open like maps on a dotted ground, and code sits in tinted, hairline-bordered cases. Light and dark are both first-class and share every token name; dark mode lifts the vermilion and cools the ground rather than inverting.

Rejected explicitly: the generic gray IDE sidebar with a flat link list, and the earlier MarkText look.

**Key Characteristics:**
- One accent (signal vermilion) used for line, station, focus, selection, progress, and the primary-button hover; everything else is ink on cool neutrals.
- Outline rendered as a line diagram: a 3px track, ring stations sized by heading depth, segments filling as the reader passes them.
- Section headings (h2) carry the same station ring on a hairline rule, tying the column to the outline.
- Timetable tables: heavy ink head rule, hairline rows, no vertical rules, tabular figures.
- Status bar's top edge is the reading-progress line.
- Flat by default; one soft shadow reserved for floating layers.

## Colors

Cool, low-chroma neutrals tinted toward blue (hue ~258) with a single warm vermilion signal; all tokens are authored in OKLCH and redefined per theme under the same names.

### Primary
- **Signal Vermilion** (signal-vermilion): the line itself. Passed outline track segments and station rings, the current station, the h2 station ring, the status-bar progress edge, the resizer hover rule, the find caret, checkbox accent, text selection (24% mix), and the global focus outline.
- **Vermilion Ink** (vermilion-ink): the text-weight vermilion, darker in light mode and lighter in dark, for anything set as type: the status-bar section counter ("1 / 7"), footnote labels, "Copied" state, the recent-file hover name, and the light-mode primary-button hover.
### Secondary
- **Route Blue** (route-blue): links in prose only, underlined with a 35% mix that goes solid on hover. It is a different signal from the line and never used in chrome.

### Neutral
- **Platform Ground** (platform-ground): title bar, status bar, window background.
- **Page Surface** (page-surface): reading column and outline sidebar; also the hollow fill inside station rings.
- **Raised White** (raised-white): floating layers (find bar, "more" pill, selected tab, kbd, current station fill).
- **Hover Wash** (hover-wash): the only hover fill for icon buttons, outline rows, recent rows, table rows (70% mix).
- **Hairline** (hairline) and **Rule Strong** (rule-strong): 1px dividers; rule-strong for floating-layer borders, blockquote bar, hr, and kbd.
- **Faint / Muted / Ink / Ink Strong**: a four-step text ramp. Faint for paths, placeholders, bullet markers; muted for secondary UI and outline rows; ink for body; ink-strong for headings, the file name, table heads, and the primary button fill.
- **Code Ground / Code Head / Inline Code** pair: tinted cases for code; inline code gets a violet-leaning ink (inline-code-ink) to read as literal without borrowing the accent.
- **Diagram Ground / Diagram Dot**: the map surface, a 16px dot grid.
- **Mark / Find / Find Current**: yellow-to-amber highlights for `==mark==`, find matches, and the current match (current match forces near-black text in both themes).
- **Error Ground / Error Ink**: banner and Mermaid parse-error strip.

### Named Rules
**The One Signal Rule.** Vermilion means "you are here / this is the line / this has focus". It is never used for decoration, headings text, or links.

**The Two Signals, Two Jobs Rule.** Vermilion belongs to the route; Route Blue belongs to prose links. They do not swap.

**The Same Names in the Dark Rule.** Every color token exists under the same name in both `html[data-theme]` blocks; components reference tokens only, never a theme-specific literal.

## Typography

**Display Font:** Be Vietnam Pro (with Segoe UI, system-ui, sans-serif)
**Body Font:** Be Vietnam Pro (same family; weights 400, 500, 600, 700 and 400 italic bundled, with Vietnamese subsets)
**Label/Mono Font:** JetBrains Mono (variable 100–800, with Consolas) for code only

**Character:** One sturdy, signage-like grotesque for every word, from station labels to 36px titles, so hierarchy comes from weight, size, and tracking rather than a second display face. JetBrains Mono appears only where text is literal code, with ligatures off.

### Hierarchy
- **Display** (700, 2.25em of the 16px base, 1.2, −0.025em): document h1; 1.9em under 760px. The empty-state title uses the same voice at 26px.
- **Headline** (700, 1.5em, 1.3, −0.02em): h2 section openers, always on a hairline with a station ring.
- **Title** (600, 1.22em, 1.3, −0.015em): h3; h4 at 1.06em, h5/h6 at 1em (h6 muted).
- **Body** (400, 16px × zoom, 1.72): prose on a 64rem measure (~100ch); `strong` is 600 in ink-strong. Tables at 0.92em/1.55 with tabular figures.
- **UI** (400, 13px): window chrome base; find input 13.5px, outline sub-levels 12.5px.
- **Label** (600, 12px): outline heading, code-block language (lowercase), Recent heading, status-bar counter. Sentence case, no tracking.
- **Mono** (0.84em in blocks at 1.65; 0.86em inline): code, kbd inside articles, samp.

### Named Rules
**The One Family Rule.** Be Vietnam Pro sets every word that is not code, including headings, chrome, and Mermaid labels (15px). No second display face.

**The Tabular Figures Rule.** Any number a reader compares (status counts, zoom %, word count, find count, table cells, ordered-list markers) uses `font-variant-numeric: tabular-nums`.

## Layout

A three-part window: a single frameless 40px toolbar (no OS title bar; drag region + minimize / maximize / close on the right; outline toggle; middle slot shows the file name/directory when one file is open, or an inline tab strip when two or more are open; refresh / open / find / theme before the window controls), a main grid of outline sidebar (default 248px, user-resizable via a zero-width separator with an 8px hit area) plus reader, and a 30px status bar. The reading column is centred at `64rem × zoom + 112px` with 44px top, 56px side, and 96px bottom padding; prose blocks share a 1.1em bottom rhythm, h2 opens with 2.2em above and 0.9em of padding above its text. Right-click uses a slim app menu (Copy, Open/Copy link, Close tab) instead of the WebView2 defaults.

Diagrams may break the measure: they size to `min(100cqw − 48px, max(100%, 1120px))` and centre on the column using a container query on the scroller. Find floats top-right of the reader (12px/20px inset, max 380px). Under 760px the outline hides unless the user opens it, in which case it overlays the reader at `min(300px, 85vw)` with the floating shadow; article padding drops to 28px/22px/72px and the word count is hidden. Chrome spacing steps are 2, 6, 8, 14, 18, 24px.

## Elevation & Depth

Flat by default: depth comes from three tonal layers (platform ground → page surface → raised white) and 1px hairlines. A single two-part soft shadow is reserved for things that float above the document; dark mode deepens it rather than adding glow.

### Shadow Vocabulary
- **Floating** (`--shadow`; light: `0 1px 2px oklch(20% 0.02 260 / 0.06), 0 6px 20px oklch(20% 0.02 260 / 0.1)`): find bar, fullscreen diagram dialog, "more" pill on clipped diagrams, the narrow-window outline overlay.
- **Tab lift** (`0 1px 2px oklch(20% 0.02 260 / 0.12)`): the selected segment of the Diagram/Source toggle only.

### Named Rules
**The Floats-Only Shadow Rule.** If it sits in the document flow, it has no shadow. Only overlays and the selected segment get one.

## Shapes

Small, consistent corner radii that grow with the size of the object: 5px for keycaps, inline code, segment tabs and status buttons; 6–7px for text and icon buttons; 9px for the primary button; 10px for code blocks, diagram blocks and the find bar; 12px for the fullscreen dialog; full pills only for the floating "more" chip and the dialog hint. The recurring silhouette is the circle: hollow station rings (2–3px vermilion stroke on the page surface) in the outline, on h2 rules, and in the empty-state line drawing, and 1px dots on the diagram grid. Borders are 1px hairlines; the only heavy rules are 2px ink rules under table heads and the Recent heading, and the 3px line track.

## Components

### Buttons
- **Shape:** gently rounded (primary 9px; icon 7px; text 6px).
- **Primary:** solid ink-strong with page-surface text, 38px tall, 14px/600, leading icon with 8px gap. Used once, on the empty state.
- **Hover / Focus:** primary turns vermilion-ink (vermilion in dark) and presses down 1px on active, 140ms with the out-expo ease. Every focusable gets a 2px vermilion outline at 2px offset (inset −2px on list rows).
- **Icon button:** 30px square, muted glyph, hover-wash fill + ink-strong on hover, 40% opacity when disabled. Diagram toolbars shrink it to 26px with 14px glyphs; the status bar uses 22px-tall buttons with 13px glyphs.
- **Text button:** 26px, 12px/500 muted with an icon; "done" state turns vermilion-ink (Copy → Copied).

### Chips
- **Segmented tabs (Diagram / Source):** a 2px-padded track tinted from the hairline; the selected tab is raised white with ink-strong text and the tab-lift shadow.
- **More pill:** floating raised-white pill with a rule-strong border, vermilion-ink icon; border turns vermilion on hover. Appears only when a diagram is clipped.

### Cards / Containers
- **Code block:** 10px corners, 1px hairline border, code-ground fill, a 32px head with the language in lowercase muted label type and a Copy text button. Unlabelled blocks hide the head and reveal Copy on hover/focus.
- **Diagram block:** same case, diagram-ground fill; viewport carries a 16px dot grid, grab/grabbing cursors, 260ms eased transform on programmatic zoom. Mermaid uses the `base` theme with hex variables hand-matched to the ink, hairline and vermilion tokens; link nodes get a vermilion stroke and underlined labels.
- **Fullscreen diagram dialog:** 16px inset from the window, 12px corners, rule-strong border, floating shadow, a 44px page-surface bar, a centred pill hint, a 45% ink backdrop, and a 220ms scale-in from 0.98.

### Inputs / Fields
- **Find bar:** raised-white capsule (10px) with rule-strong border and floating shadow; borderless input inside, vermilion caret, faint placeholder; tabular match count turns error-ink at zero. Drops in 6px over 180ms.

### Navigation
- **Outline line diagram:** see Signature Component.
- **Title bar:** frameless platform ground; file name 600 ink-strong optically centred (`left: 50%` + translate) with faint directory; outline toggle on the left; Refresh / Open / Find / Theme then 46px window caption buttons on the right. No logo.
- **Tab strip:** same bar, middle slot (`#titlebar.tabs-open`); hidden with a single open file. With two or more files, tabs replace the centred path and the middle becomes a flex strip between the side clusters. Each tab is `flex: 0 1 200px` (min 96px), 12.5px/500 muted label with ellipsis; the active tab uses surface fill, 600 ink-strong type, and a 2px vermilion bar on its top edge (The One Signal Rule). No shadow on tabs. Duplicate basenames show the parent folder in 11.5px faint. Close is a 20px icon button visible on the active tab or on hover/focus; middle-click also closes. Horizontal overflow scrolls; the strip has no "+" control (Open / Ctrl+O opens files).
- **Status bar:** platform ground, 12px muted text; left shows the vermilion-ink station counter and current section; right shows word count, percent read, and the zoom group.

### Outline Line Diagram (Signature Component)
A 3px vertical track at a 22px rail. Idle segments use idle-track; segments the reader has passed fill vermilion, and the current item's segment is half-filled. Top-level headings (depth 0) are 11px rings with a 2.5px stroke and 600 ink type; depth 1 are 7px rings with a 2px stroke; depth 2–3 are 3px solid dots indented 12/24px at 12.5px. The current station grows to a 13px ring with a 3px vermilion stroke filled raised white, and its label turns 600 ink-strong. Rings animate size over 160ms with the out-expo ease.

### Station Heading
Every h2 sits on a 1px hairline with a 9px hollow vermilion ring centred on the rule at the left edge, echoing the outline station it corresponds to.

### Timetable Table
Full width, collapsed borders, 2px ink-strong rule under the head, 1px hairline under each row, no vertical rules, flush first/last columns (0.2em), tabular figures, and a 70% hover-wash row highlight.

### Reading-progress Edge
The status bar's top border carries a 3px vermilion bar that grows left to right with scroll progress (120ms linear), rounded only on its leading end; hidden when no document is open.

### Empty State
A 168px line drawing of the route (a 3px vermilion stroke with two terminus rings and two stops), the 26px title, a 15px muted hint with keycaps, the primary button, then a Recent list headed by a 2px ink rule with hairline-separated rows.

## Do's and Don'ts

### Do:
- **Do** route every color through the theme tokens so light and dark stay in lockstep.
- **Do** reserve signal vermilion for line, station, focus, selection, and progress (The One Signal Rule).
- **Do** draw new navigational structure as stations on a line: hollow rings on a 3px track, sized by importance.
- **Do** set tables as timetables: 2px ink head rule, hairline rows, no verticals, tabular figures.
- **Do** keep chrome at 12–13px and the reading body at 16px × zoom on a 64rem measure.
- **Do** use the floating shadow only for layers that sit above the document.
- **Do** respect `prefers-reduced-motion`; all animation and transition is disabled under it.

### Don't:
- **Don't** fall back to a gray IDE sidebar with a flat link list for the outline.
- **Don't** introduce a second accent hue in chrome, or use Route Blue anywhere but prose links.
- **Don't** add a second display face; Be Vietnam Pro sets every non-code word.
- **Don't** put a logo in the title bar.
- **Don't** give in-flow blocks (code, diagrams, tables) shadows; they use hairline borders and tonal fills.
- **Don't** draw vertical rules in tables.
