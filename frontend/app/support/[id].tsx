import { useLocalSearchParams } from "expo-router";
import { ChatScreen } from "@/src/support/ChatScreen";

export default function SupportTicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen ticketId={id as string} asAdmin={false} />;
}
