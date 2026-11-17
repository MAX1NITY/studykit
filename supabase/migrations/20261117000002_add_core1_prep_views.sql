-- Read models for the Core 1 prep screens. security_invoker so each view is
-- read as the caller and the table policies still apply.

-- Pool size per domain. Drives "how much is written for Networking yet".
create or replace view public.exam_pool_stats
with (security_invoker = true) as
select
  q.prep_id,
  q.domain,
  count(*)::int                                            as pool,
  count(*) filter (where q.kind <> 'single')::int          as pool_multi
from public.exam_questions q
where not q.retired
group by q.prep_id, q.domain;

-- How the ongoing study stream is going per domain. Mock exam answers are
-- excluded: a timed exam measures something else and would blur the picture
-- of what he actually knows going in.
create or replace view public.exam_answer_stats
with (security_invoker = true) as
select
  r.prep_id,
  r.domain,
  count(*)::int                           as answered,
  count(distinct r.question_id)::int      as questions_seen,
  round(avg(r.score))::int                as accuracy,
  max(r.answered_at)                      as last_answered_at
from public.exam_responses r
where r.sitting_id is null
group by r.prep_id, r.domain;

-- The headline numbers for the prep home screen.
create or replace view public.exam_prep_overview
with (security_invoker = true) as
select
  p.id,
  p.exam_code,
  p.created_at,
  coalesce(m.chapters, 0)                 as chapters,
  coalesce(m.chars, 0)                    as material_chars,
  coalesce(q.pool, 0)                     as pool,
  coalesce(r.answered, 0)                 as answered,
  r.accuracy,
  r.last_answered_at,
  coalesce(s.sittings, 0)                 as sittings,
  s.best_percent,
  s.last_sitting_at
from public.exam_preps p
left join (
  select prep_id, count(*)::int as chapters, sum(char_count)::bigint as chars
  from public.exam_material group by prep_id
) m on m.prep_id = p.id
left join (
  select prep_id, count(*)::int as pool
  from public.exam_questions where not retired group by prep_id
) q on q.prep_id = p.id
left join (
  select prep_id, count(*)::int as answered, round(avg(score))::int as accuracy,
         max(answered_at) as last_answered_at
  from public.exam_responses where sitting_id is null group by prep_id
) r on r.prep_id = p.id
left join (
  select prep_id, count(*)::int as sittings,
         max(score_percent) as best_percent,
         max(started_at) as last_sitting_at
  from public.exam_sittings where submitted_at is not null group by prep_id
) s on s.prep_id = p.id;
