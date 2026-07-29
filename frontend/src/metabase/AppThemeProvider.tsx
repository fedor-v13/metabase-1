import { merge } from "icepick";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useUpdateSettingMutation } from "metabase/api";
import {
  isPublicEmbedding,
  isStaticEmbedding,
} from "metabase/embedding/config";
import { useEmbedColorOverrides } from "metabase/embedding/hooks/use-embed-color-overrides";
import type { EmbedColorOverrides } from "metabase/embedding/lib/color-overrides";
import type { DisplayTheme } from "metabase/embedding/types";
import { isEmbeddingSdk } from "metabase/embedding-sdk/config";
import type { MetabaseComponentTheme } from "metabase/embedding-sdk/theme";
import type { MantineThemeOverride } from "metabase/ui";
import { mutateColors } from "metabase/ui/colors/colors";
import { ThemeProvider } from "metabase/ui/components/theme/ThemeProvider";
import { parseHashOptions } from "metabase/utils/browser";
import type {
  ColorScheme,
  ResolvedColorScheme,
} from "metabase/utils/color-scheme";
import {
  getUserColorScheme,
  isValidColorScheme,
  setUserColorSchemeAfterUpdate,
} from "metabase/utils/color-scheme";
import MetabaseSettings from "metabase/utils/settings";
import type { DeepPartial } from "metabase/utils/types";
import type { ColorSettings } from "metabase-types/api";

import { AppColorSchemeProvider } from "./AppColorSchemeProvider";

interface AppThemeProviderProps {
  children: ReactNode;

  /**
   * Extend Metabase's theme overrides.
   */
  theme?: MantineThemeOverride;

  displayTheme?: DisplayTheme | string;

  initialColorScheme?: ColorScheme | undefined;
}

const getColorSchemeFromDisplayTheme = (
  displayTheme: DisplayTheme | string | boolean | string[] | undefined,
): ResolvedColorScheme | null => {
  switch (displayTheme) {
    case "light":
    case "transparent":
    case undefined:
      return "light";
    case "night":
    case "dark":
      return "dark";
  }
  return null;
};

const getColorSchemeOverride = ({ hash }: Location) => {
  return getColorSchemeFromDisplayTheme(parseHashOptions(hash).theme);
};

const useColorSchemeFromHash = ({
  enabled = true,
}: {
  enabled?: boolean;
}): ResolvedColorScheme | null => {
  const [hashScheme, setHashScheme] = useState<ResolvedColorScheme | null>(() =>
    getColorSchemeOverride(location),
  );
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onHashChange = () => setHashScheme(getColorSchemeOverride(location));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [enabled]);
  return enabled ? hashScheme : null;
};

/**
 * `dashboard-bg-color` and `card-bg-color` are component theme values rather
 * than palette colors, so unlike the other hash color parameters they travel as
 * a Mantine theme override. `ThemeProvider` deep-merges it onto the base theme,
 * and `getThemeSpecificCssVariables` turns it into `--mb-color-bg-dashboard`,
 * `--mb-color-bg-dashboard-card` and `--mb-color-bg-question`.
 */
const getComponentThemeOverride = (
  colorOverrides: EmbedColorOverrides | null,
): MantineThemeOverride | null => {
  const { dashboardBackgroundColor, cardBackgroundColor } =
    colorOverrides ?? {};

  if (dashboardBackgroundColor == null && cardBackgroundColor == null) {
    return null;
  }

  const other: DeepPartial<MetabaseComponentTheme> = {
    dashboard: {
      ...(dashboardBackgroundColor != null && {
        backgroundColor: dashboardBackgroundColor,
      }),
      ...(cardBackgroundColor != null && {
        card: { backgroundColor: cardBackgroundColor },
      }),
    },
    ...(cardBackgroundColor != null && {
      question: { backgroundColor: cardBackgroundColor },
    }),
  };

  return { other } as MantineThemeOverride;
};

export const AppThemeProvider = (props: AppThemeProviderProps) => {
  const [updateSetting] = useUpdateSettingMutation();

  const schemeFromHash = useColorSchemeFromHash({
    enabled: isStaticEmbedding() || isPublicEmbedding(),
  });
  const forceColorScheme = props.displayTheme
    ? getColorSchemeFromDisplayTheme(props.displayTheme)
    : schemeFromHash;

  const [colorSchemeFromSettings, setColorSchemeFromSettings] =
    useState<ColorScheme>(() => getUserColorScheme() ?? "auto");

  // FIXME: Not only does this use a deprecated API, it also adds a complementary
  // method to the already deprecated method to remove the listener. This is just
  // done provisionally for CI testing purposes.
  useEffect(() => {
    const updateSetting = (value: ColorScheme) => {
      if (value && isValidColorScheme(value)) {
        setColorSchemeFromSettings(value);
      }
    };

    MetabaseSettings.on("color-scheme", updateSetting);

    return () => MetabaseSettings.off("color-scheme", updateSetting);
  }, [setColorSchemeFromSettings]);

  const handleUpdateColorScheme = useCallback(
    async (value: ColorScheme) => {
      await updateSetting({
        key: "color-scheme",
        value,
      }).unwrap();

      setUserColorSchemeAfterUpdate(value);
    },
    [updateSetting],
  );

  // Whitelabel colors management
  const [whitelabelColors, setWhitelabelColors] = useState<
    ColorSettings | undefined
  >(() => MetabaseSettings.applicationColors());

  const handleUpdateWhitelabelColors = useCallback(
    (nextColors: ColorSettings) => {
      mutateColors(nextColors);
      setWhitelabelColors(nextColors);
    },
    [],
  );

  // Colors passed through the URL hash of a static or public embed. They are
  // layered on top of the appearance settings rather than stored, so that
  // `handleUpdateWhitelabelColors` keeps writing the real settings.
  const embedColorOverrides = useEmbedColorOverrides();

  const themeColors = useMemo(() => {
    if (!embedColorOverrides) {
      return whitelabelColors;
    }

    return { ...whitelabelColors, ...embedColorOverrides.colors };
  }, [whitelabelColors, embedColorOverrides]);

  const theme = useMemo((): MantineThemeOverride | undefined => {
    const componentThemeOverride =
      getComponentThemeOverride(embedColorOverrides);

    if (!componentThemeOverride) {
      return props.theme;
    }

    if (!props.theme) {
      return componentThemeOverride;
    }

    return merge(props.theme, componentThemeOverride);
  }, [props.theme, embedColorOverrides]);

  return (
    <AppColorSchemeProvider
      defaultColorScheme={colorSchemeFromSettings ?? getUserColorScheme()}
      forceColorScheme={forceColorScheme}
      onUpdateColorScheme={handleUpdateColorScheme}
    >
      <ThemeProvider
        theme={theme}
        whitelabelColors={themeColors}
        onUpdateWhitelabelColors={handleUpdateWhitelabelColors}
        cssVariablesSelector={isEmbeddingSdk() ? ".mb-wrapper" : undefined}
      >
        {props.children}
      </ThemeProvider>
    </AppColorSchemeProvider>
  );
};
