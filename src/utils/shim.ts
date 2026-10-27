/**
 * Polyfill & environment guard to prevent browser extension interceptor errors
 * such as: "TypeError: Cannot set property fetch of #<Window> which has only a getter"
 */
if (typeof window !== 'undefined') {
  try {
    const origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : window.fetch;
    let activeFetch = origFetch;

    const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (!descriptor || !descriptor.set) {
      try {
        Object.defineProperty(window, 'fetch', {
          configurable: true,
          enumerable: true,
          get() {
            return activeFetch;
          },
          set(fn) {
            activeFetch = typeof fn === 'function' ? fn : activeFetch;
          }
        });
      } catch {
        try {
          Object.defineProperty(window, 'fetch', {
            value: origFetch,
            writable: true,
            configurable: true,
            enumerable: true
          });
        } catch {
          // Fallback ignore if window is frozen
        }
      }
    }
  } catch {
    // Silent guard
  }
}

export {};
