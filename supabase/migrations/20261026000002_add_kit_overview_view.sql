-- One row per kit with the counts the UI shows, so the kit list is a single
-- query instead of a fan-out per kit. security_invoker keeps RLS in force.
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
  (select max(a.created_at) from public.attempts a
     where a.kit_id = k.id)                                 as last_attempt_at,
  (select count(*) from public.guides g
     where g.kit_id = k.id)::integer                        as guide_count,
  (select t.score from public.tests t
     where t.kit_id = k.id and t.submitted_at is not null
     order by t.submitted_at desc limit 1)::integer         as last_test_score,
  (select t.total from public.tests t
     where t.kit_id = k.id and t.submitted_at is not null
     order by t.submitted_at desc limit 1)::integer         as last_test_total
from public.kits k;
