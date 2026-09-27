import '@testing-library/jest-dom/vitest'

// jsdom does not implement window.matchMedia. shadcn/ui's useIsMobile hook
// (src/hooks/use-mobile.ts, used by the sidebar shell) calls it on mount, so
// tests that render the sidebar need a minimal polyfill.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
