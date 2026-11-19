import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ok, renderApp, USERS } from '../test/helpers.jsx';

const empty = { 'GET /appointments': ok({ items: [] }), 'GET /audit': ok({ items: [] }) };

async function shell(role, path = '/') {
  const view = renderApp(path, empty, role);
  await screen.findByRole('navigation', { name: 'Main' });
  const sidebar = view.container.querySelector('.sidebar');
  return { ...view, sidebar };
}

describe('Shell', () => {
  it('has a skip link that targets the main landmark', async () => {
    const { container } = await shell('professional');
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(container.querySelector('main#main')).not.toBeNull();
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('puts the logotype first, then the navigation, then the user chip', async () => {
    const { sidebar } = await shell('professional');
    const order = [...sidebar.children].map((child) => child.className.split(' ')[0]);
    expect(order).toEqual(['brand', 'side-nav', 'user-chip']);
    expect(within(sidebar).getByRole('link', { name: 'Doctor7' })).toHaveAttribute('href', '/');
  });

  it('shows the user chip with initials, name, and role, and one sign-out button', async () => {
    const { sidebar } = await shell('professional');
    const chip = sidebar.querySelector('.user-chip');
    expect(within(chip).getByText('AR')).toBeInTheDocument();
    expect(within(chip).getByText(USERS.professional.displayName)).toBeInTheDocument();
    expect(within(chip).getByText('Professional')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  });

  it('shows the role label of each role', async () => {
    for (const [role, label] of [
      ['client', 'Client'],
      ['admin', 'Administrator'],
      ['auditor', 'Auditor'],
    ]) {
      const { sidebar, unmount } = await shell(role);
      expect(sidebar.querySelector('.user-role')).toHaveTextContent(label);
      unmount();
    }
  });

  it('keeps the navigation to four destinations or fewer, as links with icons that are decoration', async () => {
    for (const role of ['professional', 'client', 'admin', 'auditor']) {
      const { unmount } = await shell(role);
      const nav = screen.getByRole('navigation', { name: 'Main' });
      const links = within(nav).getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
      expect(links.length).toBeLessThanOrEqual(4);
      for (const link of links) expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(within(nav).queryByRole('button')).toBeNull();
      unmount();
    }
  });

  it('marks the page that is open in the navigation', async () => {
    await shell('professional', '/appointments');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Appointments' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    await userEvent.click(within(nav).getByRole('link', { name: 'Home' }));
    expect(await screen.findByRole('heading', { name: /Welcome, Ana Rivera/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders the navigation and the user chip once, so no name is duplicated', async () => {
    const { container } = await shell('client');
    expect(container.querySelectorAll('nav')).toHaveLength(1);
    expect(container.querySelectorAll('.user-chip')).toHaveLength(1);
    expect(container.querySelectorAll('.brand')).toHaveLength(1);
  });
});
