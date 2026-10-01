MARPOL VOYAGE CONTROL — HTML/JS PORT
================================================================

HOW TO OPEN
Double-click index.html. No install, no server, no internet needed.
This zip is the WHOLE app each time - just delete your old folder and use
this one.

PHASES 1-3: everything from the original plan (Dashboard, theming, Admin,
17 MARPOL/ECA areas, Position/Route Check, CSV/Excel/RTZ/RTZP route
import, .shp/.dbf GIS import, World Map, Port Data, Simulator, Reports).

THIS PACK: fixes the "stray lines crossing the ocean" bug on the World Map
  Root cause: when a shapefile shape has more than one part (an island
  separate from the mainland, a ring with a hole - very common in country/
  coastline shapefiles), the parser was flattening every part into one
  continuous line with no break between them. The renderer then drew a
  straight line connecting the end of one landmass directly to the start
  of the next, since it had no way to know they were meant to be separate.

  Fixed at the source: the parser now reads the shapefile's actual "parts"
  index (which marks where each part starts) and keeps them as separate
  rings. The renderer draws each part as its own subpath (pen up, move,
  pen down) instead of one continuous line. Verified with a real test: a
  shape built with a "mainland" near (0,0) and a far-away "island" near
  (50,50) now comes back as two genuinely separate rings, not one merged
  line connecting them - confirmed by actually running the parser and
  checking the output, not just reading the code.

ONE THING TO KNOW: if you have a previously-exported Settings > project
.json file with map layers already in it (from before this fix), those
layers were saved in the old flat-line format and won't have the fix
applied retroactively - re-import the .shp files after applying this pack
to get clean data. Your route, theme, and admin password in that project
file are unaffected and load fine either way.

FILE STRUCTURE: unchanged from before - see the previous README section
below if you don't have it, or ask and I'll resend the full file list.
