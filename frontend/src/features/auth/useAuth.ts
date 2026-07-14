import { useContext } from 'react';
import { AuthContext } from './AuthContext';

/** Access the authenticated user + permission helper. Must be inside AuthProvider. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve essere usato dentro <AuthProvider>.');
  return ctx;
}
