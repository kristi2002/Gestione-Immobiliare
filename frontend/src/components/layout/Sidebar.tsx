import { Home, LogOut, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/features/auth/useAuth';
import { initials } from '@/lib/format';
import { SidebarNav } from './SidebarNav';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Amministratore',
  admin: 'Amministratore',
  agent: 'Agente',
  readonly: 'Sola lettura',
};

/** Fixed dark-navy sidebar: brand, profile, grouped nav, logout. */
export function Sidebar() {
  const { user } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-sidebar text-white">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-white/10">
          <Home className="size-5" />
        </div>
        <div className="leading-tight">
          <p className="font-brand text-[13px] font-semibold tracking-wide text-white/70">IMMOBILIARE</p>
          <p className="font-brand text-lg font-bold leading-none">ORLANDI</p>
        </div>
      </div>

      {/* Profile card */}
      <button
        type="button"
        className="mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5"
      >
        <Avatar>
          <AvatarFallback className="bg-white/15 text-white">{initials(user.username)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold capitalize">{user.username}</p>
          <p className="truncate text-xs text-white/50">{ROLE_LABEL[user.role] ?? user.role}</p>
        </div>
        <ChevronRight className="size-4 text-white/40" />
      </button>

      <SidebarNav />

      {/* Logout */}
      <div className="border-t border-white/10 p-3">
        <a
          href="/logout.php"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="size-[18px]" />
          Esci
        </a>
      </div>
    </aside>
  );
}
