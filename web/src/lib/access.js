// Single source for who may open which screen. The navigation, the route guard,
// and the tests all read this file.

export const ROLE_LABELS = {
  professional: 'Professional',
  client: 'Client',
  admin: 'Administrator',
  auditor: 'Auditor',
};

const ALL = ['professional', 'client', 'admin', 'auditor'];

export const SCREEN_ROLES = {
  home: ALL,
  appointments: ['professional', 'client', 'admin'],
  newAppointment: ['professional', 'admin'],
  appointment: ['professional', 'client', 'admin'],
  newConsultation: ['professional'],
  consultation: ['professional', 'client', 'admin'],
  audit: ['auditor'],
};

export function canAccess(role, screen) {
  return Boolean(SCREEN_ROLES[screen] && SCREEN_ROLES[screen].includes(role));
}

// Navigation entries. `icon` is the name of a component in icons.jsx.
const NAV = [
  { screen: 'home', to: '/', label: 'Home', icon: 'HomeIcon', end: true },
  { screen: 'appointments', to: '/appointments', label: 'Appointments', icon: 'CalendarIcon', end: true },
  { screen: 'newAppointment', to: '/appointments/new', label: 'New appointment', icon: 'PlusIcon', end: true },
  { screen: 'audit', to: '/audit', label: 'Audit log', icon: 'ShieldIcon', end: true },
];

export function navItemsFor(role) {
  return NAV.filter((item) => canAccess(role, item.screen));
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || 'Unknown role';
}
