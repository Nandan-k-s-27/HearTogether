import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Toast notification component.
 * Usage: const toast = useToast(); toast.error("Something went wrong");
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info', duration = 4000) => {
    const id = Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  };

  const error = (message, duration) => addToast(message, 'error', duration);
  const success = (message, duration) => addToast(message, 'success', duration);
  const info = (message, duration) => addToast(message, 'info', duration);
  const warning = (message, duration) => addToast(message, 'warning', duration);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, addToast, error, success, info, warning, removeToast };
}

/**
 * Toast display container — renders all active toasts.
 * Place this in your layout once, then use useToast() hook anywhere.
 */
export function ToastContainer({ toasts, onRemove }) {
  return createPortal(
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onRemove={() => onRemove(toast.id)}
        />
      ))}
    </div>,
    document.body
  );
}

function Toast({ toast, onRemove }) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onRemove, 200); // Wait for fade-out
    }, 3500);
    return () => clearTimeout(timer);
  }, [onRemove]);

  const typeConfig = {
    error: {
      bg: 'bg-red-900/90',
      border: 'border-red-700',
      icon: '⚠️',
      text: 'text-red-100',
    },
    success: {
      bg: 'bg-green-900/90',
      border: 'border-green-700',
      icon: '✓',
      text: 'text-green-100',
    },
    warning: {
      bg: 'bg-yellow-900/90',
      border: 'border-yellow-700',
      icon: '⚡',
      text: 'text-yellow-100',
    },
    info: {
      bg: 'bg-blue-900/90',
      border: 'border-blue-700',
      icon: 'ℹ️',
      text: 'text-blue-100',
    },
  };

  const config = typeConfig[toast.type] || typeConfig.info;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 backdrop-blur-sm transition-all duration-200 ${
        config.bg
      } ${config.border} ${config.text} ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
      }`}
      role="alert"
    >
      <span className="mt-0.5 flex-shrink-0 text-lg">{config.icon}</span>
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={onRemove}
        className="flex-shrink-0 text-lg leading-none opacity-60 hover:opacity-100 transition"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
