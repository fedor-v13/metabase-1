import { useEffect } from "react";

import { isEmbeddingSdk } from "metabase/embedding-sdk/config";

/**
 * Injects a user-provided CSS string into the document `<head>` as a `<style>` tag.
 *
 * This enables static embed users to apply arbitrary CSS (e.g. box-shadow,
 * backdrop-filter, linear-gradient backgrounds) via the `customCss` URL hash
 * parameter, without using the Embedding SDK.
 *
 * The style element is identified by `data-metabase-custom-embed-css` so it can
 * be inspected or removed in developer tools.
 *
 * @param css - Raw CSS string to inject. Pass `null` or `undefined` to skip.
 */
export function useEmbedCustomCss(css: string | null | undefined) {
  useEffect(() => {
    // We don't want to modify user application DOM when using the SDK,
    // since the SDK has its own theming system (defineMetabaseTheme).
    if (isEmbeddingSdk() || !css) {
      return;
    }

    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-metabase-custom-embed-css", "");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    return () => {
      styleEl.remove();
    };
  }, [css]);
}