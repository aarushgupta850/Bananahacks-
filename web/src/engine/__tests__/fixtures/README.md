# Real drawings for tuning (checkpoint M2)

Drawings exported with `?dev=1` (the "Export strokes (dev)" button on the Test and Retest screens).
Rename each file to `<packId>--<quality>--<who>.json`, where quality is `careless`, `rough` or `careful`,
for example `fox-medium--careful--aarush.json`. The pack must exist in `web/public/subjects`.

`realFixtures.test.ts` scores every file with the real engine and checks, for each pack and person,
that careful > rough > careless and that careful scores at least 80.
