import { useLocalSearchParams } from "expo-router";
import { ChatScreen } from "@/src/support/ChatScreen";

export default function AdminSupportTicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen ticketId={id as string} asAdmin={true} />;
}
