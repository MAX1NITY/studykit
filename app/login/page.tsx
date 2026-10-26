import { Suspense } from "react";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in · StudyKit" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="read text-[34px] leading-[1.15] font-normal">
        Your notes, asking you the questions.
      </h1>
      <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-mute">
        Upload what you are studying. StudyKit turns it into flashcards, a
        revision guide and questions that get harder as you get better.
      </p>

      <Suspense
        fallback={<div className="mt-10 h-48 animate-pulse rounded-sm bg-surface" />}
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
