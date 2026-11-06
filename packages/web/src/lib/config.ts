/** Where probes are sent and the API lives. Must be publicly reachable for anonymity-network exits. */
export const OBSERVER_ORIGIN: string = (import.meta.env.VITE_OBSERVER_ORIGIN as string | undefined)?.replace(/\/+$/, "") || location.origin;

/** Append the specifier's own https resolvers (third-party CDNs) after our self-hosted copy. Off by default (privacy: no third-party requests). */
export const BUNDLE_CDN_FALLBACK = import.meta.env.VITE_BUNDLE_FALLBACK === "1";

/**
 * "Test from my browser" runs over tor-js only, and tor-js hasn't booted (demo
 * gateway KPS HELLO timeout, see docs/spike-findings.md). Hidden until it works;
 * build with VITE_VISITOR_TEST=1 to show it.
 */
export const VISITOR_TEST_ENABLED = import.meta.env.VITE_VISITOR_TEST === "1";
