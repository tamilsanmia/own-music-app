import { useAuth } from '@/auth/AuthProvider';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const { user } = useAuth();
  return (
    <section>
      <h1 className="text-3xl font-bold">
        {greeting(new Date().getHours())}, {user?.displayName}
      </h1>
      <p className="mt-4 text-muted">Your library is empty for now. Albums appear here once the admin uploads music.</p>
    </section>
  );
}
