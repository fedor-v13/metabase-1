(ns metabase.custom-viz-plugin.sandbox-api
  "The one `/api/ee/custom-viz-plugin` route that is *not* behind auth.

   The near-membrane realm that custom visualization code runs in needs an iframe document whose CSP
   allows `'unsafe-eval'`, and that document has to be same-origin. Embed viewers (public links,
   static embeds, guest embeds) are anonymous, so serving it from behind `+auth` would 401 and the
   sandbox would never come up.

   The response is a constant HTML string with no data in it, so there is nothing to leak by serving
   it unauthenticated."
  (:require
   [metabase.api.macros :as api.macros]))

(set! *warn-on-reflection* true)

(def ^:private sandbox-host-html
  "Minimal HTML doc that the patched `@locker/near-membrane-dom` loads as the iframe document
   so plugin code can be `eval`'d under a relaxed, per-iframe CSP."
  "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>")

(def ^:private sandbox-host-csp
  "CSP applied ONLY to the sandbox iframe document.
   - `'unsafe-eval'` required by near-membrane to evaluate plugin code inside the realm.
   - `frame-ancestors 'self'` - so Metabase can embed this document."
  (str "default-src 'none'; "
       "script-src 'unsafe-eval'; "
       "frame-ancestors 'self';"))

(api.macros/defendpoint :get "/sandbox-host" :- :any
  "Serve a minimal HTML document used as the iframe `src` for the near-membrane custom-viz
   sandbox. The response carries a per-document `Content-Security-Policy` that permits
   `'unsafe-eval'` only inside this iframe, so the main Metabase document keeps its strict
   nonce-based CSP."
  []
  {:status  200
   :headers {"Content-Type"                 "text/html; charset=utf-8"
             "Content-Security-Policy"      sandbox-host-csp
             "X-Frame-Options"              "SAMEORIGIN"
             "X-Content-Type-Options"       "nosniff"
             "Cross-Origin-Resource-Policy" "same-origin"
             "Referrer-Policy"              "no-referrer"
             "Cache-Control"                "public, max-age=60"}
   :body    sandbox-host-html})

(def routes
  "Unauthenticated `/api/ee/custom-viz-plugin` routes."
  (api.macros/ns-handler *ns*))
