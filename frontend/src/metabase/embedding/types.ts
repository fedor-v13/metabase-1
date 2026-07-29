import type { CodeLanguage } from "metabase/common/components/CodeEditor";
import type {
  Card,
  Dashboard,
  EmbedResourceDownloadOptions,
  EmbeddingParameters,
  ParameterValueOrArray,
} from "metabase-types/api";

export type DisplayTheme = "light" | "night" | "transparent";

export type EmbedResource = (Card | Dashboard) & {
  embedding_params?: EmbeddingParameters | null;
};

export type EmbedResourceType = "dashboard" | "question" | "document";
export type GuestEmbedResourceType = "dashboard" | "question";

export type EmbedResourceParameter = {
  id: string;
  name: string;
  slug: string;
  type: string;
  required?: boolean;
  default?: ParameterValueOrArray | null;
};

export type EmbeddingParametersValues = Record<
  string,
  number | string | string[] | null | undefined
>;

/**
 * This is a type for all the display options in static embedding sharing modal's Look and Feel tab.
 */
export type EmbeddingDisplayOptions = {
  font: null | string;
  theme: DisplayTheme;
  background: boolean;
  bordered: boolean;
  titled: boolean;
  downloads: EmbedResourceDownloadOptions | null;
};

/**
 * This is a type that doesn't belong to static embedding sharing modal.
 * Properties here exists only in the document (just `hide_parameters` since `locale` is a new one),
 * but not in the UI.
 */
export type EmbeddingAdditionalHashOptions = {
  hide_parameters?: string | null;
  locale?: string;
};

/**
 * Color overrides accepted in the URL hash of a static or public embed, e.g.
 * `#primary-color=%23FF5733&card-bg-color=%23FAFAFA`.
 *
 * Each is accepted in both its hyphenated and underscored spelling. Values are
 * hex colors; `#000` and `#000000` mean "transparent". See
 * `metabase/embedding/lib/color-overrides` for how they map onto theme colors.
 */
export type EmbeddingColorOverrideHashOptions = {
  "primary-color"?: string;
  primary_color?: string;
  "secondary-color"?: string;
  secondary_color?: string;
  "background-color"?: string;
  background_color?: string;
  "text-primary-color"?: string;
  text_primary_color?: string;
  "text-secondary-color"?: string;
  text_secondary_color?: string;
  "border-color"?: string;
  border_color?: string;
  "dashboard-bg-color"?: string;
  dashboard_bg_color?: string;
  "card-bg-color"?: string;
  card_bg_color?: string;
};

export type EmbeddingHashOptions = {
  downloads: string | boolean | null;
} & Omit<EmbeddingDisplayOptions, "downloads"> &
  EmbeddingAdditionalHashOptions &
  EmbeddingColorOverrideHashOptions;

export type CodeSampleParameters = {
  siteUrl: string;
  secretKey: string;
  resourceType: EmbedResourceType;
  resourceId: EmbedResource["id"];
  params: EmbeddingParametersValues;
  displayOptions?: EmbeddingDisplayOptions;
  withIframeSnippet: boolean;
};

export type ClientCodeSampleConfig = {
  id: string;
  name: string;
  source: string;
  language: CodeLanguage;
};

export type ServerCodeSampleConfig = {
  id: string;
  name: string;
  source: string;
  parametersSource: string;
  getIframeQuerySource: string;
  embedOption?: string;
  language: CodeLanguage;
};

export type CodeSampleOption = ClientCodeSampleConfig | ServerCodeSampleConfig;
