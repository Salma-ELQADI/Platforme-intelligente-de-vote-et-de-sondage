import type {
  Conversation,
  GeneratedPoll,
  GroupInvitation,
  MemberRole,
  Message,
  Notification,
  Pagination,
  Poll,
  PollFormValues,
  PollResults,
  PollStatus,
  PollSummary,
  PollVoter,
  User,
  UserPreferences,
  VoteHistoryItem,
} from "@/types";

/** One field-level validation error. `code` + `params` let the UI word it in any language. */
export interface FieldDetail {
  field: string;
  message: string;
  code?: string;
  params?: Record<string, string | number>;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

/** Error thrown for any non-2xx response; carries the backend error code and field details. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: FieldDetail[],
  ) {
    super(message);
  }

  /** The detail reported for a given field (message, and a translatable code when the backend gives one). */
  fieldDetail(field: string) {
    return this.details?.find((d) => d.field === field || d.field.startsWith(`${field}.`));
  }

  /** Returns the message attached to a given field, if the backend reported one. */
  fieldError(field: string) {
    return this.fieldDetail(field)?.message;
  }
}

/**
 * Minimal fetch wrapper. `credentials: "include"` makes the browser send the
 * httpOnly auth cookie: the token is never accessible from JavaScript.
 */
async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // The message is a fallback: the UI translates errors by their code.
    throw new ApiError(0, "NETWORK_ERROR", "Impossible de joindre le serveur. Vérifiez votre connexion.");
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const err = json?.error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Une erreur inattendue est survenue", err?.details);
  }
  return json.data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && s.set(k, String(v)));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  // ---- Auth ----
  register: (body: { username: string; email: string; password: string; confirmPassword: string }) =>
    request<{ user: User }>("/auth/register", { method: "POST", body }),
  /** `identifier` = email or username. */
  login: (body: { identifier: string; password: string }) => request<{ user: User }>("/auth/login", { method: "POST", body }),
  logout: () => request<{ message: string }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),

  // ---- Profile & admin ----
  updateProfile: (body: { username?: string; email?: string; newPassword?: string; currentPassword?: string }) =>
    request<{ user: User }>("/users/me", { method: "PATCH", body }),
  listUsers: (params: { page?: number; search?: string }) =>
    request<{ users: User[]; pagination: Pagination }>(`/users${qs(params)}`),
  lookupUser: (identifier: string) => request<{ user: PollVoter }>(`/users/lookup${qs({ identifier })}`),
  adminUpdateUser: (id: string, body: { role?: User["role"]; isActive?: boolean }) =>
    request<{ user: User }>(`/users/${id}`, { method: "PATCH", body }),

  // ---- Polls ----
  listPolls: (params: { status: "ACTIVE" | "CLOSED"; search?: string; page?: number; limit?: number }) =>
    request<{ polls: Poll[]; pagination: Pagination }>(`/polls${qs(params)}`),
  myPolls: (status?: PollStatus) => request<{ polls: Poll[] }>(`/polls/mine${qs({ status })}`),
  getPoll: (id: string) => request<{ poll: Poll }>(`/polls/${id}`),
  createPoll: (body: PollFormValues) => request<{ poll: Poll }>("/polls", { method: "POST", body }),
  updatePoll: (id: string, body: Partial<PollFormValues>) => request<{ poll: Poll }>(`/polls/${id}`, { method: "PATCH", body }),
  publishPoll: (id: string) => request<{ poll: Poll }>(`/polls/${id}/publish`, { method: "POST" }),
  closePoll: (id: string) => request<{ poll: Poll }>(`/polls/${id}/close`, { method: "POST" }),
  deletePoll: (id: string) => request<void>(`/polls/${id}`, { method: "DELETE" }),

  // ---- Votes & results ----
  /** optionIds: one for single choice, several for multiple choice, in preference order for ranked polls. */
  vote: (pollId: string, optionIds: string[]) =>
    request<{ vote: { id: string; optionId: string; optionIds: string[] }; results: PollResults }>(`/polls/${pollId}/votes`, {
      method: "POST",
      body: { optionIds },
    }),
  unschedulePoll: (id: string) => request<{ poll: Poll }>(`/polls/${id}/unschedule`, { method: "POST" }),
  pollSummary: (id: string, locale: string) => request<{ summary: PollSummary }>(`/polls/${id}/summary${qs({ locale })}`),
  results: (pollId: string) => request<{ results: PollResults }>(`/polls/${pollId}/results`),
  myVotes: () => request<{ votes: VoteHistoryItem[] }>("/votes/me"),

  // ---- AI ----
  generatePoll: (body: { topic: string; optionCount: number; instructions?: string; language: "fr" | "en" | "ar"; previousQuestion?: string }) =>
    request<{ poll: GeneratedPoll }>("/ai/generate", { method: "POST", body }),

  // ---- Notifications ----
  notifications: () => request<{ notifications: Notification[]; unreadCount: number }>("/notifications"),
  markNotificationRead: (id: string) => request<{ notification: Notification }>(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: () => request<{ updated: number }>("/notifications/read-all", { method: "PATCH" }),

  // ---- Preferences & people ----
  updatePreferences: (body: Partial<UserPreferences>) => request<{ user: User }>("/users/me/preferences", { method: "PATCH", body }),
  directory: (search: string) => request<{ users: PollVoter[] }>(`/users/directory${qs({ search })}`),

  // ---- Messaging ----
  conversations: (search?: string) => request<{ conversations: Conversation[] }>(`/conversations${qs({ search })}`),
  conversation: (id: string) => request<{ conversation: Conversation }>(`/conversations/${id}`),
  unreadMessages: () => request<{ total: number }>("/conversations/unread-count"),
  openDirect: (userId: string) => request<{ conversation: Conversation }>("/conversations/direct", { method: "POST", body: { userId } }),
  createGroup: (body: { name: string; memberIds: string[] }) =>
    request<{ conversation: Conversation }>("/conversations/groups", { method: "POST", body }),
  renameGroup: (id: string, name: string) => request<{ conversation: Conversation }>(`/conversations/${id}`, { method: "PATCH", body: { name } }),
  addMembers: (id: string, userIds: string[]) =>
    request<{ conversation: Conversation }>(`/conversations/${id}/members`, { method: "POST", body: { userIds } }),
  setMemberRole: (id: string, userId: string, role: MemberRole) =>
    request<{ conversation: Conversation }>(`/conversations/${id}/members/${userId}`, { method: "PATCH", body: { role } }),
  removeMember: (id: string, userId: string) => request<{ left: boolean }>(`/conversations/${id}/members/${userId}`, { method: "DELETE" }),
  messages: (id: string, params: { before?: number; after?: number; limit?: number }) =>
    request<{ messages: Message[]; hasMore: boolean }>(`/conversations/${id}/messages${qs(params)}`),
  sendMessage: (id: string, body: { body: string; clientId: string }) =>
    request<{ message: Message }>(`/conversations/${id}/messages`, { method: "POST", body }),
  markConversationRead: (id: string, seq?: number) =>
    request<{ lastReadSeq: number }>(`/conversations/${id}/read`, { method: "POST", body: seq === undefined ? {} : { seq } }),
  groupPolls: (id: string) => request<{ polls: Poll[] }>(`/conversations/${id}/polls`),
  cancelInvitation: (conversationId: string, invitationId: string) =>
    request<{ conversation: Conversation }>(`/conversations/${conversationId}/invitations/${invitationId}`, { method: "DELETE" }),

  // ---- Group invitations ----
  invitations: () => request<{ invitations: GroupInvitation[] }>("/invitations"),
  acceptInvitation: (id: string) => request<{ conversation: Conversation }>(`/invitations/${id}/accept`, { method: "POST" }),
  declineInvitation: (id: string) => request<{ declined: boolean }>(`/invitations/${id}/decline`, { method: "POST" }),
};
