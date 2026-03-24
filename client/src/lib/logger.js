const debugFlag = String(import.meta.env.VITE_ENABLE_DEBUG_LOGS || '').toLowerCase();

const isDebugEnabled = import.meta.env.DEV || debugFlag === '1' || debugFlag === 'true';

export function debugLog(...args) {
  if (isDebugEnabled) {
    console.log(...args);
  }
}

export function warnLog(...args) {
  console.warn(...args);
}

export function errorLog(...args) {
  console.error(...args);
}
