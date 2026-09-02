import { createContext, useContext } from "react";
import { api as browserApi, type ApiClient } from "./api";

export interface ApiRuntime {
  client: ApiClient;
  origin: string;
}

export const ApiContext = createContext<ApiRuntime>({
  client: browserApi,
  origin: typeof window === "undefined" ? "" : window.location.origin,
});

/** Return the API client bound to the current browser or SSR request. */
export function useApi(): ApiClient {
  return useContext(ApiContext).client;
}

/** Return the public origin bound to the current browser or SSR request. */
export function useAppOrigin(): string {
  return useContext(ApiContext).origin;
}
