import { Suspense } from "react";
import { PageLoader } from "@/components/ui";
import { PollsIndex } from "./PollsIndex";

export default function PollsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PollsIndex />
    </Suspense>
  );
}
