import { NavLink } from 'react-router-dom';
import { NAV_GROUPS } from '@/config/navigation';
import { useAuth } from '@/features/auth/useAuth';
import { cn } from '@/lib/utils';

/** Grouped, role-filtered navigation for the sidebar. */
export function SidebarNav() {
  const { can } = useAuth();

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group, gi) => {
        const items = group.items.filter((item) => can(item.key));
        if (items.length === 0) return null;

        return (
          <div key={group.title ?? `group-${gi}`}>
            {group.title && (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                {group.title}
              </p>
            )}
            <ul className="space-y-1">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-white/70 hover:bg-white/10 hover:text-white',
                        )
                      }
                    >
                      <Icon className="size-[18px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
