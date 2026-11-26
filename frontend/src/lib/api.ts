import type {
  GeneratedPoll,
  Notification,
  Pagination,
  Poll,
  PollFormValues,
  PollResults,
  PollStatus,
  PollVoter,
  User,
  VoteHistoryItem,
} from "@/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

/** Error thrown for any non-2xx response; carries the backend error code and field details. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }

  /** Returns the message attached to a given field, if the backend reported one. */
  fieldError(field: string) {
    return this.details?.find((d) => d.field === field || d.field.startsWith(`${field}.`))?.message;
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
  login: (body: { email: string; password: string }) => request<{ user: User }>("/auth/login", { method: "POST", body }),
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
  vote: (pollId: string, optionId: string) =>
    request<{ vote: { id: string; optionId: string }; results: PollResults }>(`/polls/${pollId}/votes`, {
      method: "POST",
      body: { optionId },
    }),
  results: (pollId: string) => request<{ results: PollResults }>(`/polls/${pollId}/results`),
  myVotes: () => request<{ votes: VoteHistoryItem[] }>("/votes/me"),

  // ---- AI ----
  generatePoll: (body: { topic: string; optionCount: number; instructions?: string; language: "fr" | "en"; previousQuestion?: string }) =>
    request<{ poll: GeneratedPoll }>("/ai/generate", { method: "POST", body }),

  // ---- Notifications ----
  notifications: () => request<{ notifications: Notification[]; unreadCount: number }>("/notifications"),
  markNotificationRead: (id: string) => request<{ notification: Notification }>(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: () => request<{ updated: number }>("/notifications/read-all", { method: "PATCH" }),
};
