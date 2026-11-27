export type Role = 'user' | 'admin';
export type Locale = 'fr' | 'en' | 'ar';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface UserPreferences {
  /** null = no explicit choice, the browser's language is used. */
  locale: Locale | null;
  theme: ThemePreference;
  /** Show a toast when a message arrives outside the conversation being read. */
  messageNotifications: boolean;
}

/** User as exposed by the API: never contains the password hash. */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  preferences: UserPreferences;
}

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  preferred_locale: Locale | null;
  preferred_theme: ThemePreference;
  message_notifications: boolean;
}
