// Logo « PaieCI » — pictogramme de bulletin, sans dépendance externe.
export default function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#4f46e5" />
      <rect x="13" y="11" width="22" height="26" rx="3" fill="#eef2ff" />
      <path d="M17 18h14M17 23h14M17 28h9" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="31" cy="30" r="1.6" fill="#4f46e5" />
    </svg>
  );
}
