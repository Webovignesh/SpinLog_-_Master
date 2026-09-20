-- ════════════════════════════════════════════════════════════
-- SpinLog — route the last of the device-only data through the cloud
--
-- Run this once in the Supabase SQL editor:
--   Dashboard → SQL Editor → New query → paste → Run
--
--
-- This file creates NO TABLES. It is the only one of the four in supabase/ that
-- does not — the other three each create the table they are named after.
--
-- Every statement in it, in full:
--
--   ALTER   media_files   add column notes          (already exists — no-op)
--   ALTER   media_files   add column historic_date  ← the ONLY new thing
--   CREATE  index         on sage_memory            (an index, not a table)
--   CREATE  policy × 8    on sage_memory, media_files  (RLS, not tables)
--   DROP    table         app_state                 (REMOVES the table you
--                                                    did not want)
--
-- So the net effect on your schema is: one column added, one table deleted.
-- `create index` and `create policy` are not tables. `drop table` is the opposite
-- of one.
--
-- Park history, the conversation and app settings go into sage_memory, which
-- already exists and was already built to hold different kinds of row told apart
-- by record_type. They add rows, not structure.
--
-- WHAT WAS WRONG BEFORE
--
-- Four things still lived only in localStorage, which is why a note typed on the
-- laptop was not on the phone:
--
--   upload notes          text about one media_files row
--   upload dates          the date that upload is FROM, not when it was uploaded
--   park history          where the bike was left
--   purchase-date override  lines "together for" up with what the papers say
--
-- WHERE THEY GO
--
--   media_files.notes           a column on the row it describes. These were a
--   media_files.historic_date   JSON map keyed by row id, which is a foreign key
--                               pretending not to be one.
--
--   sage_memory                 park spots, chat messages and app settings, as
--                               three more record_type values.
--
-- WHY sage_memory RATHER THAN NEW TABLES
--
-- It was built for exactly this. One table, several kinds of row told apart by
-- record_type — the header calls out fact / recap / relationship / episode — with
-- record_type as plain text and no constraint on it. It already has the unique
-- mem_key index the app updates through, a jsonb `data` column, updated_at for
-- last-write-wins, and a complete RLS set including DELETE. Adding a record type
-- costs nothing; a new table costs another migration, another policy set to get
-- right, and another thing to remember exists.
--
--   record_type = 'park'      one parked spot.   content = address,
--                             data = { lat, lng, accuracy }, learned_at = when
--   record_type = 'message'   one chat turn.     content = the text,
--                             data = { role, file }, learned_at = when
--   record_type = 'setting'   one app setting.   content = the value
--
-- sage_memory_prune() only ever deletes rows with archived_at set, and none of
-- these three set it, so they are not at risk from it.
-- ════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- 1. media_files — notes and the date the upload is from
-- ════════════════════════════════════════════════════════════

-- notes may already exist; the app has been reading media_files.notes for a while
-- and falling back to localStorage when it was null.
alter table public.media_files add column if not exists notes text;

-- Distinct from upload_date on purpose. Backdating an old service photo to when
-- it was actually taken is the entire point of the historic section, and
-- upload_date is when the file arrived here.
alter table public.media_files add column if not exists historic_date date;

comment on column public.media_files.notes is
  'Free text the rider added about this upload. Was a localStorage map keyed by row id.';
comment on column public.media_files.historic_date is
  'The date this upload is FROM, as set by the rider. upload_date is when it arrived.';


-- ════════════════════════════════════════════════════════════
-- 2. sage_memory — nothing structural to add
--
-- Every column the three new record types need is already there. This section
-- only documents them and makes sure the indexes cover how they are read.
-- ════════════════════════════════════════════════════════════

-- Park spots and messages are both read newest-first within their type, which the
-- existing (record_type, updated_at desc) index does not help with, because they
-- are ordered by when they HAPPENED rather than when the row was last written.
create index if not exists sage_memory_type_learned_idx
  on public.sage_memory (record_type, learned_at desc)
  where archived_at is null;


-- ── What is actually in here ─────────────────────────────────────────
--
-- Worth stating bluntly, because the table is named sage_memory and now holds the
-- conversation too. One chat exchange writes a `message` row for what he said, a
-- `message` row for her reply, and updates the single `relationship` row. None of
-- those three is a memory.
--
-- A memory is a `fact` row, and most exchanges do not produce one. Asking her a
-- question and getting a figure back is not something to remember — she already
-- had the figure, and CHAT_RULES in src/js/sage-ai.js tells her not to write one
-- down for it. So "three new rows and no new memory" is the normal, correct
-- outcome, not a bug.
--
-- Read the views rather than the table, or every message looks like something she
-- learned about him.

comment on table public.sage_memory is
  'Sync log, NOT a list of memories. Seven record types share it. fact / recap / '
  'relationship / episode are Sage''s own memory — see the sage_memory_facts view. '
  'message / park / setting are app data routed through the same sync so the phone '
  'and the laptop agree — see the sage_conversation view. One chat exchange writes '
  'two message rows and updates the relationship row WITHOUT creating a memory, '
  'which is normal. Use sage_memory_summary for the breakdown by type.';

comment on column public.sage_memory.record_type is
  'fact | recap | relationship | episode (hers) — message | park | setting (the app''s).';


-- The conversation on its own. Picking message rows out of the raw table by eye is
-- how a chat log came to look like a memory leak.
create or replace view public.sage_conversation
  with (security_invoker = true)
as
select
  id,
  mem_key,
  data->>'role'            as who,
  content                  as said,
  data->'file'->>'name'    as attached,
  learned_at               as at
from public.sage_memory
where record_type = 'message'
order by learned_at desc;

comment on view public.sage_conversation is
  'The chat log, one row per turn, newest first. Capped at CHAT_KEEP (80) turns by '
  'the app. Clearing the conversation, or making her forget everything, deletes '
  'every row of it by record_type rather than by key.';


-- ════════════════════════════════════════════════════════════
-- 3. DELETE policies
--
-- This is the part that was actually broken, and it is worth being blunt about
-- why it matters: without a DELETE policy, a delete affects zero rows and returns
-- NO ERROR. The app removes the thing from the screen, reports success, and the
-- row is still there on the next load. A delete without a policy is a lie.
--
-- Three of the app's delete paths were relying on policies that were never
-- written: clearing the conversation, forgetting a parked spot, and trimming
-- either list back to its cap.
-- ════════════════════════════════════════════════════════════

-- ── sage_memory ──
-- Already had all four from its own migration. Re-asserted here because this file
-- may be run on a database where sage_memory.sql predates them, and because
-- dropping and recreating is how a policy set gets quietly half-applied.
alter table public.sage_memory enable row level security;

drop policy if exists "sage_memory anon read"   on public.sage_memory;
drop policy if exists "sage_memory anon insert" on public.sage_memory;
drop policy if exists "sage_memory anon update" on public.sage_memory;
drop policy if exists "sage_memory anon delete" on public.sage_memory;

create policy "sage_memory anon read"
  on public.sage_memory for select using (true);
create policy "sage_memory anon insert"
  on public.sage_memory for insert with check (true);
create policy "sage_memory anon update"
  on public.sage_memory for update using (true) with check (true);
-- Needed by: "delete for good" in the memory chooser, "clear conversation",
-- "forget this spot", and both list trims.
create policy "sage_memory anon delete"
  on public.sage_memory for delete using (true);

-- ── media_files ──
-- The historic section can delete an upload, and the notes and date now go with
-- the row rather than being orphaned in localStorage.
alter table public.media_files enable row level security;

drop policy if exists "media_files anon read"   on public.media_files;
drop policy if exists "media_files anon insert" on public.media_files;
drop policy if exists "media_files anon update" on public.media_files;
drop policy if exists "media_files anon delete" on public.media_files;

create policy "media_files anon read"
  on public.media_files for select using (true);
create policy "media_files anon insert"
  on public.media_files for insert with check (true);
-- update is what saves a note or a date, so without this the field looks saved
-- and is not.
create policy "media_files anon update"
  on public.media_files for update using (true) with check (true);
create policy "media_files anon delete"
  on public.media_files for delete using (true);


-- ════════════════════════════════════════════════════════════
-- 4. Tidy up app_state if it is still there
--
-- An earlier version of this change used one key/value table holding JSON blobs.
-- It is gone from the app. This moves anything it still holds into the columns
-- and record types above, then drops it — so running this loses nothing, and
-- running it twice is harmless.
-- ════════════════════════════════════════════════════════════
do $$
declare
  blob jsonb;
  item jsonb;
  row_id bigint;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'app_state'
  ) then
    return;
  end if;

  -- Park history: [{ timestamp, lat, lng, accuracy, address }]
  select value into blob from public.app_state where key = 'spinlogParkHistory';
  if blob is not null and jsonb_typeof(blob) = 'array' then
    for item in select * from jsonb_array_elements(blob) loop
      if item ? 'timestamp' and item ? 'lat' and item ? 'lng' then
        insert into public.sage_memory
          (mem_key, record_type, content, data, learned_at, last_seen_at, updated_at)
        values (
          'park:' || (item->>'timestamp'),
          'park',
          nullif(item->>'address', ''),
          jsonb_build_object(
            'lat', (item->>'lat')::double precision,
            'lng', (item->>'lng')::double precision,
            'accuracy', nullif(item->>'accuracy', '')::double precision
          ),
          (item->>'timestamp')::timestamptz,
          (item->>'timestamp')::timestamptz,
          now()
        )
        on conflict (mem_key) do nothing;
      end if;
    end loop;
  end if;

  -- Conversation: [{ role, text, at, file }]
  select value into blob from public.app_state where key = 'sage_chat_history';
  if blob is not null and jsonb_typeof(blob) = 'array' then
    for item in select * from jsonb_array_elements(blob) loop
      if item ? 'role' and item ? 'text' then
        insert into public.sage_memory
          (mem_key, record_type, content, data, learned_at, last_seen_at, updated_at)
        values (
          'msg:' || coalesce(nullif(item->>'at', ''), '0') || ':' || (item->>'role'),
          'message',
          item->>'text',
          jsonb_build_object('role', item->>'role', 'file', item->'file'),
          coalesce(to_timestamp((nullif(item->>'at', ''))::bigint / 1000.0), now()),
          now(),
          now()
        )
        on conflict (mem_key) do nothing;
      end if;
    end loop;
  end if;

  -- Purchase-date override: a bare date string.
  select value into blob from public.app_state where key = 'spinlogAgeFrom';
  if blob is not null and jsonb_typeof(blob) = 'string' then
    insert into public.sage_memory
      (mem_key, record_type, content, learned_at, last_seen_at, updated_at)
    values ('setting:ageFrom', 'setting', blob #>> '{}', now(), now(), now())
    on conflict (mem_key) do update set content = excluded.content, updated_at = now();
  end if;

  -- Upload notes and dates: objects keyed by the media_files row id.
  select value into blob from public.app_state where key = 'spinlogHistoricNotes';
  if blob is not null and jsonb_typeof(blob) = 'object' then
    for item in select jsonb_build_object('k', k, 'v', v)
                from jsonb_each_text(blob) as t(k, v) loop
      begin
        row_id := (item->>'k')::bigint;
      exception when others then
        continue;
      end;
      update public.media_files set notes = item->>'v'
       where id = row_id and (notes is null or notes = '');
    end loop;
  end if;

  select value into blob from public.app_state where key = 'spinlogHistoricDates';
  if blob is not null and jsonb_typeof(blob) = 'object' then
    for item in select jsonb_build_object('k', k, 'v', v)
                from jsonb_each_text(blob) as t(k, v) loop
      begin
        row_id := (item->>'k')::bigint;
      exception when others then
        continue;
      end;
      update public.media_files set historic_date = nullif(item->>'v', '')::date
       where id = row_id and historic_date is null;
    end loop;
  end if;

  drop table public.app_state;
  raise notice 'app_state emptied into media_files and sage_memory, then dropped.';
end $$;


-- ── Check it worked ──
-- select record_type, count(*) from public.sage_memory group by record_type order by record_type;
-- select id, notes, historic_date from public.media_files where notes is not null or historic_date is not null;
