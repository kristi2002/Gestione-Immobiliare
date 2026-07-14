interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned actions (buttons, filters). */
  actions?: React.ReactNode;
}

/** Standard page heading: 26px bold title + optional subtitle and actions. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-page-title text-navy">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
