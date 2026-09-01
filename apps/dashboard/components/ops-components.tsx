'use client';

import { Check, Copy, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatDateTime } from '../lib/format';

export type OpsTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function OpsPageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="ops-page-heading">
      <div>
        <p className="ops-eyebrow">{eyebrow}</p>
        <h1 className="ops-page-title">{title}</h1>
        <p className="ops-page-description">{description}</p>
      </div>
      {actions ? <div className="ops-header-actions">{actions}</div> : null}
    </div>
  );
}

export function OpsSection({
  title,
  meta,
  actions,
  children,
  className = '',
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ops-section ${className}`}>
      <div className="ops-section-header">
        <div>
          <h2 className="ops-section-title">{title}</h2>
          {meta ? <p className="ops-section-meta">{meta}</p> : null}
        </div>
        {actions}
      </div>
      <div className="ops-section-body">{children}</div>
    </section>
  );
}

export function OpsBadge({ tone = 'neutral', children }: { tone?: OpsTone; children: ReactNode }) {
  return <span className="ops-badge" data-tone={tone}>{children}</span>;
}

export function toneForStatus(status?: string | null): OpsTone {
  switch (status?.toUpperCase()) {
    case 'SENT':
    case 'DISPATCHED':
    case 'COMPLETED':
    case 'PREVIEW_READY':
      return 'success';
    case 'FAILED':
    case 'BLOCKED':
    case 'EXPIRED':
      return 'danger';
    case 'PROCESSING':
    case 'QUEUED':
    case 'COPY_READY':
      return 'info';
    case 'PENDING':
    case 'STARTED':
    case 'AMBIGUOUS':
    case 'RESERVED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function OpsState({
  title,
  message,
  action,
  tone = 'neutral',
}: {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: OpsTone;
}) {
  return (
    <div className="ops-state" role={tone === 'danger' ? 'alert' : undefined}>
      {tone === 'danger' ? <TriangleAlert size={16} aria-hidden="true" /> : null}
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

export function OpsLoading({ label = 'Carregando dados operacionais' }: { label?: string }) {
  return (
    <div className="ops-state" aria-live="polite">
      <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function OpsEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="ops-empty">
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function CopyIdButton({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="ops-mono">—</span>;
  return (
    <button
      type="button"
      className="ops-id-button inline-flex max-w-full items-center gap-2 border-0 bg-transparent p-0 text-left"
      title="Copiar ID"
      aria-label={`Copiar ID ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={13} className="text-[var(--ops-success)]" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span className="ops-mono min-w-0 truncate">{value}</span>
    </button>
  );
}

export function RefreshButton({ onClick, busy = false }: { onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" className="ops-button" onClick={onClick} disabled={busy}>
      <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
      Atualizar
    </button>
  );
}

export function Countdown({ target }: { target: string | null }) {
  const [remaining, setRemaining] = useState('—');

  useEffect(() => {
    const update = () => {
      if (!target) {
        setRemaining('—');
        return;
      }
      const seconds = Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000));
      const minutes = Math.floor(seconds / 60);
      const rest = seconds % 60;
      setRemaining(`${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  return <span className="ops-mono">{remaining}</span>;
}

export function UpdatedAt({ value }: { value: string | null | undefined }) {
  return <span className="ops-mono">{value ? formatDateTime(value) : 'sem atualização'}</span>;
}
