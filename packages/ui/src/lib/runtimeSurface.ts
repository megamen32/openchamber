export type HostedSurface = 'desktop' | 'mobile';

declare global {
  interface Window {
    __OPENCHAMBER_SURFACE__?: HostedSurface;
  }
}

export const isMobileSurfaceRuntime = (): boolean => (
  typeof window !== 'undefined' && window.__OPENCHAMBER_SURFACE__ === 'mobile'
);
