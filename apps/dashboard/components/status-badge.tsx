import type { WhatsAppDispatchStatus } from '../lib/api';

const styles: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800',
  PROCESSING: 'border-blue-200 bg-blue-50 text-blue-800',
  SUBMITTED: 'border-amber-200 bg-amber-50 text-amber-800',
  SENT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DELIVERED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  READ: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED: 'border-rose-200 bg-rose-50 text-rose-700',
  AMBIGUOUS: 'border-rose-200 bg-rose-50 text-rose-700',
};

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: 'ok' | 'warning' | 'neutral' | 'error';
  status?: WhatsAppDispatchStatus;
};

export function StatusBadge({
  children,
  tone = 'neutral',
  status,
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${
        styles[status ?? tone]
      }`}
    >
      {children}
    </span>
  );
}
