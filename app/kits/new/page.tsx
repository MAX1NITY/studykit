import { TopBar } from "@/components/chrome";
import { NewKitForm } from "./form";

export const metadata = { title: "New kit · StudyKit" };

export default function NewKitPage() {
  return (
    <>
      <TopBar breadcrumb="New kit" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="read text-[28px] leading-tight">
          What are you studying?
        </h1>
        <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-mute">
          Add the material and StudyKit reads it once, then builds the
          flashcards and guide from it. Files are read in your browser; only the
          text is sent on.
        </p>
        <NewKitForm />
      </main>
    </>
  );
}
