import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const KEY = 'adminKey';

interface AuthValue {
  adminKey: string;
  setAdminKey: (v: string) => void;
  clear: () => void;
}

const AuthContext = createContext<AuthValue>({ adminKey: '', setAdminKey: () => {}, clear: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminKey, setKey] = useState<string>(() => {
    try {
      return sessionStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });

  const setAdminKey = useCallback((v: string) => {
    setKey(v);
    try {
      sessionStorage.setItem(KEY, v);
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, []);

  const clear = useCallback(() => {
    setKey('');
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return <AuthContext.Provider value={{ adminKey, setAdminKey, clear }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
