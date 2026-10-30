-- Per-kit progress, for the tier system on the kit page and the kit list.
--
-- A kit is one chapter, and its tiers are earned from the work done on it, so
-- everything the rules need is gathered here in one row per kit rather than a
-- fan-out of counts per screen. security_invoker keeps row level security in
-- force, so this only ever shows the caller their own kits.
--
-- recent_scores is newest-first and capped at 20: the tier rules judge
-- accuracy over a window of recent answers rather than all time, and the
-- widest window they ask for is 12.
create view public.kit_progress
  with (security_invoker = true)
  as
select
  k.id,
  k.user_id,

  (select count(*) from public.cards c
     where c.kit_id = k.id)::integer                         as cards,

  (select count(*) from public.cards c
     where c.kit_id = k.id
       and c.last_reviewed_at is not null)::integer          as cards_seen,

  -- A lapse resets repetitions to 0, so this counts cards that are passed
  -- and have not been failed since.
  (select count(*) from public.cards c
     where c.kit_id = k.id
       and c.repetitions >= 1)::integer                      as cards_passed,

  (select count(*) from public.attempts a
     where a.kit_id = k.id
       and a.score is not null)::integer                     as answered,

  (select count(*) from public.attempts a
     where a.kit_id = k.id
       and a.score >= 70
       and a.difficulty >= 4)::integer                       as hard_correct,

  coalesce(
    (select array_agg(s.score order by s.created_at desc)
       from (select a.score, a.created_at
               from public.attempts a
              where a.kit_id = k.id
                and a.score is not null
              order by a.created_at desc
              limit 20) s),
    '{}'::integer[]
  )                                                          as recent_scores,

  (select count(*) from public.tests t
     where t.kit_id = k.id
       and t.submitted_at is not null)::integer              as tests,

  (select max(round(100.0 * t.score / t.total))
     from public.tests t
    where t.kit_id = k.id
      and t.submitted_at is not null
      and t.total > 0)::integer                              as best_test_percent

from public.kits k;
