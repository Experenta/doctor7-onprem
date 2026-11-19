import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Glyph, Logotype } from './brand.jsx';
import { Illustration } from './illustrations.jsx';
import { EmptyState, ErrorState, Loaded, NoPermission, Skeleton } from './States.jsx';
import { Avatar, Button, Card, Chip, FilterChip, InlineAlert, PageHeader, Segmented, StatTile, StatusChip } from './ui.jsx';
import { CalendarIcon } from './icons.jsx';

const view = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('Button', () => {
  it('renders a button, a router link, or a plain link', () => {
    view(
      <>
        <Button>Save</Button>
        <Button to="/somewhere">Go</Button>
        <Button href="/plain">Plain</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/somewhere');
    expect(screen.getByRole('link', { name: 'Plain' })).toHaveAttribute('href', '/plain');
  });

  it('puts the variant in the class and keeps the icon out of the name', () => {
    view(
      <Button variant="secondary" icon={CalendarIcon}>
        Open
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Open' });
    expect(button).toHaveClass('btn', 'btn-secondary');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls the handler, and does nothing when disabled', async () => {
    const onClick = vi.fn();
    view(
      <>
        <Button onClick={onClick}>On</Button>
        <Button onClick={onClick} disabled>
          Off
        </Button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'On' }));
    await userEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('chips and switch', () => {
  it('shows a status in the tone of the status', () => {
    view(
      <>
        <StatusChip status="scheduled">Scheduled</StatusChip>
        <StatusChip status="cancelled">Cancelled</StatusChip>
        <Chip tone="dark">Role</Chip>
      </>,
    );
    expect(screen.getByText('Scheduled')).toHaveClass('chip-teal');
    expect(screen.getByText('Cancelled')).toHaveClass('chip-neutral');
    expect(screen.getByText('Role')).toHaveClass('chip-dark');
  });

  it('marks a filter chip as pressed, with its count', async () => {
    const onClick = vi.fn();
    view(
      <>
        <FilterChip pressed count={4} onClick={onClick}>
          All
        </FilterChip>
        <FilterChip pressed={false} onClick={onClick}>
          Closed
        </FilterChip>
      </>,
    );
    expect(screen.getByRole('button', { name: /^All\s*4$/ })).toHaveAttribute('aria-pressed', 'true');
    const closed = screen.getByRole('button', { name: 'Closed' });
    expect(closed).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(closed);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps exactly one segment on', async () => {
    const onChange = vi.fn();
    view(
      <Segmented
        label="View"
        value="list"
        onChange={onChange}
        options={[
          { value: 'list', label: 'List' },
          { value: 'week', label: 'Week' },
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: 'View' });
    expect(within(group).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(group).getByRole('button', { name: 'Week' }));
    expect(onChange).toHaveBeenCalledWith('week');
  });
});

describe('cards and figures', () => {
  it('renders a tile with a value, a label, and a hint', () => {
    view(<StatTile icon={CalendarIcon} value={7} label="Upcoming" hint="Next 7 days" />);
    expect(screen.getByText('7')).toHaveClass('stat-value');
    expect(screen.getByText('Upcoming')).toHaveClass('stat-label');
    expect(screen.getByText('Next 7 days')).toHaveClass('stat-hint');
  });

  it('renders a card as the element asked for', () => {
    view(
      <Card as="section" lift aria-label="Summary">
        Content
      </Card>,
    );
    const card = screen.getByRole('region', { name: 'Summary' });
    expect(card).toHaveClass('card', 'card-lift');
  });

  it('hides the initials from assistive technology', () => {
    view(<Avatar name="Ana Rivera" />);
    expect(screen.getByText('AR')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('page header', () => {
  it('has the title as the only h1, the date, and the actions', () => {
    view(
      <PageHeader title="Appointments">
        <Button>New</Button>
      </PageHeader>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Appointments' })).toBeInTheDocument();
    expect(document.querySelector('.page-date').textContent).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/);
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});

describe('data states', () => {
  it('shows one status region and one label, for every skeleton shape', () => {
    for (const variant of ['lines', 'list', 'home']) {
      const { unmount } = view(<Skeleton variant={variant} label="Loading rows" />);
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.getAllByText('Loading rows')).toHaveLength(1);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      expect(document.querySelector('.skeleton-blocks')).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('draws an own illustration in an empty state, and hides it from assistive technology', () => {
    view(
      <EmptyState title="Nothing here" art="calendar" action={<Button>Do it</Button>}>
        Add the first one.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Add the first one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument();
    expect(document.querySelector('svg.art')).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the tray illustration for an unknown name', () => {
    const { container } = view(<Illustration name="nothing" />);
    expect(container.querySelector('svg.art')).not.toBeNull();
  });

  it('states the problem and offers a retry', async () => {
    const retry = vi.fn();
    view(<ErrorState error={{ status: 500 }} onRetry={retry} title="It broke" />);
    expect(screen.getByRole('alert')).toHaveTextContent('It broke');
    expect(screen.getByRole('alert')).toHaveTextContent('The server had a problem. Try again in a moment.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows no permission with a way back', () => {
    view(<NoPermission />);
    expect(screen.getByRole('heading', { name: 'You do not have access to this screen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it('picks the state from the load result', () => {
    const empty = <p>empty</p>;
    const run = (state, extra = {}) => {
      const { unmount } = view(
        <Loaded state={state} empty={empty} isEmpty={(data) => data.length === 0} skeleton="list" {...extra}>
          {(data) => <p>{data.length} items</p>}
        </Loaded>,
      );
      return unmount;
    };
    let unmount = run({ status: 'loading' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    unmount();
    unmount = run({ status: 'error', error: { status: 403 } });
    expect(screen.getByText('You do not have access to this screen')).toBeInTheDocument();
    unmount();
    unmount = run({ status: 'error', error: { status: 500 }, reload: () => {} });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    unmount();
    unmount = run({ status: 'ready', data: [] });
    expect(screen.getByText('empty')).toBeInTheDocument();
    unmount();
    run({ status: 'ready', data: [1, 2] });
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('puts an inline alert in the alert role, with an optional retry', async () => {
    const retry = vi.fn();
    view(<InlineAlert onRetry={retry}>It failed.</InlineAlert>);
    expect(screen.getByRole('alert')).toHaveTextContent('It failed.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('brand', () => {
  it('writes the logotype as text, and draws the glyph as a decoration', () => {
    const { container } = render(
      <>
        <Logotype />
        <Glyph />
      </>,
    );
    expect(container.querySelector('.logotype').textContent).toBe('Doctor7');
    expect(container.querySelector('.logotype-seven').textContent).toBe('7');
    expect(container.querySelector('svg.glyph')).toHaveAttribute('aria-hidden', 'true');
  });
});
