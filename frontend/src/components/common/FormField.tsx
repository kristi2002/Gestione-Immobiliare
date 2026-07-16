import type { ReactNode } from 'react';

interface Props {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control wrapper shared by every entity create/edit form. */
export function FormField({ label, required, className, children }: Props) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-muted">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
