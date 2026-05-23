"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// The "Collection" link on the album page used to be a plain <Link href="/">,
// which always created a new history entry and scrolled to top — losing the
// user's place in a grid of hundreds of records. router.back() instead
// triggers Next.js App Router's built-in scroll restoration so the user lands
// exactly where they left off.
//
// Falls back to router.push("/") for cold deep-links (e.g. someone opens an
// album URL directly with no in-app history). We check document.referrer
// against window.location.origin to differentiate "came from somewhere else
// on the site" from "came from outside" — going back to an external page
// would be a bad UX.
export function CollectionBackLink() {
  const router = useRouter();

  function go() {
    const sameOriginReferrer =
      typeof document !== "undefined" &&
      document.referrer &&
      document.referrer.startsWith(window.location.origin);

    if (sameOriginReferrer && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      className="inline-flex items-center gap-1.5 text-sm text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Collection
    </button>
  );
}
