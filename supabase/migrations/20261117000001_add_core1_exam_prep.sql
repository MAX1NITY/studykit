-- CompTIA Core 1 exam prep. Its own tables on purpose: the kits side has
-- stars, SM-2 scheduling and per-kit targets, and none of that belongs here.
-- This side is one fixed syllabus, an ongoing question stream with no ladder
-- to climb, and timed mock exams that grade on the clock.

-- ----------------------------------------------------------- exam_preps
-- One row per user per exam. Holds nothing but the fact that they started.
create table public.exam_preps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  exam_code   text not null default '220-1201',
  created_at  timestamptz not null default now(),
  unique (user_id, exam_code)
);

-- -------------------------------------------------------- exam_material
-- The syllabus text, one row per chapter. domain and objectives come from
-- the material itself, not from a guess.
create table public.exam_material (
  id          uuid primary key default gen_random_uuid(),
  prep_id     uuid not null references public.exam_preps (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  ordinal     integer not null,
  title       text not null,
  domain      text not null default '',
  objectives  text[] not null default '{}',
  content     text not null,
  char_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (prep_id, ordinal)
);

create index exam_material_prep_idx on public.exam_material (prep_id, ordinal);

-- ------------------------------------------------------- exam_questions
-- The pool. Both the ongoing study stream and the mock exams draw from here,
-- so a question written once can be met in either place.
--
-- One table for four shapes. single/multiple use options + answer_indexes;
-- ordering uses steps, stored in the correct order and shuffled for display;
-- matching uses pairs. The check constraint keeps each shape honest.
create table public.exam_questions (
  id              uuid primary key default gen_random_uuid(),
  prep_id         uuid not null references public.exam_preps (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('single', 'multiple', 'ordering', 'matching')),
  domain          text not null,
  objective       text not null default '',
  stem            text not null,
  options         jsonb,
  answer_indexes  integer[],
  steps           jsonb,
  pairs           jsonb,
  explanation     text not null,
  difficulty      integer not null default 3 check (difficulty between 1 and 5),
  -- Normalised stem hash. Generation runs in batches over overlapping slices
  -- of the same chapter, so without this the pool fills with restatements of
  -- one question.
  fingerprint     text not null,
  retired         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint exam_questions_shape check (
    case kind
      when 'ordering' then steps is not null
      when 'matching' then pairs is not null
      else options is not null and answer_indexes is not null
           and array_length(answer_indexes, 1) >= 1
    end
  )
);

create unique index exam_questions_dedup_idx
  on public.exam_questions (prep_id, fingerprint);
create index exam_questions_pick_idx
  on public.exam_questions (prep_id, domain, retired);

-- -------------------------------------------------------- exam_sittings
-- A mock exam. The clock is server-side: started_at plus seconds_allowed is
-- the deadline, so closing the tab does not stop it and reopening does not
-- reset it.
create table public.exam_sittings (
  id               uuid primary key default gen_random_uuid(),
  prep_id          uuid not null references public.exam_preps (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  question_ids     uuid[] not null,
  seconds_allowed  integer not null default 5400,
  started_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  -- Percent of the marks available, partial credit included. Deliberately not
  -- dressed up as a 100-900 CompTIA scaled score: that scale is proprietary
  -- and cannot be worked out from a percentage, so inventing one would be a
  -- made-up number to revise against.
  score_percent    numeric(5,2),
  -- Answers as they are given, before anything is marked. Kept here rather
  -- than in exam_responses, which only ever holds marked answers: a
  -- half-finished paper must not show up in his accuracy.
  draft            jsonb not null default '{}'::jsonb,
  draft_saved_at   timestamptz,
  created_at       timestamptz not null default now()
);

create index exam_sittings_prep_idx on public.exam_sittings (prep_id, started_at desc);

-- ------------------------------------------------------- exam_responses
-- One row per question answered. sitting_id null means the ongoing study
-- stream; set means it was part of that mock exam.
--
-- score is 0-100 so Select TWO and ordering questions can award partial
-- credit, the way CompTIA's performance-based questions do.
create table public.exam_responses (
  id            uuid primary key default gen_random_uuid(),
  prep_id       uuid not null references public.exam_preps (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  question_id   uuid not null references public.exam_questions (id) on delete cascade,
  sitting_id    uuid references public.exam_sittings (id) on delete cascade,
  domain        text not null default '',
  response      jsonb,
  score         integer not null default 0 check (score between 0 and 100),
  correct       boolean not null default false,
  answered_at   timestamptz not null default now()
);

create index exam_responses_prep_idx
  on public.exam_responses (prep_id, answered_at desc);
create index exam_responses_sitting_idx
  on public.exam_responses (sitting_id);
-- Answering the same question twice in one sitting is a double mark.
create unique index exam_responses_once_per_sitting_idx
  on public.exam_responses (sitting_id, question_id)
  where sitting_id is not null;

-- ----------------------------------------------------- row level security
alter table public.exam_preps     enable row level security;
alter table public.exam_material  enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_sittings  enable row level security;
alter table public.exam_responses enable row level security;

create policy exam_preps_owner on public.exam_preps
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy exam_material_owner on public.exam_material
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy exam_questions_owner on public.exam_questions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy exam_sittings_owner on public.exam_sittings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy exam_responses_owner on public.exam_responses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
