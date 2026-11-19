import { Link } from 'react-router-dom';
import { formatToday } from '../lib/schedule.js';
import { initialsOf } from '../lib/initials.js';
import { AlertIcon } from './icons.jsx';

const cx = (...parts) => parts.filter(Boolean).join(' ');

// A button. With `to` it is a router link, with `href` a plain link, otherwise a button.
// Variants: primary, secondary, ghost, on-band (for the gradient band).
export function Button({ variant = 'primary', icon: Icon, to, href, className, children, ...rest }) {
  const classes = cx('btn', `btn-${variant}`, className);
  const content = (
    <>
      {Icon && <Icon />}
      {children}
    </>
  );
  if (to) {
    return (
      <Link className={classes} to={to} {...rest}>
        {content}
      </Link>
    );
  }
  if (href) {
    return (
      <a className={classes} href={href} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={classes} {...rest}>
      {content}
    </button>
  );
}

// A small label with a status or a count. Tones: neutral, teal, purple, magenta.
export function Chip({ tone = 'neutral', icon: Icon, className, children }) {
  return (
    <span className={cx('chip', `chip-${tone}`, className)}>
      {Icon && <Icon />}
      {children}
    </span>
  );
}

const STATUS_TONES = { scheduled: 'teal', completed: 'purple', cancelled: 'neutral' };

export function StatusChip({ status, children }) {
  return <Chip tone={STATUS_TONES[status] || 'neutral'}>{children}</Chip>;
}

// A chip that toggles a filter. The pressed state is for assistive technology and style.
export function FilterChip({ pressed, count, onClick, children }) {
  return (
    <button type="button" className="chip chip-filter" aria-pressed={pressed} onClick={onClick}>
      {children}
      {count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  );
}

// Two or three buttons where exactly one is on, such as List and Week.
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className="segmented-item"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ as: Tag = 'div', lift = false, className, children, ...rest }) {
  return (
    <Tag className={cx('card', lift && 'card-lift', className)} {...rest}>
      {children}
    </Tag>
  );
}

// A figure with its label. Tones: purple, turquoise, magenta.
export function StatTile({ icon: Icon, value, label, hint, tone = 'purple' }) {
  return (
    <div className="stat">
      <span className={cx('stat-icon', `stat-icon-${tone}`)}>
        <Icon />
      </span>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}

// Initials in a round badge. The name next to it carries the meaning, so it is hidden from
// assistive technology.
export function Avatar({ name, size = 'md', tone = 'purple' }) {
  return (
    <span className={cx('avatar', `avatar-${size}`, `avatar-${tone}`)} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

// The light header of a screen: title, today's date in Bogota time, and the actions.
export function PageHeader({ title, children }) {
  return (
    <header className="page-header">
      <div className="page-title">
        <h1>{title}</h1>
        <p className="page-date">{formatToday()}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

// A problem inside a screen, with an optional retry.
export function InlineAlert({ children, onRetry }) {
  return (
    <div className="alert" role="alert">
      <AlertIcon />
      <p>{children}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
