/** Where probes are sent and the API lives. Must be publicly reachable for anonymity-network exits. */
export const OBSERVER_ORIGIN: string = (import.meta.env.VITE_OBSERVER_ORIGIN as string | undefined)?.replace(/\/+$/, "") || location.origin;

/** Append the specifier's own https resolvers (third-party CDNs) after our self-hosted copy. Off by default (CROPS). */
export const BUNDLE_CDN_FALLBACK = import.meta.env.VITE_BUNDLE_FALLBACK === "1";
