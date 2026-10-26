# StudyKit

Upload what you are actually studying, and it asks you the questions.

Built because tools like Thea, Quizlet and Knowt all put the useful parts —
unlimited questions, practice tests, no waiting — behind a paywall or a daily
cap. This runs on your own free API key, so there is no cap and no bill.

## What it does

**Study kits.** Paste notes or drop in a PDF. It reads the material once and
builds flashcards, a revision guide and a pool of questions from it. PDFs are
parsed in your browser, so the file itself never leaves your machine — only the
extracted text is sent on.

**Smart Study.** Open-ended questions you answer by typing. Each answer is
marked on understanding rather than wording, told what you left out, and given
the correct answer. Difficulty climbs when you are scoring above 80% and drops
below 50%, and the question picker weights towards concepts you keep getting
wrong.

**Flashcards.** Scheduled with SM-2, the spaced-repetition algorithm behind
Anki. Cards you know stretch further apart; cards you miss come back in ten
minutes.

**Practice tests.** Multiple choice, 5 to 25 questions, timed and marked at the
end like a real paper. The wrong options are written to be plausible rather
than obvious.

**Revision guide.** The material condensed per concept, with a section
contrasting the ideas that are easy to mix up.

Everything comes from your own uploads. The prompts tell the model to say when
the material does not cover something instead of filling the gap from
elsewhere.

## Running it

### 1. Supabase

Create a project at [supabase.com](https://supabase.com) (free tier is enough),
then run the two files in `supabase/migrations/` in the SQL editor, oldest
first. They create the tables, the row-level-security policies and two views.

From **Project Settings → Data API**, copy the project URL and the publishable
key.

### 2. Gemini key

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
No credit card. The free tier has a daily request limit that one person is
unlikely to reach; if you do, `gemini-3.5-flash-lite` has a larger quota.

### 3. Environment

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run dev
```

| Variable | Needed | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable key, safe in the browser |
| `GEMINI_API_KEY` | yes | Server-side only. Never prefix with `NEXT_PUBLIC_` |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.8-flash` |
| `AI_PROVIDER` | no | `gemini` (default) or `anthropic` |
| `ANTHROPIC_API_KEY` | no | Only if `AI_PROVIDER=anthropic` |

Visit `/api/health` to check what the server can see. It reports whether each
variable is set, never its value, and is reachable without signing in so it
still works when the app is misconfigured.

### 4. Sign-up

By default Supabase emails a confirmation link before the first sign-in. For a
personal instance it is easier to turn that off: **Authentication → Sign In /
Providers → Email → Confirm email**. Sign-up then logs you straight in. The app
handles both.

## Deploying

Import the repo on [Vercel](https://vercel.com), add the same environment
variables, deploy. The free Hobby plan covers it; AI routes are capped at the
60-second function limit.

## Swapping the AI

Nothing outside `lib/ai/provider.ts` knows which model is in use. Everything
calls `getProvider()`, which returns something with `generateJSON` and
`generateText`. Gemini and Claude are implemented; adding Groq or a local model
means writing one more class and a line in the factory.

Claude is left off by default because the Claude API is billed per token and is
separate from a Claude.ai subscription — a Pro plan does not include API access.

## How it is built

- **Next.js 16** (App Router, Turbopack). Auth is refreshed in `proxy.ts`,
  which is what middleware is called in 16.
- **Supabase** for auth and Postgres. Every table carries `user_id` and an RLS
  policy, so a user can only ever read or write their own rows — enforced by
  the database, not by application code.
- **Self-hosted fonts** (`app/fonts/`) rather than Google Fonts, so no
  third-party request on load and no build-time dependency on a CDN.
- **No answer reaches the browser early.** Smart Study stores the expected
  answer on a pending row server-side and marks against it; practice tests keep
  the correct options server-side until you submit. Neither is readable from
  devtools.

```
app/
  api/            route handlers: kit building, questions, marking, tests
  kits/[id]/      study · cards · test · guide
lib/
  ai/provider.ts  the only file that knows about a model vendor
  ai/study.ts     prompts and response schemas
  srs.ts          SM-2 scheduling
  supabase/       browser, server and proxy clients
supabase/migrations/
```

## Tests

```bash
npm run typecheck
npm run lint
npm run build
```

`lib/srs.ts` is checked against the SM-2 specification (interval progression
1 → 6 → ×ease, the 1.3 ease floor, lapse handling) and the Gemini provider
against a stand-in API covering the response shape and every HTTP failure.

## Licence

MIT.
