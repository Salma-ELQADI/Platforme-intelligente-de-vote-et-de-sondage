import { Thread } from "@/components/messaging/Thread";

export default async function ConversationPage({ params }: PageProps<"/messages/[id]">) {
  const { id } = await params;
  // key: a fresh thread state for each conversation.
  return <Thread key={id} conversationId={id} />;
}
