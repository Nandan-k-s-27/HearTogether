export const BACKEND_URL = (() => {
  const url = import.meta.env.VITE_BACKEND_URL;

  if (!url && typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }

  return url || 'https://heartogether.onrender.com';
})();
