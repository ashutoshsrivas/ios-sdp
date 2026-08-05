import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { api, setToken, getToken } from './api';

const AuthContext = createContext(null);

export const HOME_FOR_ROLE = {
  admin: '/admin',
  mentor: '/mentor',
  volunteer: '/volunteer',
  student: '/student/dashboard',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const { user } = await api.get('/api/auth/me');
      setUser(user);
      return user;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    router.replace(HOME_FOR_ROLE[data.user.role] || '/');
    return data.user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    router.replace('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Guard hook: redirect if not authed or wrong role.
export function useRequireRole(roles) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
    } else if (roles && !roles.includes(user.role)) {
      router.replace(HOME_FOR_ROLE[user.role] || '/login');
    }
  }, [user, loading, roles, router]);
  return { user, loading, ok: !!user && (!roles || roles.includes(user.role)) };
}
