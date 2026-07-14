export type AdminRole = 'super_admin' | 'admin' | 'agent' | 'readonly';

export interface AuthUser {
  id: number;
  username: string;
  role: AdminRole;
}

export interface MeResponse {
  user: AuthUser;
  /** '*' (wildcard) for super_admin, otherwise the list of allowed view keys. */
  permissions: string[];
  csrf_token: string;
}
