import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth, HOME_FOR_ROLE } from '../lib/auth';
import { Loading } from '../components/UI';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (user) router.replace(HOME_FOR_ROLE[user.role] || '/login');
    else router.replace('/login');
  }, [user, loading, router]);
  return <Loading />;
}
