import { create } from 'zustand';

const SHOW_MS = 3000;

interface ToastState {
  message: string | null;
  /** Bumped per toast so a repeat of the same text still restarts the timer. */
  id: number;
}

/** One short notice at a time, shown by <Toaster /> in the layout. A new one replaces the old. */
export const useToast = create<ToastState>(() => ({ message: null, id: 0 }));

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string): void {
  clearTimeout(timer);
  useToast.setState((s) => ({ message, id: s.id + 1 }));
  timer = setTimeout(() => useToast.setState({ message: null }), SHOW_MS);
}
