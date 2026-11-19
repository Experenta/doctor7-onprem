// Single-stroke icons. They are decorative: the text next to them names the action.
// No namespace attribute is needed: React renders inline SVG without it.

function Svg({ d, className }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

const make = (d) =>
  function Icon({ className }) {
    return <Svg d={d} className={className} />;
  };

export const HomeIcon = make('M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6');
export const CalendarIcon = make('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4');
export const PlusIcon = make('M12 5v14M5 12h14');
export const VideoIcon = make('M3 7h12v10H3zM15 11l6-4v10l-6-4');
export const ChatIcon = make('M4 5h16v11H9l-5 4z');
export const FileIcon = make('M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7');
export const ShieldIcon = make('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z');
export const MenuIcon = make('M4 6h16M4 12h16M4 18h16');
export const LogOutIcon = make('M10 4H5v16h5M14 8l5 4-5 4M19 12H9');
export const AlertIcon = make('M12 4l9 16H3zM12 10v4M12 17h.01');
export const InboxIcon = make('M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5');
export const LockIcon = make('M6 11h12v9H6zM8 11V8a4 4 0 018 0v3');
export const SendIcon = make('M4 12l16-8-6 16-3-7z');
export const ClockIcon = make('M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2');
export const UsersIcon = make(
  'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20v-1a5 5 0 0110 0v1M16 5a3 3 0 010 6M18 20v-1a4 4 0 00-3-4',
);
export const ListIcon = make('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01');
export const WeekIcon = make('M4 5h16v14H4zM9.3 5v14M14.7 5v14');
export const ArrowRightIcon = make('M5 12h14M13 6l6 6-6 6');
export const ArrowLeftIcon = make('M19 12H5M11 6l-6 6 6 6');
export const CheckIcon = make('M5 12.5l4.5 4.5L19 7');
export const PulseIcon = make('M3 12h4l3-7 4 14 3-7h4');
export const BanIcon = make('M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8');
export const SearchIcon = make('M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l5 5');
export const CloseIcon = make('M6 6l12 12M18 6L6 18');
export const RefreshIcon = make('M20 11a8 8 0 00-14-4M4 4v4h4M4 13a8 8 0 0014 4M20 20v-4h-4');
