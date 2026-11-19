import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { navItemsFor, roleLabel } from '../lib/access.js';
import { Glyph, Logotype } from './brand.jsx';
import * as icons from './icons.jsx';
import { Avatar } from './ui.jsx';

// The shell: a fixed sidebar on wide screens, and on narrow screens a top bar with the
// logotype and the user, plus a bottom bar with the destinations. One set of elements
// serves both layouts, and the stylesheet moves them, so nothing is rendered twice.
export default function Layout() {
  const { user, signOut } = useAuth();
  const items = navItemsFor(user.role);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="sidebar">
        <Link className="brand" to="/">
          <Glyph />
          <Logotype />
        </Link>
        <nav id="main-nav" className="side-nav" aria-label="Main">
          {items.map((item) => {
            const Icon = icons[item.icon];
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className="side-link">
                <Icon />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="user-chip">
          <Avatar name={user.displayName} tone="turquoise" />
          <div className="user-meta">
            <span className="user-name">{user.displayName}</span>
            <span className="user-role">{roleLabel(user.role)}</span>
          </div>
          <button type="button" className="signout" onClick={signOut}>
            <icons.LogOutIcon />
            <span className="signout-label">Sign out</span>
          </button>
        </div>
      </header>
      <div className="shell-body">
        <main id="main" className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
