/** App shell: bottom navigation on mobile, sidebar on desktop, offline + install banners. */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  LineChart,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useSession } from '../hooks/useSession';
import { useInstallPrompt, useOnline } from '../hooks/useOnline';
import { InstallPrompt } from './InstallPrompt';

export function AppShell() {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut } = useSession();
  const online = useOnline();
  const install = useInstallPrompt();
  const navigate = useNavigate();

  const navItems = [
    { to: '/today', labelKey: 'nav.today' as const, icon: Activity },
    { to: '/plan', labelKey: 'nav.plan' as const, icon: CalendarRange },
    { to: '/log', labelKey: 'nav.log' as const, icon: ClipboardList },
    { to: '/calendar', labelKey: 'nav.calendar' as const, icon: CalendarDays },
    { to: '/progress', labelKey: 'nav.progress' as const, icon: LineChart },
    { to: '/reports', labelKey: 'nav.reports' as const, icon: FileText },
    { to: '/account', labelKey: 'nav.account' as const, icon: User },
  ];

  return (
    <div className="min-h-dvh bg-stone-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-700 font-bold text-white">
              T
            </span>
            <div>
              <p className="text-sm font-bold leading-tight text-stone-900">{t('app.name')}</p>
              <p className="text-[11px] leading-tight text-stone-500">{t('app.tagline')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="locale-select">
              {t('account.language')}
            </label>
            <select
              id="locale-select"
              className="input !min-h-9 !w-auto !py-1 text-sm"
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
            >
              <option value="en">English</option>
              <option value="nl">Nederlands</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
            {user?.isAdmin && (
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="btn-secondary !min-h-9 !px-2 text-sm"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
                <span className="sr-only">{t('nav.admin')}</span>
              </button>
            )}
          </div>
        </div>
        {!online && (
          <div
            role="status"
            className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900"
          >
            {t('state.offline')}
          </div>
        )}
      </header>

      <InstallPrompt {...install} />

      <div className="mx-auto flex max-w-6xl gap-8 px-4 pb-24 pt-4 md:pb-8">
        {/* Desktop sidebar */}
        <nav aria-label="Primary" className="hidden w-48 shrink-0 md:block">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                  {t(item.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
            className="btn-secondary mt-6 w-full"
          >
            {t('account.sign_out')}
          </button>
        </nav>

        <main id="main-content" className="min-w-0 flex-1" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-7">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-item nav-item-active' : 'nav-item')}
              >
                <item.icon className="h-5 w-5" aria-hidden />
                {t(item.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
