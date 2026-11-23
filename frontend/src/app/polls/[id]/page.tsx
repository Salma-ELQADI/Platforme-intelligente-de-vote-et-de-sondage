import { PollDetail } from "./PollDetail";

export default async function PollPage({ params }: PageProps<"/polls/[id]">) {
  const { id } = await params;
  return <PollDetail id={id} />;
}
