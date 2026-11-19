// Single-stroke icons. They are decorative: the text next to them names the action.
// No namespace attribute is needed: React renders inline SVG without it.

function Svg({ d }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

const make = (d) =>
  function Icon() {
    return <Svg d={d} />;
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
