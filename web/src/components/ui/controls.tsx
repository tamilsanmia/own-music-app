import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const fieldClass =
  'w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted transition-colors hover:border-muted focus-visible:border-foreground focus-visible:outline-none disabled:opacity-50';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClass, 'min-h-24 py-2', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldClass, 'h-10', className)} {...props} />;
}

export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
