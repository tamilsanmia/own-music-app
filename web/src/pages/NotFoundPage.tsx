import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <section className="grid justify-items-start gap-4">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <Button asChild variant="secondary">
        <Link to="/">Go home</Link>
      </Button>
    </section>
  );
}
