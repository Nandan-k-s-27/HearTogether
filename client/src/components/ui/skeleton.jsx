/**
 * Skeletal loading pulse animations for async operations.
 */

export function SkeletonLoader({ count = 1, className = '' }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-8 mb-2 rounded-lg bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 animate-pulse"
        />
      ))}
    </div>
  );
}

export function SkeletonButton() {
  return (
    <div className="h-10 rounded-lg bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 animate-pulse" />
  );
}

export function SkeletonBadge() {
  return (
    <div className="h-6 w-16 rounded-full bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 animate-pulse" />
  );
}

export function SkeletonBox({ width = 'w-full', height = 'h-12' }) {
  return (
    <div className={`${width} ${height} rounded-lg bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 animate-pulse`} />
  );
}
