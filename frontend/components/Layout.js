import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useBootcamp } from '../lib/bootcamp';
import { usePrefs } from '../lib/prefs';
import { Avatar } from './UI';

// Grouped navigation per role.
const NAV = {
  admin: [
    { section: 'Operations', items: [
      { href: '/admin', label: 'Dashboard', icon: 'grid' },
      { href: '/admin/bootcamps', label: 'Cohorts', icon: 'layers', badge: 'bootcamps' },
    ] },
    { section: 'Content', items: [
      { href: '/admin/roster', label: 'Directory', icon: 'book' },
      { href: '/admin/students', label: 'Registrations', icon: 'clipboard' },
      { href: '/admin/teams', label: 'Teams', icon: 'users' },
    ] },
    { section: 'Assessment', items: [
      { href: '/admin/rubrics', label: 'Rubrics', icon: 'sliders' },
      { href: '/admin/tasks', label: 'Task & Feedback', icon: 'check' },
      { href: '/admin/questions', label: 'Submissions', icon: 'chat' },
      { href: '/admin/reports', label: 'Result & remarks', icon: 'chart' },
      { href: '/admin/certificates', label: 'Certificates', icon: 'award' },
    ] },
    { section: 'People', items: [
      { href: '/admin/users', label: 'Users', icon: 'person' },
      { href: '/admin/chat', label: 'Chat Monitor', icon: 'chat' },
    ] },
  ],
  mentor: [
    { section: 'Mentoring', items: [
      { href: '/mentor', label: 'Teams', icon: 'users' },
      { href: '/mentor/assess', label: 'Assessment', icon: 'star' },
      { href: '/mentor/tasks', label: 'Task Feedback', icon: 'chat' },
    ] },
  ],
  volunteer: [
    { section: 'Registration', items: [
      { href: '/volunteer', label: 'Register Students', icon: 'plus' },
    ] },
  ],
  student: [
    { section: 'Learning', items: [
      { href: '/student/dashboard', label: 'Dashboard', icon: 'grid' },
      { href: '/student', label: 'My Submissions', icon: 'inbox' },
      { href: '/student/tasks', label: 'Tasks & Feedbacks', icon: 'check' },
      { href: '/student/chat', label: 'Team Chat', icon: 'chat' },
      { href: '/student/certificate', label: 'My Certificate', icon: 'award' },
    ] },
  ],
};

const ROLE_TAGLINE = {
  admin: 'Student Developer Program · Admin',
  mentor: 'Student Developer Program · Mentor',
  volunteer: 'Student Developer Program · Volunteer',
  student: 'Student Developer Program · Student',
};

const P = {
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  clipboard: 'M9 4h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2V5a1 1 0 0 1 1-1Zm0 3h6V6H9v1Zm-1 5 2 2 4-4',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.87M16.5 3.6a3.5 3.5 0 0 1 0 6.8',
  sliders: 'M4 8h10M18 8h2M4 16h2M10 16h10M14 6v4M6 14v4',
  check: 'M9 11l3 3L20 6M20 12v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h9',
  chat: 'M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10Z',
  person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z',
  plus: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  layers: 'M12 3l9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5ZM19 3v16M8 7h7M8 11h7',
  chart: 'M3 3v18h18M8 17V10M13 17V6M18 17v-4',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8.5 13.5 7 22l5-3 5 3-1.5-8.5',
};

function Icon({ name }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name] || P.grid} />
    </svg>
  );
}

function BrandBadge() {
  return (
    <span className="brand-badge">
      <span className="brand-dot a" /><span className="brand-dot b" /><span className="brand-dot c" />
    </span>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { bootcamps, bootcampId, setBootcampId } = useBootcamp() || {};
  const { theme, toggleTheme } = usePrefs() || {};
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const sections = user ? NAV[user.role] || [] : [];
  const showSwitch = user && user.role !== 'student' && bootcamps && bootcamps.length > 0;

  useEffect(() => { setOpen(false); }, [router.pathname]);

  const badgeValue = (key) => {
    if (key === 'bootcamps') return bootcamps?.length;
    return undefined;
  };

  return (
    <div className="app-shell">
      <div className="topbar">
        <button className="hamburger" onClick={() => setOpen(true)} aria-label="Menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <BrandBadge />
        <span className="wordmark">SDP</span>
      </div>

      {open && <div className="drawer-backdrop" onClick={() => setOpen(false)} />}

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <BrandBadge />
          <div>
            <div className="brand-name">iOSDC<span className="accent"> SDP</span></div>
            <div className="tagline">{user ? ROLE_TAGLINE[user.role] : 'Learning Platform'}</div>
          </div>
        </div>

        {showSwitch && (
          <div className="camp-switch">
            <label>Cohort</label>
            <select className="camp-select" value={bootcampId || ''} onChange={(e) => setBootcampId(e.target.value)}>
              {bootcamps.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <nav className="nav">
          {sections.map((sec) => (
            <div key={sec.section}>
              <div className="nav-section">{sec.section}</div>
              {sec.items.map((it) => {
                const active = router.pathname === it.href;
                const badge = badgeValue(it.badge);
                return (
                  <Link key={it.href} href={it.href} className={`nav-item ${active ? 'active' : ''}`}>
                    <span className="nav-icon"><Icon name={it.icon} /></span>
                    {it.label}
                    {badge !== undefined && badge !== null && <span className="nav-badge">{badge}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {user && (
          <div className="sidebar-foot">
            <div className="foot-user">
              <Avatar name={user.name} id={user.id} />
              <div className="grow">
                <div className="u-name">{user.name}</div>
                <div className="u-role">{user.role}</div>
              </div>
              <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
                {theme === 'light' ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>
                )}
              </button>
            </div>
            <div className="foot-links">
              <Link href="/settings" className="signout-link">⚙ Settings</Link>
              <button className="signout-link" onClick={logout}>Sign out →</button>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function PageHead({ title, subtitle, actions, crumb }) {
  return (
    <div>
      <div className="crumbs">
        <span className="crumb">Dashboard</span>
        <span className="crumb-sep">›</span>
        <span className="crumb active">{crumb || title}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        {actions && <div className="hstack">{actions}</div>}
      </div>
    </div>
  );
}
