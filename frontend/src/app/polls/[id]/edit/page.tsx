import { EditPoll } from "./EditPoll";

export default async function EditPollPage({ params }: PageProps<"/polls/[id]/edit">) {
  const { id } = await params;
  return <EditPoll id={id} />;
}
