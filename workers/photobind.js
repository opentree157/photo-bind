export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const apiOrigin = env.API_ORIGIN;
      if (!apiOrigin) {
        return new Response("API_ORIGIN is not configured", { status: 503 });
      }

      const upstream = new URL(request.url);
      const origin = new URL(apiOrigin);
      upstream.protocol = origin.protocol;
      upstream.host = origin.host;

      const headers = new Headers(request.headers);
      headers.set("X-Forwarded-Host", url.host);
      headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

      return fetch(new Request(upstream, { method: request.method, headers, body: request.body, redirect: "manual" }));
    }

    return env.ASSETS.fetch(request);
  }
};
