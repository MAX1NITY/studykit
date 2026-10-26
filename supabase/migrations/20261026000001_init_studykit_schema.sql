-- StudyKit: per-user study kits built from uploaded material.
-- Every table is owned by a user and locked down with row level security.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- kits
create table public.kits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  subject     text,
  color       text not null default 'indigo',
  created_at  timestamptz not null default now()
);

create index kits_user_created_idx on public.kits (user_id, created_at desc);

-- ------------------------------------------------------------- sources
-- The raw study material (pasted notes, extracted PDF text, etc.)
create table public.sources (
  id          uuid primary key default gen_random_uuid(),
  kit_id      uuid not null references public.kits (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  kind        text not null default 'text' check (kind in ('text', 'pdf', 'url', 'note')),
  content     text not null,
  char_count  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index sources_kit_idx on public.sources (kit_id, created_at);

-- --------------------------------------------------------------- cards
-- Flashcards scheduled with SM-2 spaced repetition.
create table public.cards (
  id                uuid primary key default gen_random_uuid(),
  kit_id            uuid not null references public.kits (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  front             text not null,
  back              text not null,
  concept           text,
  ease              real not null default 2.5,
  interval_days     real not null default 0,
  repetitions       integer not null default 0,
  lapses            integer not null default 0,
  due_at            timestamptz not null default now(),
  last_reviewed_at  timestamptz,
  created_at        timestamptz not null default now()
);

create index cards_due_idx on public.cards (user_id, kit_id, due_at);

-- -------------------------------------------------------------- guides
create table public.guides (
  id          uuid primary key default gen_random_uuid(),
  kit_id      uuid not null references public.kits (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  markdown    text not null,
  created_at  timestamptz not null default now()
);

create index guides_kit_idx on public.guides (kit_id, created_at desc);

-- ------------------------------------------------------------ attempts
-- One row per Smart Study question answered. Drives adaptive difficulty.
create table public.attempts (
  id            uuid primary key default gen_random_uuid(),
  kit_id        uuid not null references public.kits (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  concept       text,
  question      text not null,
  expected      text,
  user_answer   text,
  verdict       text check (verdict in ('correct', 'partial', 'incorrect')),
  score         integer check (score between 0 and 100),
  explanation   text,
  difficulty    integer not null default 2 check (difficulty between 1 and 5),
  created_at    timestamptz not null default now()
);

create index attempts_kit_idx on public.attempts (user_id, kit_id, created_at desc);
create index attempts_concept_idx on public.attempts (user_id, kit_id, concept);

-- --------------------------------------------------------------- tests
create table public.tests (
  id                uuid primary key default gen_random_uuid(),
  kit_id            uuid not null references public.kits (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  questions         jsonb not null,
  responses         jsonb,
  score             integer,
  total             integer not null,
  duration_seconds  integer,
  submitted_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index tests_kit_idx on public.tests (user_id, kit_id, created_at desc);

-- ----------------------------------------------------- row level security
alter table public.kits     enable row level security;
alter table public.sources  enable row level security;
alter table public.cards    enable row level security;
alter table public.guides   enable row level security;
alter table public.attempts enable row level security;
alter table public.tests    enable row level security;

create policy kits_owner on public.kits
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy sources_owner on public.sources
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy cards_owner on public.cards
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy guides_owner on public.guides
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy attempts_owner on public.attempts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy tests_owner on public.tests
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- --------------------------------------------- per-concept mastery view
-- security_invoker makes the view respect the querying user's RLS policies.
create view public.concept_stats
  with (security_invoker = true)
  as
select
  user_id,
  kit_id,
  concept,
  count(*)::integer            as attempt_count,
  round(avg(score))::integer   as avg_score,
  max(created_at)              as last_seen_at
from public.attempts
where concept is not null
group by user_id, kit_id, concept;
