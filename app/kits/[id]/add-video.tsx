"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddVideo, type VideoSource } from "@/components/add-video";
import { postJSON } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";

/**
 * Adds a video's transcript to a kit that already exists.
 *
 * Saving the material is all this does. Writing cards over it is the kit
 * page's own button, so a slow model cannot cost the student the transcript
 * they just copied across.
 */
export function AddVideoToKit({ kitId }: { kitId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(video: VideoSource) {
    setSaving(true);
    setError(null);

    const result = await postJSON(`/api/kits/${kitId}/sources`, video);
    setSaving(false);

    if (!result.ok) {
      setError(result.error.title);
      return;
    }

    setAdded(video.name);
    router.refresh();
  }

  return (
    <div>
      <AddVideo onAdd={(v) => void save(v)} busy={saving} />

      {error ? (
        <div className="mt-3">
          <Notice
            title={error}
            hint="The transcript was not saved. Your paste is still in the box — try again."
          />
        </div>
      ) : null}

      {added ? (
        <p className="mt-3 text-[13px] text-sure" role="status">
          Added “{added}”. Write cards over it below, or go straight to Smart
          Study — questions are built from everything in the kit.
        </p>
      ) : null}
    </div>
  );
}
