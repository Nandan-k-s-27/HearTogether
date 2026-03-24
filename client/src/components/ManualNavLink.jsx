import { Link } from 'react-router-dom';
import { BookOpenText } from 'lucide-react';

export default function ManualNavLink({ className = '' }) {
  return (
    <Link
      to="/manual"
      className={`group inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs sm:text-sm font-semibold text-gray-200 transition hover:border-brand-400/60 hover:bg-brand-500/15 hover:text-white ${className}`}
      aria-label="Open user manual"
      title="Open user manual"
    >
      <BookOpenText className="h-4 w-4 text-brand-400 transition group-hover:scale-110" />
      User Manual
    </Link>
  );
}
