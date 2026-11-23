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
   - `frame-ancestors *` - `frame-ancestors` is matched against the *whole* ancestor chain, not just
     the immediate parent. `'self'` therefore held only while Metabase was the top-level document:
     embed a dashboard on a customer page and the chain becomes [customer page, /embed/sdk/v1], the
     customer origin fails the check, the browser blocks this document, and every `custom:*` card
     silently falls back to the default Table. `/embed/sdk/v1`, the document that frames this one,
     is already `frame-ancestors *`, so matching it widens nothing.

   Framing this document is inert on its own: the body is empty and `script-src` lists only
   `'unsafe-eval'` - no `'self'`, no `'unsafe-inline'`, no host - so nothing can ever start
   executing here. `eval` is reachable only from the same-origin Metabase document that created the
   iframe and holds a handle to its realm; a cross-origin ancestor cannot reach into it at all."
  (str "default-src 'none'; "
       "script-src 'unsafe-eval'; "
       "frame-ancestors *;"))

(api.macros/defendpoint :get "/sandbox-host" :- :any
  "Serve a minimal HTML document used as the iframe `src` for the near-membrane custom-viz
   sandbox. The response carries a per-document `Content-Security-Policy` that permits
   `'unsafe-eval'` only inside this iframe, so the main Metabase document keeps its strict
   nonce-based CSP."
  []
  {:status  200
   :headers {"Content-Type"                 "text/html; charset=utf-8"
             "Content-Security-Policy"      sandbox-host-csp
             ;; Deliberately no `X-Frame-Options`: it has no "any ancestor" value, so `SAMEORIGIN`
             ;; would keep blocking embedded viewers wherever it is still honoured over
             ;; `frame-ancestors`.
             "X-Content-Type-Options"       "nosniff"
             "Cross-Origin-Resource-Policy" "same-origin"
             "Referrer-Policy"              "no-referrer"
             "Cache-Control"                "public, max-age=60"}
   :body    sandbox-host-html})

(def routes
  "Unauthenticated `/api/ee/custom-viz-plugin` routes."
  (api.macros/ns-handler *ns*))
