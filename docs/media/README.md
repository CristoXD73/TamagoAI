# Final documentation media

Only reviewed, optimized exports belong at this directory's top level.
All entries below are **pending / UNVERIFIED**; no placeholder files are supplied.
Follow the [capture guide](../MEDIA_CAPTURE_GUIDE.md).

| Planned file | Required content |
|---|---|
| hero.png | Approved octopus presentation composition; identify composites |
| watch-simulator.png | Native simulator screenshot of the completed UI |
| character-idle.gif | Actual settled idle animation |
| character-wander.gif | Actual autonomous movement, including direction change |
| character-peek.gif | Actual edge peek and return |
| character-touch.gif | Actual visible touch reaction and recovery |
| architecture.png | Export of the canonical diagram in TAMAGO_ARCHITECTURE.md |
| physical-watch.jpg | Owner's real hardware photograph with recorded evidence |

`raw/` holds local source recordings/photos and `_work/` holds trims, derived
frames, palettes and temporary exports. Both are ignored. Optional optimized
`character-*.mp4` files at the top level remain trackable. Keep large source
archives outside Git and do not force-add ignored captures.

For each final file, add a capture record here (no personal paths or secrets):

```text
File / byte size / dimensions / duration:
Source commit and dirty-tree disclosure / art revision:
Capture date / Xcode / OS runtime / simulator or physical model:
Actions and settings shown:
Source recording identifier (local, not committed):
Exact capture and conversion commands / tool versions / trim interval:
Verification label / evidence-log link / limitations:
Creator and redistribution rights / reviewer:
```

Link final media from the main README only after it exists and is reviewed.
