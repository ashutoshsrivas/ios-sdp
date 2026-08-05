import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { useAuth } from './auth';

const BootcampContext = createContext(null);

export function BootcampProvider({ children }) {
  const { user } = useAuth();
  const [bootcamps, setBootcamps] = useState([]);
  const [bootcampId, setBid] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || user.role === 'student') {
      setBootcamps([]);
      setLoading(false);
      return;
    }
    try {
      const list = await api.get('/api/bootcamps');
      setBootcamps(list);
      const stored = typeof window !== 'undefined' ? Number(localStorage.getItem('bootcampId')) : null;
      const valid = list.find((b) => b.id === stored);
      setBid(valid ? valid.id : list[0]?.id ?? null);
    } catch {
      setBootcamps([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const setBootcampId = (id) => {
    const n = Number(id);
    setBid(n);
    if (typeof window !== 'undefined') localStorage.setItem('bootcampId', String(n));
  };

  const currentBootcamp = bootcamps.find((b) => b.id === bootcampId) || null;

  return (
    <BootcampContext.Provider
      value={{ bootcamps, bootcampId, setBootcampId, currentBootcamp, reload, loading }}
    >
      {children}
    </BootcampContext.Provider>
  );
}

export const useBootcamp = () => useContext(BootcampContext);

// Helper: append the bootcamp scope to a path.
export function scoped(path, bootcampId) {
  if (!bootcampId) return path;
  return path + (path.includes('?') ? '&' : '?') + 'bootcamp=' + bootcampId;
}
