import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { navItemsFor, roleLabel } from '../lib/access.js';
import * as icons from './icons.jsx';

export default function Layout() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const items = navItemsFor(user.role);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link className="brand" to="/">
            <icons.VideoIcon />
            Doctor7
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="main-nav"
            onClick={() => setOpen((value) => !value)}
          >
            <icons.MenuIcon />
            Menu
          </button>
          <nav id="main-nav" className="main-nav" aria-label="Main" data-open={open}>
            {items.map((item) => {
              const Icon = icons[item.icon];
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className="nav-link"
                  onClick={() => setOpen(false)}
                >
                  <Icon />
                  {item.label}
                </NavLink>
              );
            })}
            <span className="nav-user nav-spacer">
              {user.displayName}, {roleLabel(user.role)}
            </span>
            <button type="button" className="nav-button" onClick={signOut}>
              <icons.LogOutIcon />
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main id="main" className="app-main">
        <Outlet />
      </main>
    </>
  );
}
