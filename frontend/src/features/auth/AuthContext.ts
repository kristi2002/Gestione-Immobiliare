import { createContext } from 'react';
import type { AuthUser } from '@/types/auth';

export interface AuthContextValue {
  user: AuthUser;
  permissions: string[];
  /** True if the current role may access the given view key. */
  can: (viewKey: string) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
