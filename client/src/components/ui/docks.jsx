import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

export const Component = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('ht-theme') || 'system';
  });

  useEffect(() => {
    localStorage.setItem('ht-theme', theme);
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.remove('dark');
    } else if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    }
  }, [theme]);

  // Keep system theme in sync with OS preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      if (theme === 'system') {
        document.documentElement.classList.toggle('dark', e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const activeClass = 'bg-black/20 dark:bg-white/20';

  return (
    <div
      className="
        inline-flex rounded-lg overflow-hidden relative
        bg-white/20 dark:bg-black/40
        backdrop-blur-md
        shadow-lg shadow-black/20
        border border-gray-300 dark:border-black/60
        transition-colors duration-500
      "
    >
      <button
        onClick={() => setTheme('light')}
        className={`
          px-4 py-2 rounded-l-lg
          flex items-center gap-2
          text-black dark:text-white
          hover:bg-black/10 dark:hover:bg-white/10
          transition-colors duration-300
          focus:outline-none focus:ring-0
          border-r border-gray-300 dark:border-black/60
          group
          ${theme === 'light' ? activeClass : 'bg-transparent'}
        `}
        aria-label="Toggle Light Mode"
      >
        <Sun className="w-5 h-5 text-current transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
        <span className="select-none">Light</span>
      </button>

      <button
        onClick={() => setTheme('system')}
        className={`
          px-4 py-2
          flex items-center gap-2
          text-black dark:text-white
          hover:bg-black/10 dark:hover:bg-white/10
          transition-colors duration-300
          focus:outline-none focus:ring-0
          border-r border-gray-300 dark:border-black/60
          group
          ${theme === 'system' ? activeClass : 'bg-transparent'}
        `}
        aria-label="Use System Theme"
      >
        <Monitor className="w-5 h-5 text-current transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
        <span className="select-none">System</span>
      </button>

      <button
        onClick={() => setTheme('dark')}
        className={`
          px-4 py-2 rounded-r-lg
          flex items-center gap-2
          text-black dark:text-white
          hover:bg-black/10 dark:hover:bg-white/10
          transition-colors duration-300
          focus:outline-none focus:ring-0
          group
          ${theme === 'dark' ? activeClass : 'bg-transparent'}
        `}
        aria-label="Toggle Dark Mode"
      >
        <Moon className="w-5 h-5 text-current transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
        <span className="select-none">Dark</span>
      </button>
    </div>
  );
};

export default Component;
