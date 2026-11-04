import { useToast } from '@/lib/toast';

export function Toaster() {
  const { message, id } = useToast();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center">
      {message && (
        <p key={id} role="status" className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-lg">
          {message}
        </p>
      )}
    </div>
  );
}
