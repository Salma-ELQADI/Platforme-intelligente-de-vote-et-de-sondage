export type Role = 'user' | 'admin';

/** User as exposed by the API: never contains the password hash. */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
}
