import { useAuth } from '../context/AuthContext';
import { ShimmerButton } from './ui/shimmer-button';

export function UserProfile() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      {user.picture && (
        <img
          src={user.picture}
          alt={user.name}
          className="w-8 h-8 rounded-full border border-brand-400"
        />
      )}
      <div className="text-sm">
        <p className="font-medium text-white">{user.name}</p>
        <p className="text-xs text-gray-400">{user.email}</p>
      </div>
      <ShimmerButton
        onClick={logout}
        background="rgba(220, 38, 38, 1)"
        shimmerColor="#ffffff"
        className="dark:text-white text-xs font-semibold px-3 py-1"
      >
        Logout
      </ShimmerButton>
    </div>
  );
}
