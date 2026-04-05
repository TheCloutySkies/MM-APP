/**
 * Serve the Expo static export from ./dist (see wrangler.toml [assets]).
 * Without this file as `main`, some Git-linked setups keep the dashboard
 * placeholder Worker ("Hello world") instead of attaching the asset bundle.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
