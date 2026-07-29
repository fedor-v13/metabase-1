import { useEffect, useState } from "react";

import { isPublicEmbedding, isStaticEmbedding } from "metabase/embedding/config";
import type { EmbedColorOverrides } from "metabase/embedding/lib/color-overrides";
import { parseEmbedColorOverrides } from "metabase/embedding/lib/color-overrides";

/**
 * Color overrides passed through the URL hash of a static or public embed.
 *
 * Only static and public embeds honor these parameters; the main app ignores
 * them so that an app URL can never be used to repaint the whole instance.
 *
 * Returns a stable object identity, as consumers use it as a memoization
 * dependency when deriving the theme.
 */
export function useEmbedColorOverrides(): EmbedColorOverrides | null {
  const enabled = isStaticEmbedding() || isPublicEmbedding();

  const [colorOverrides, setColorOverrides] =
    useState<EmbedColorOverrides | null>(() =>
      parseEmbedColorOverrides(location.hash),
    );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onHashChange = () =>
      setColorOverrides(parseEmbedColorOverrides(location.hash));

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [enabled]);

  return enabled ? colorOverrides : null;
}
