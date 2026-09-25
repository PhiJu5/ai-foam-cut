# AI Foam Cut – User Manual (detailed)

> Version: 1.07 · App language: German by default (switch to English under
> *⚙ Settings*). Tab and group names below give the German original in
> parentheses so you can match either UI language.
> This manual is updated **only on explicit request** — not on every program
> change. For ongoing changes see the [CHANGELOG](CHANGELOG_EN.md).

AI Foam Cut designs wings and generates G-code for **CNC hot-wire cutters**
(2 towers / 4 axes) to cut styrofoam/EPP cores. Everything runs locally.

**This manual describes every command.** It follows the program interface: first
the header, then the tabs, and within each tab the groups of the left-hand
**sidebar** plus the controls in the view on the right.

---

## Contents
0. [What's new since v1.06](#0-whats-new-since-v106)
1. [Basics](#1-basics)
2. [Header (global commands)](#2-header-global-commands)
3. [Tab "Material" (Werkstoff)](#3-tab-material-werkstoff)
4. [Tab "Wing designer" (Tragflächendesigner)](#4-tab-wing-designer-tragflächendesigner)
5. [Tab "Core design" (Kerndesign)](#5-tab-core-design-kerndesign)
6. [Tab "Negative shell design" (Negativschalendesign)](#6-tab-negative-shell-design-negativschalendesign)
7. [Tab "DXF shapes" (DXF-Formen)](#7-tab-dxf-shapes-dxf-formen)
8. [Tab "DXF export" (DXF-Export)](#8-tab-dxf-export-dxf-export)
9. [Tab "G-code" (G-Code)](#9-tab-g-code-g-code)
10. [Tab "Machine" (Maschine)](#10-tab-machine-maschine)
11. [Tab "Cutting" (Schneiden)](#11-tab-cutting-schneiden)
12. [Windows/dialogs](#12-windowsdialogs)
13. [Core concepts](#13-core-concepts)

---

## 0. What's new since v1.06

What you as a user will find new or different in the current version (1.07):

**New features**
- **Global sweep:** keep the leading edge, trailing edge or hinge line straight
  across several segments — also in groups (e.g. two segments straight, then a
  break, then two straight again).
- **Global profile height alignment:** align all profiles automatically to a
  common reference (highest/lowest point, hinge line or chord) instead of
  entering each height individually.
- **Shell cut (core design):** optional flat trapezoidal cuts for the upper and
  lower shell, to compensate the higher burn at the outboard end and yield level
  shells *(experimental — please verify on a real cut)*.
- **Freely named files:** projects and settings can be saved under your own name
  (previously everything was called "hotwing").
- **Collapsible hints:** under *⚙ Settings → Feature descriptions* the hint texts
  at the fields can be hidden and shown individually via a **"?"** for a tidier
  interface.

**Better dimensioning in the 3D simulation**
- The distance from origin to the rear **block cut** is now shown separately for
  **inner** and **outer** on a tapered block.
- In the **negative shell design**, with a constant shell margin the distance to
  the rear reference cut (inner/outer) is also shown; misleading dimensions to the
  bare block edge are removed there.

**Reworked heat-up phase**
- The heat-up phase now lives on the **"Material"** tab (no longer "Machine") and
  is saved with the material.
- The wire now **dwells on the first descent** briefly at an adjustable **heat-up
  height** (default 10 mm) for the **heat-up time** (default 3 s) — right before
  entering the material, instead of moving up at program start.

**Operation & display**
- The **block-to-portal distance** command is now under **block position**
  (previously in the G-code menu).
- **Block boundary** and **shell margin** (inner/outer) can be set separately for
  color and line style (default: inner solid, outer dashed).
- Clearer labels and legends; more prominent headings in the settings window.

**Fixes**
- Fixed a bug in the **leading-edge extension**.
- Fixed wrong **cut order for stacked + mirrored cores** (now reliably top to
  bottom).

---

## 1. Basics

- **Zoom/pan in all views:** mouse wheel = zoom to pointer, drag = pan,
  double-click = reset view.
- **Active segment:** only the active segment is expanded in the sidebar. Click a
  segment in the plan view **or** tap the group header to activate it.
- **Hints (ℹ):** under *⚙ Settings* the small feature descriptions can be shown or
  hidden; when hidden, a "?" button appears per field.
- **Recommended workflow:** Material → Wing designer → Core design → G-code →
  Machine → Cutting.

---

## 2. Header (global commands)

Always visible top right:

| Command | Function |
|---------|----------|
| **Load profile (.dat)…** | Loads a profile file (`.dat`/`.cor`, Selig or Lednicer format) for the active segment. |
| **Save project** | Saves the whole project (all segments, core, machine …) as JSON with a chosen name. |
| **Load project…** | Loads a previously saved project JSON. |
| **Save settings** | Saves **machine & material settings** as `hotwing-settings.json`. If placed in the program folder it is loaded automatically at startup. |
| **Load settings…** | Loads a settings file. |
| **⚙ Settings** | Opens the settings dialog (language, colors, hints). See [12](#12-windowsdialogs). |

---

## 3. Tab "Material" (Werkstoff)

Defines the raw material and its cutting parameters. Values are set in the sidebar.

**Group "Material":**
- **Type** – material from the library.
- **Height / thickness (mm)** – thickness/height of the raw block.
- **Safety height above block (mm)** – clearance the wire travels above the block
  (safety height = block height + this value).
- **Name** – label of the (custom) material.
- **Category** – material category.
- **Density (kg/m³)** – material density (documentation/library).
- **Feed (mm/min)** – default cutting speed for this material.
- **Burn (mm)** – calibrated kerf (cut gap) for this material.
- **Wire heating** – default heating power (%) for this material.
- **Dwell at origin (s)** – wait time at the start point (e.g. let the wire reach
  temperature).

**Group "Heat-up phase":** *(here since 1.07, previously under "Machine")*
- **Heat-up time (s)** – time the wire dwells to preheat (default 3 s).
- **Heat-up height (mm)** – height above origin where the wire briefly dwells on
  the **first descent** before entering the material (default 10 mm). Heating thus
  happens within the normal program run, right before entry. *(The former "raise
  (mm)" entry is gone.)*

Heat-up values are material-dependent and saved with the material settings.

> Calibration values (burn/feed) can be determined experimentally with the
> **burn calibration** in the "Cutting" tab (see [11](#11-tab-cutting-schneiden)).

---

## 4. Tab "Wing designer" (Tragflächendesigner)

View on the right: **plan** (top view, flight direction up), **profiles**
(cross-section & block) and **elevation** (front view / dihedral). The dividers
between areas are draggable.

### Controls in the profile view (top left)
- **Profiles:** inner + outer / inner only / outer only.
- **Segments:** dropdown to multi-select which segment profiles are overlaid
  ("active only" etc.).
- **Sheeting line** – shows the core contour (profile minus sheeting).
- **Cut trace (burn)** – shows the actual wire path incl. kerf.
- **Burn distribution colored** – colors the cut trace by burn share.
- **Foam block** – shows the raw block.
- **Point numbers** – numbers the sample points.
- **Dimensions** – shows measurements.

### Sidebar

**Group "Segments (n)":** one card per segment with the wing geometry:
- **Root chord / root profile length (mm)** – chord at the inner end.
- **Outer chord / outer profile length (mm)** – chord at the outer end.
- **Span (mm)** – length of the segment (= panel length, not projection!).
- **Sweep LE offset (mm)** – sweep as leading-edge offset.
- **Washout outer (°)** – washout at the outer end.
- **Root rib height / start height (mm)** – vertical mounting start height.
- **Dihedral as** – dihedral either as *height (mm)* or *angle (°)* relative to
  the previous segment.

*Profile per segment:* use **Load profile (.dat)…** (header) to set the outer
profile of the active segment; the inner profile is automatically the outer
profile of the previous segment (continuous joints).

**Group "Add segment":**
- **+ Add segment** – appends another segment.

**Group "Spar cutouts (n)":** manage the spar pockets (global, across segments).
Per cutout:
- **Side** – which profile side (top/bottom/…).
- **Position inner (% from rear)** / **Position outer (% from rear)** – position
  along the chord at the inner/outer end.
- **Split** – splits the cutout.
- **Split over** – reference for the split.
- **Position (% from inner)** / **Position (mm from inner)** – span position.
- **Shape** – geometry of the cutout (rectangle, round …).
- **Size in** – unit of the dimensions.
- **Diameter / Width / Height** – dimensions at the inner end.
- **Taper top (0–1)** – 0 = no taper (rectangular), 1 = top edge tapers to zero.
- **Outer size differs** – allows separate dimensions at the outer end:
  **Diameter outer / Width outer / Height outer**.
- **Height offset to center (mm)** – vertical offset.
- **Approach** – lead-in/lead-out strategy into the pocket.
- **From segment (root)** / **To segment (outer)** – which segments it spans.
- **Parallel to flight direction** / **Horizontal** – orientation.

**Group "Shape (global)":**
- **Points per profile (resolution)** – sample points per profile (120–200 usual;
  more = finer, but longer G-code).
- **Rotation/reference point (washout)** – washout pivot as chord fraction
  (0 = LE, 0.25 = quarter chord, 1 = TE).

---

## 5. Tab "Core design" (Kerndesign)

Defines how the wing geometry becomes the core to be cut.

### Sidebar

**Group "Block geometry (per segment)":** per segment:
- **Total block height (mm)** – raw block height for this segment.
- **Overhang front / nose (mm)** – cut extension ahead of the leading edge.
- **Overhang rear / trailing edge (mm)** – extension behind the trailing edge.
- **Shell-edge overhang constant (mm)** – sheeting-independent overhang.
- **Pull top/bottom apart (mm)** – vertical offset for thicker blocks / dihedral.
- **Cut trace (burn)** – show the wire path.
- **Burn distribution colored** – colored burn display.
- **Dimensions** – show measurements.

**Group "Burn and sheeting":**
- **(Burn mode)** – dynamic or by profile-length ratio.
- **Sheeting thickness (mm)** – subtracted from the contour (core gets smaller).
- **Burn charged to shell** – *both (symmetric)* / *upper shell exact* / *lower
  shell exact*. The core always stays at nominal size; only one shell side can fit
  exactly.

**Group "Shell cuts":** *(experimental)*
- **Cut upper/lower shell (trapezoid)** – two horizontal separating cuts (upper
  shell before, lower shell after the core cut) as a slight trapezoid to
  compensate higher outboard burn.
- **Shell thickness top (mm)** / **Shell thickness bottom (mm)**.

**Group "Profile height alignment":**
- **Align profiles globally** – enables global height alignment.
- **Align to** – reference: highest/lowest profile point, hinge line or chord
  (instead of per-segment manual entry).

**Group "Global sweep":**
- **Global sweep** – keeps hinge line / LE / TE straight across several segments
  (with group logic: e.g. 2 straight, break, 2 straight).
- **Sweep as** – reference line of the global sweep.

**Group "Mirror & stack":**
- **Cut upside down (bottom up)** – cut the core flipped.
- **Stack (count)** – several cores per cut.
- **Stack spacing (mm)** – gap between stacked cores.
- **Shift stack vertically (mm)** – vertical offset of the stack.
- **Mirror alternately** – mirror every other core.

**Group "Spar cutouts":**
- **Cut spars (G-code)** – include spar pockets in the G-code.
- **Burn compensation** – kerf compensation for the spar cutouts.

**Group "Show profiles":**
- **All segments** – overlay all segment profiles.
- **Segment …** – toggle individual segments.

**Group "Cut extension (type)":**
- **Cut extension LE (type)** – leading edge: *X-loop at the nose* / *horizontal
  forward* / *none*.
- **Angle to centerline (°)** – angle of the X-loop (default 45°).
- **Spacing of horizontal lines (mm)** – parameter of the horizontal variant.
- **Cut extension TE (type)** – trailing edge: *horizontal (2 webs)* / *along
  camber line (curved)* / *none*.
- **Cut extension always over block** – always run the web past the block.
- **Distance over block (mm)** – associated overhang.

---

## 6. Tab "Negative shell design" (Negativschalendesign)

Creates negative mold shells (analogous to the DXF view). The view shows the
cross-section; top left **Profiles:** inner + outer / inner only / outer only.

**Group "G-code source":**
- **G-code source** – which design source the negative shell uses.

**Group "Core & support material (negative shell)":**
- **Cut core too** – cut the core in addition to the shell.
- **Sheeting deduction core (mm)** – sheeting for the co-cut core.
- **Nose loop vertical (mm)** – lead-in/out loop at the nose.
- **Cut support material** – also generate support material *(work in progress)*.
- **Gap to shell (mm)** – gap between support material and shell.
- **Support material thickness (mm)** – thickness of the support material.

---

## 7. Tab "DXF shapes" (DXF-Formen)

Loads DXF contours, assigns layers to the profile planes and synchronizes the
points of both planes. Also usable for drawing shapes from scratch without a DXF.

Bottom left (while drawing): **coordinate entry** – exact point input as `x,y`
(absolute), `@dx,dy` (relative) or `length<angle` (polar); Enter places the point.

### Sidebar

**Group "DXF import":**
- **(Load DXF)** – opens a `.dxf` file.
- **Layer INNER (left plane)** – assign layer of the inner contour.
- **Layer OUTER (right plane)** – assign layer of the outer contour.

**Group "Block geometry":**
- **Segment width (mm)** – width/span between the planes.
- **Show block boundary** – show the block edge.
- **Add front (mm)** / **Add rear (mm)** – material allowance lengthwise.
- **Margin top/bottom (mm)** – material allowance vertically.

**Group "Sync points":**
- **Distribution** – how sync points are distributed over the contour.
- **Point density (pts/mm)** – resolution of the synchronization.
- **Total points** – resulting total point count.

  *Syncing:* click point pairs of the INNER/OUTER contour so the wire cuts exactly
  through both profiles.

**Group "Cut":**
- **Burn calculation** – method of the kerf calculation.
- **Direction of travel** – cut direction (CW/CCW).
- **Compensate burn** – add kerf outward.
- **Show cut trace** – show the wire path.
- **Safe lead-in/out** – safe approach/retract move.

**Group "Edit points":**
- **Editing active** – enables the point editor.
- **Target** – *profile* (raw INNER/OUTER contour) or *cut path* (frozen path with
  kerf baked in).
- **Tool** – move / add / delete points (with undo/redo).

**Group "Edit (CAD)":**
- **Edit mode** – enables the CAD drawing tools.
- **Active layer (target)** – which layer is drawn onto.
- **Snap (endpoints)** – snap to endpoints.
- **Crosshair** – show crosshair.
- **Show grid** / **Snap to grid** / **Grid spacing (mm)** – helper grid.

**Group "Background image":** (reference image for tracing)
- **(Load image)** – loads a background image.
- **Visible** – show/hide.
- **Opacity (%)** – transparency.
- **Position X (mm)** / **Position Y (mm)** – move.
- **Width (mm)** – scale by width.
- **Scale (%)** / **Rotation (°)** – size and rotation angle.

---

## 8. Tab "DXF export" (DXF-Export)

Exports selected content as DXF. The view shows a preview of the chosen layers.

**Group "Contents (check)":** which elements are exported:
- **Wing plan (with profile position, hinge, dimensions)**
- **Elevation (front view / dihedral)**
- **Profiles — real position**
- **Profiles — stacked on chord**
- **Cut path at workpiece (per segment)**
- **Cut path at tower (per segment)**
- **Spar cutouts (plan + profiles)**
- **Sheeting (core contour in profiles)**
- **Core (profile cut)**
- **Negative shell**

**Group "Design plane":** reference plane of the export.
**Group "Segments":** selection of segments to export.
**Group "Export":** triggers the DXF export.

---

## 9. Tab "G-code" (G-Code)

Left the **3D simulation**, right the **program text**. Generates the G-code from
the chosen source.

### Sidebar
The **"G-code / axes"** group and others are shared with the Machine tab
(see [10](#10-tab-machine-maschine)) — including source, axis names, decimals.

### Simulation bar (below the 3D view)
- **▶ Start** – start simulation. **⏹ Reset** – reset.
- **⬇ Top view** / **➡ Side view** / **⬅ Front view** – fixed viewpoints.
- **Speed** – 1× … 200× playback speed.
- **Slider** – scrub the position in the program.
- **Towers / Cut paths / Block / Cut surface / Dimensions** – visibility toggles.
- **Info text** – status (e.g. "no program").

3D navigation: drag = rotate, Shift+drag = pan, wheel = zoom, double-click = reset.
The currently executed line is highlighted; **feed jumps (≥ 10 %)** are marked red
and counted.

### Action bar (bottom)
- **Download G-code (.gcode)** – save the program as a file.
- **To clipboard** – copy the G-code.
- **✏ Edit** – edit G-code by hand; then **✓ Apply** or **✕ Cancel**.
- **↻ Regenerate** – discard manual changes, regenerate from parameters.

---

## 10. Tab "Machine" (Maschine)

Machine parameters (sidebar) and control/connection (view on the right).

### Sidebar

**Group "Machine geometry":**
- **Tower distance (mm)** – distance between the two towers.
- **Max travel horizontal (mm)** / **Max travel vertical (mm)** – work area.
- **Max feed (mm/min)** – caps all moves.

> Note: the **heat-up phase** has been on the **"Material"** tab since 1.07
> (see [3](#3-tab-material-werkstoff)).

**Group "Cut, block and spars":**
- **Cut order** – *block cut before profile cut* / *… after …* / *block cut only*
  / *no block cut*.
- **Wing** – which segment as G-code ("All" = one file with all).
- **Speed outside block** – approach/retract moves in air: *maximum* / *same as
  cut* / *free choice*.
- **Outside feed (mm/min)** – value for "free choice".

**Group "Block position at origin":**
- **Distance in flight direction X (mm)** – X distance origin ↔ block.
- **Height above origin Y (mm)** – Y position of the block.

**Group "G-code / axes":**
- **Axis L horiz. / L vert.** – axis names left tower (default `X` / `Y`).
- **Axis R horiz. / R vert.** – axis names right tower (default `Z` horizontal / `A` vertical).
- **Decimals** – precision of the coordinates in the G-code.

**Group "Display":**
- **Sheeting line** / **Point numbers (every 10)** / **Foam block** / **Dihedral
  (mounting position)** / **Hinge line in plan** – display toggles.

### View: control (grblHAL / Mega 5X)

**Card "Connection":**
- **Controller** – *grblHAL* or *Mega 5X (grbl-mega-5x)*.
- **Baud rate** – 115200 / 250000 / 57600.
- **Choose port & connect** – open Web Serial connection (Chrome/Edge).
- **GRBL settings** – opens the `$$` dialog (see [12](#12-windowsdialogs)).
- Status indicator (disconnected/idle/run/alarm).

**Card "Position":** DRO (digital axis readout).
- **Set home** – set current position as machine origin (X0/Y0); readout jumps
  to 0.

**Card "Jogging":**
- **Step [mm]** – 0.1 / 1 / 5 / 10 / 50.
- **Feed [mm/min]** – jog speed.
- **Axis buttons** – move each axis manually (manual homing).

**Card "Wire heating · M3 S / M5":**
- **Slider (0–100 %)** – heating power. **Set** – apply (`M3 S`). **OFF** –
  heating off (`M5`). Duty = S / $30.

---

## 11. Tab "Cutting" (Schneiden)

Run programs on the machine with a live simulation running alongside. Full width:
left 3D simulation + DRO + jogging, right program + console.

### Sidebar (block cut-to-size / calibration)

**Section "Block cut-to-size":**
- **Group "Guillotine":** **Height (mm)**, **Angle (°)** – guillotine cut.
- **Group "Cut block to length (vertical)":**
  - **1st cut: distance from origin X (mm)** – position of the first cut.
  - **Block length (mm)** – desired block length.
  - **Block height Y (mm)** – height for the cut-to-length cut.
- **Group "Block horizontal":**
  - **Mode** – variant of the horizontal cut.
  - **X distance from origin (mm)** – start position.
  - **Block length X (mm)** – length of the horizontal cut.
  - **Height top yTop (mm)** / **Height bottom yBot (mm)** – cut heights.

**Section "Calibration":**
- **Group "Burn calibration":**
  - **Material** – material for the calibration cut.
  - **Length (mm)** – length of the calibration cuts.
  - **Count** – number of test cuts.
  - **Stacked spacing (mm)** – spacing of stacked test bodies.
  - **X distance from origin (mm)** / **Distance from floor (mm)** – position.
  - **Cut with burn compensation** – add kerf in advance.
  - **Test cut with feed** – feed variant of the test.
  - **Feed slow / burn slow** – slow value pair.
  - **Feed fast / burn fast** – fast value pair.

### View

**Card "3D simulation · follows execution":**
- **▶ Simulate** – dry run of the chosen program (before cutting).
- **⏹ Reset** – reset.
- **⬇ Top / ➡ Side / ⬅ Front view** – viewpoints.

**Card "Position":** DRO + **Set home** (like the Machine tab).

**Card "Jogging":** step / feed / axis buttons (like the Machine tab).

**Card "Program":**
- **Choose G-code source** – *G-code (core/negative shell)* / *block* /
  *guillotine* / *block horizontal* / *burn calibration*.
- **Apply source** – load the selected source as the current program.
- **Choose file** – alternatively load a `.gcode/.nc/.ngc/.tap/.txt` file.
- **Program view** – shows the program line by line, current line highlighted.
- **Start** – start streaming to the machine. **Pause** / **▶ Resume**.
- **Stop** – halt the program. **⏹ Abort cut** – abort the cut.
- **⌂ Move to origin** – move back to the origin.
- **Speed / progress** – actual feed and line counter + bar.

**Card "Console":**
- **MDI input** – enter a manual GRBL command (e.g. `G0 X10`).
- **Send** – dispatch the command.

**■ E-STOP — FEED HOLD** – immediate feed hold.
*Does not replace a hardware emergency stop — wire & motors must remain physically
switchable off.*

---

## 12. Windows/dialogs

### GRBL settings ($$)
Reads all board settings:
- **Filter (no. or text)** – search the list.
- **Value fields** – change individual settings (changed rows are highlighted).
- **Reload** – fetch settings from the board again.
- **Set directly: $No = value → Set** – write a single `$n=value`.
- **Save changes** – write all changed values to the board.

### Edit profile (from the wing designer)
- **Point count** – resolution of the profile.
- **Trailing-edge thickness (mm)** – 0 for sheeted profiles.
- **Display:** camber line / chord line / mark points / thickness/camber measures.

### ⚙ Settings
- **Language** – German/English (persisted).
- **Colors** – UI and drawing colors; **Reset all**. Changes take effect
  immediately and are saved. Individual elements (e.g. **constant shell margin
  inner/outer** and **block boundary inner/outer** in the negative design) can be
  set separately in color and line style (default: inner solid, outer dashed).
- **Feature descriptions** – hint texts at the fields either **always visible** (as
  before) or **hidden**; when hidden a **"?"** appears per field to show the text on
  demand. In the settings window itself the texts always stay visible.

---

## 13. Core concepts

### Sheeting & kerf – order
1. Final contour (imported profile, scaled to chord)
2. − sheeting thickness → foam core surface, trimmed at the trailing edge
3. + cut extensions (nose and trailing edge)
4. + kerf/2 → actual wire path

### Dihedral
Per segment as height (mm) or angle (°). Standard: pure mounting position (cut
panels flat, dihedral formed at assembly). Optionally computed into the cut (block
must be tall enough).
**Important:** `span` = panel length, not projection
(`length = projection / cos(dihedral angle)`).

### Machine origin (0/0)
Sits **rear/bottom of the block**: `X=0` at the block's rear edge (trailing-edge
side), `Y=0` at the block's bottom edge. The wing body lies in negative X.

### Manufacturing notes
- **Check the axis assignment!** Adapt to your own controller.
- **Kerf** must be calibrated on a test cut (typically 0.8–2.0 mm).
- **Profile pass:** the wire starts at the trailing edge, cuts the top side to the
  nose first, then the bottom side back.
- One core per segment; "All" produces one file with all segments (each with `M2`).
- For the second wing half swap the block side or mirror the profiles.

---

*Please request additions/changes to this manual explicitly.*
