export type Attachment = { url: string; kind?: string };

export type Ticket = {
  id: string;
  user_id: string;
  user_email: string;
  user_name?: string;
  subject: string;
  status: "open" | "in_progress" | "closed";
  created_at: string;
  last_message_at: string;
  last_sender_role?: "user" | "admin" | null;
  unread_for_user: number;
  unread_for_admin: number;
};

export type Message = {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: "user" | "admin";
  sender_name: string;
  text: string;
  attachments: Attachment[];
  created_at: string;
};

export const STATUS_LABEL: Record<Ticket["status"], string> = {
  open: "Ouvert",
  in_progress: "En cours",
  closed: "Clôturé",
};

export const STATUS_COLOR: Record<Ticket["status"], string> = {
  open: "#D4AF37",
  in_progress: "#4FC3F7",
  closed: "#9A9A9A",
};
