import { type PropsWithChildren, createContext, useContext } from "react";

import type { EntityToken, EntityUuid } from "metabase-types/api/entity";

/**
 * The shared entity a public link / static embed / guest embed is rendering,
 * addressed the way its API routes address it: by `uuid` (public) or `token`
 * (signed). `entityType` says which family of routes to build — `null` for
 * contexts that have no entity-scoped routes of their own (public documents).
 */
export type EmbeddingEntityType = "card" | "dashboard";

type EmbeddingEntityContextType = {
  uuid: EntityUuid | null;
  token: EntityToken | null;
  entityType: EmbeddingEntityType | null;
};

export const EmbeddingEntityContext = createContext<EmbeddingEntityContextType>(
  undefined as unknown as EmbeddingEntityContextType,
);

export const EmbeddingEntityContextProvider = ({
  children,
  uuid,
  token,
  entityType,
}: PropsWithChildren<EmbeddingEntityContextType>) => (
  <EmbeddingEntityContext.Provider value={{ uuid, token, entityType }}>
    {children}
  </EmbeddingEntityContext.Provider>
);

export const useEmbeddingEntityContext = (): EmbeddingEntityContextType => {
  return (
    useContext(EmbeddingEntityContext) ?? {
      uuid: null,
      token: null,
      entityType: null,
    }
  );
};
