-- ════════════════════════════════════════════════════════════════════════
-- SpinLog | media_files.taken_at
--
-- WHAT THIS ADDS: one nullable column. Nothing is dropped, nothing is renamed,
-- nothing is overwritten, and no row is seeded. Paste it into the Supabase SQL
-- editor and run it once; running it again does nothing.
--
--   ALTER media_files  add column taken_at timestamptz   ← the only new thing
--
-- ── WHY A SECOND DATE COLUMN ─────────────────────────────────────────
--
-- There are already two and they are not the same thing:
--
--   upload_date    timestamptz   when the file arrived in this app
--   historic_date  date          what day the file is FROM
--
-- `historic_date` is a DATE, so it cannot hold a clock reading — and the Record
-- History table prints the day over the time, so the moment a row got a
-- historic_date its time line vanished. Worse, the time it had been showing before
-- that came from upload_date, so it was the minute the file was uploaded dressed up
-- as the minute it was recorded.
--
-- The metadata has the real one. EXIF carries DateTimeOriginal to the second, the
-- `mvhd` box in an MP4 or M4A carries a creation time to the second, and half the
-- filenames in this archive carry one too — "WhatsApp Video 2026-04-19 at 3.11.15
-- PM". All of that was being read and then thrown away at the point the answer was
-- truncated to a date to fit the column.
--
-- So: `taken_at timestamptz`, which is the full answer, and `historic_date` stays
-- exactly as it is. Keeping both is deliberate rather than untidy —
--
--   · historic_date is what the rider SET. It is a day, because that is what the
--     edit sheet asks for and what a person actually knows about an old recording.
--   · taken_at is what the FILE said. It has a time because the file had one.
--
-- The app prefers taken_at when it is there and falls back to historic_date, so a
-- row the rider has corrected by hand keeps the correction.
--
-- ── IT DEGRADES QUIETLY UNTIL YOU RUN IT ─────────────────────────────
--
-- Like the other migrations here. Without this column the app reads and writes
-- historic_date exactly as it did before, the Uploaded column shows a day with no
-- time, and cloud-store logs one line to the console naming this file. Nothing
-- breaks and nothing is lost; the times simply are not there yet.
--
-- ── WHY timestamptz AND NOT timestamp ────────────────────────────────
--
-- Because this app already learned that lesson twice. `toISOString()` is UTC, and
-- east of Greenwich it returns yesterday for the whole evening — there are two
-- comments in script.js about days lost that way. timestamptz stores an instant and
-- lets the client render it in the rider's own zone, which is the only arrangement
-- where "27 Jun, 8:14 pm" means the same thing on a phone and a laptop.
-- ════════════════════════════════════════════════════════════════════════

alter table public.media_files
  add column if not exists taken_at timestamptz;

comment on column public.media_files.taken_at is
  'When this upload was actually recorded, read from the file''s own metadata: EXIF '
  'DateTimeOriginal, the ISO-BMFF mvhd creation time, or a timestamp in the filename. '
  'Distinct from upload_date, which is when the file arrived, and from historic_date, '
  'which is the day the rider set by hand. The app prefers this and falls back to '
  'historic_date.';

-- ── THERE IS DELIBERATELY NO SEED ────────────────────────────────────
--
-- The obvious next line is an UPDATE that fills taken_at from historic_date at
-- midday, so that every row has something the moment the column exists. Do not add
-- it. `historic_date` is a day; a day plus noon is not a time, it is a day wearing
-- a time, and the Record History table would immediately start printing "5:30 pm"
-- under ten rows that have no idea when they were recorded.
--
-- That is the exact failure this column was added to fix. Before it, the time line
-- came from upload_date — the minute the file arrived, presented as the minute it
-- was recorded — and it looked like real information, which is what made it worse
-- than nothing. A fabricated noon would be the same mistake with a new column.
--
-- So taken_at starts null everywhere and stays null until something actually knows.
-- Two things do:
--
--   · every new upload, from the file it was given (dkMediaDate.detail)
--   · every OLD upload, from the bytes already in the bucket — open the app, then
--     run this in the browser console:
--
--         await dkBackfillMediaDates()                  // shows what it found
--         await dkBackfillMediaDates({ apply: true })    // writes it
--
-- A row whose metadata only knew a day keeps its day and shows no time, and that is
-- the correct outcome rather than a gap to be filled.
--
-- ── Check it worked ──
-- select id, original_name, upload_date, historic_date, taken_at
--   from public.media_files order by id;
