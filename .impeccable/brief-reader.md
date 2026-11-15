# Surface brief: reader window (ui/index.html)

Scope: the whole app window (title bar, outline, reading column, find, status bar, empty state, diagram viewer). Mode: Read.

Audience and job: a developer reading technical Markdown (Vietnamese + English prose, code, tables, Mermaid) next to an editor, with live reload.

Constraints: offline bundled fonts and scripts only; vanilla JS; Vietnamese diacritics in every face; no logo in the title bar.

User decisions: replace the MarkText look; build directly without a direction round (user pinned "you choose, build, I review"); Mermaid needs zoom/pan, fullscreen, Diagram/Source toggle, and working links.

## Direction contract

THESIS: A technical document is a line you travel. The outline is a transit line diagram with stations; the reader always knows which station they are at and how far along the line they are. Refuses the generic gray IDE sidebar with a flat link list.

OWN-WORLD: Station-signage system. Cool near-white ground, deep blue-black ink, one signal vermilion for the line, the current station, and focus. Be Vietnam Pro for every word, JetBrains Mono for code only. Tables set like timetables: heavy head rule, hairline rows, no verticals, tabular figures.

STORY: Open a file, see the route at left, read a calm 70-character column, watch the line fill as you go, open any diagram as a pannable, zoomable map.

FIRST VIEWPORT: Quiet 40px title bar with file name centred; outline at left as a vertical vermilion line with station dots; reading column centred at ~72ch; status bar whose top edge is a progress line.

FORM: Swiss railway timetable and wayfinding signage, an authored own-world: candidate 5 on my own grounded list of 7 (the seed assigns an index into that list, not into its catalog challengers, which were not presented because the user waived the direction round). Seed key c725f93e. Build path: code-led.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
