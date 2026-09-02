import type { ReactNode } from "react";
import type { ApiClient } from "./api";
import { ApiContext } from "./api-context";

export function ApiProvider({
  client,
  origin,
  children,
}: {
  client: ApiClient;
  origin: string;
  children: ReactNode;
}) {
  return <ApiContext value={{ client, origin }}>{children}</ApiContext>;
}
