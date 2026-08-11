/**
 * Production entry point. pm2 runs THIS, never `.next/standalone/server.js`
 * directly, because two non-obvious environment facts have to hold together and
 * a pm2 flag is far too easy to lose.
 *
 * ## Why `HOSTNAME` must be `localhost` and not `127.0.0.1`
 *
 * Next builds an `initUrl` for each request from the hostname it was started
 * with. Separately, `next/dist/server/web/next-url.js` normalises *any* loopback
 * hostname — `127.0.0.1` included — to the literal string `localhost` when it
 * constructs the URL that proxy (middleware) code sees.
 *
 * Clerk's middleware sets `x-middleware-rewrite` to that URL's `href` on every
 * request it decorates. Next then relativises the rewrite against `initUrl`. If
 * the app was started with `HOSTNAME=127.0.0.1` the two origins disagree
 * (`http://127.0.0.1:3001` vs `http://localhost:3001`), so Next classifies its
 * own rewrite as *external* and proxies the request to itself. The result is a
 * 30-second hang ending in `Failed to proxy … socket hang up` on every route
 * that renders, while routes the proxy short-circuits (redirects) still answer
 * instantly — a failure that looks like a broken database and is not.
 *
 * ## Why the DNS order is forced
 *
 * With `HOSTNAME=localhost`, Node resolves the bind address, and Node 17+
 * returns records verbatim — which is `::1` first on a dual-stack host. Binding
 * IPv6-only would leave nginx's `proxy_pass http://127.0.0.1:3001` unable to
 * connect. `ipv4first` makes the bind deterministically IPv4 on every platform
 * while leaving the origin string as `localhost`, satisfying both constraints.
 *
 * The loopback bind is what keeps the app private: nginx terminates TLS and is
 * the only way in.
 */

const dns = require("node:dns");
const path = require("node:path");

dns.setDefaultResultOrder("ipv4first");

// Set rather than defaulted: an inherited `HOSTNAME` (Docker and some shells
// export the machine name) would otherwise make Next bind to a name that does
// not resolve locally.
process.env.HOSTNAME = "localhost";
process.env.PORT = process.env.PORT || "3001";
process.env.NODE_ENV = "production";

require(path.join(__dirname, "..", "server.js"));
