/** A page of the documentation site, in the UI's language where it has one
 *  (Chinese; English otherwise). `page` is its path, e.g. "saml". */
export function docsUrl(language: string, page: string): string {
  return language.startsWith("zh")
    ? `https://prism.wss.moe/zh/${page}`
    : `https://prism.wss.moe/${page}`;
}
