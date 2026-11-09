-- When a question was answered, as distinct from when it was written.
--
-- Questions are generated into a pool ahead of time and then served by how
-- well they match the student's current difficulty, so created_at is the
-- moment the question was *written*, which can be an hour before it is seen
-- and in a completely different order.
--
-- Everything that claimed to look at "recent" answers was therefore ranking
-- by generation time: the accuracy shown against the stars, the difficulty
-- picker's last five, and the "studied N ago" line. The effect on accuracy
-- was systematic rather than random — a freshly written question answered
-- wrong landed at the top of the window and dropped the figure at once,
-- while an older one answered correctly sat deep in it and barely moved
-- anything. Improvement was invisible; mistakes were not.
alter table public.attempts
  add column if not exists answered_at timestamptz;

-- served_at is when the question was handed over, which for an answered
-- question is within a few seconds of the answer. Best available history.
update public.attempts
   set answered_at = coalesce(served_at, created_at)
 where score is not null
   and answered_at is null;

create index if not exists attempts_answered_idx
  on public.attempts (user_id, kit_id, answered_at desc)
  where score is not null;

-- ------------------------------------------------------------ kit_progress
drop view if exists public.kit_progress;

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
    (select array_agg(s.score order by s.answered_at desc)
       from (select a.score, a.answered_at
               from public.attempts a
              where a.kit_id = k.id
                and a.score is not null
              order by a.answered_at desc
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

-- ----------------------------------------------------------- concept_stats
drop view if exists public.concept_stats;

create view public.concept_stats
  with (security_invoker = true)
  as
select
  user_id,
  kit_id,
  concept,
  count(*)::integer              as attempt_count,
  round(avg(score))::integer     as avg_score,
  max(answered_at)               as last_seen_at
from public.attempts
where concept is not null
  and score is not null
group by user_id, kit_id, concept;

-- ----------------------------------------------------------- kit_overview
-- "studied N ago" was max(created_at) over every attempt, answered or not,
-- so it reported when questions were last *written into the pool* — which
-- happens in the background and says nothing about when anyone studied.
drop view if exists public.kit_overview;

create view public.kit_overview
  with (security_invoker = true)
  as
select
  k.id,
  k.user_id,
  k.title,
  k.subject,
  k.color,
  k.created_at,
  (select count(*) from public.cards c
     where c.kit_id = k.id)::integer                        as card_count,
  (select count(*) from public.cards c
     where c.kit_id = k.id and c.due_at <= now())::integer   as due_count,
  (select count(*) from public.sources s
     where s.kit_id = k.id)::integer                        as source_count,
  (select count(*) from public.attempts a
     where a.kit_id = k.id and a.score is not null)::integer as answered_count,
  (select round(avg(a.score)) from public.attempts a
     where a.kit_id = k.id and a.score is not null)::integer as avg_score,
  (select greatest(
            (select max(a.answered_at) from public.attempts a
               where a.kit_id = k.id and a.score is not null),
            (select max(c.last_reviewed_at) from public.cards c
               where c.kit_id = k.id)))                     as last_attempt_at,
  (select count(*) from public.guides g
     where g.kit_id = k.id)::integer                        as guide_count,
  (select t.score from public.tests t
     where t.kit_id = k.id and t.submitted_at is not null
     order by t.submitted_at desc limit 1)::integer         as last_test_score,
  (select t.total from public.tests t
     where t.kit_id = k.id and t.submitted_at is not null
     order by t.submitted_at desc limit 1)::integer         as last_test_total
from public.kits k;
