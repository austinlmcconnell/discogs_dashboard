"use client";

import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CollectionRelease } from "@/lib/discogs";

export function RandomizeButton({ releases }: { releases: CollectionRelease[] }) {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        if (releases.length === 0) return;
        const pick = releases[Math.floor(Math.random() * releases.length)];
        router.push(`/album/${pick.basic_information.id}?from=random`);
      }}
      className="gap-2 h-10 px-4"
    >
      <Shuffle className="w-4 h-4" />
      Spin a record
    </Button>
  );
}
