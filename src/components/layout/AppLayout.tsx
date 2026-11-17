import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun, X, ShieldCheck } from 'lucide-react';
import { NAV } from './nav';
import { useAuth } from '@/contexts/auth';
import { useTheme } from '@/contexts/theme';
import { cn } from '@/lib/utils';

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <ShieldCheck className="size-4.5" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">Group Extractor</p>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary">Pro</p>
      </div>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="grid gap-0.5" aria-label="Menu principal">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              isActive && 'bg-accent text-accent-foreground hover:bg-accent',
            )
          }
        >
          <Icon className="size-4 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <div className="grid gap-2 border-t pt-3">
      <button onClick={toggle} className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
      </button>
      <div className="flex items-center gap-2 rounded-md px-3 py-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold uppercase">
          {(user?.email ?? '?').slice(0, 2)}
        </div>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={user?.email}>{user?.email}</p>
        <button onClick={signOut} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sair">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-sidebar p-4 lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto"><NavLinks /></div>
        <SidebarFooter />
      </aside>

      {/* Barra superior mobile/tablet */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} className="-ml-2 rounded-md p-2.5 hover:bg-muted" aria-label="Abrir menu" aria-expanded={open}>
          <Menu className="size-5" />
        </button>
        <span className="truncate text-sm font-semibold">{current?.label ?? 'Group Extractor Pro'}</span>
      </header>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-[300px] flex-col gap-6 bg-sidebar p-4 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-md p-2.5 hover:bg-muted" aria-label="Fechar menu"><X className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto"><NavLinks onNavigate={() => setOpen(false)} /></div>
            <SidebarFooter />
          </aside>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto grid max-w-7xl gap-6 animate-fade-in" key={location.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
