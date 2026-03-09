import { ThemeToggle } from './theme-toggle';

// Exported as Component so existing `import { Component as DockBar }` imports
// in LandingPage continue to work without any changes there.
export const Component = () => <ThemeToggle />;
export default Component;

