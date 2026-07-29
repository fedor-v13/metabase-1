import { useEffect, useMemo, useState } from "react";

import { useSetting } from "metabase/common/hooks";
import { isPublicEmbedding, isStaticEmbedding } from "metabase/embedding/config";
import type { EmbedColorOverrides } from "metabase/embedding/lib/color-overrides";
import { parseEmbedColorOverrides } from "metabase/embedding/lib/color-overrides";
import {
  findSavedTheme,
  savedThemeToPaletteOverrides,
} from "metabase/embedding/lib/saved-themes";
import { parseHashOptions } from "metabase/utils/browser";

/**
 * Colors applied to a static or public embed from its URL hash, layered:
 *
 *   instance whitelabel colors
 *     < saved theme picked by `#theme=<slug>`
 *       < individual `#primary-color=...` parameters
 *
 * Only static and public embeds honor these; the main app ignores them so that
 * an app URL can never be used to repaint the whole instance.
 *
 * Saved themes arrive in the public `embedding-themes` setting, which is part of
 * the bootstrap payload, so the theme is known on the very first render and the
 * embed never flashes default colors.
 *
 * Returns a stable object identity, as consumers use it as a memoization
 * dependency when deriving the theme.
 */
export function useEmbedColorOverrides(): EmbedColorOverrides | null {
  const enabled = isStaticEmbedding() || isPublicEmbedding();
  const savedThemes = useSetting("embedding-themes");

  const [hash, setHash] = useState(() => location.hash);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onHashChange = () => setHash(location.hash);

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [enabled]);

  return useMemo(() => {
    if (!enabled) {
      return null;
    }

    const { theme } = parseHashOptions(hash);
    const themeColors = savedThemeToPaletteOverrides(
      findSavedTheme(savedThemes, theme)?.settings,
    );
    const hashOverrides = parseEmbedColorOverrides(hash);

    const colors = { ...themeColors, ...hashOverrides?.colors };

    if (Object.keys(colors).length === 0 && !hashOverrides) {
      return null;
    }

    return { ...hashOverrides, colors };
  }, [enabled, hash, savedThemes]);
}
