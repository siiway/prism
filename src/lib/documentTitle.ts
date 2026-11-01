// Browser tab title: "<page> · <site>", or just the site name.
//
// Two writers own the parts: ThemeProvider sets the site name once the site
// config loads, and PageHeader sets the page title. Keeping both here means
// whichever runs last can't drop the other's part. (A parent's effects run
// after its children's, so ThemeProvider setting document.title directly
// would overwrite the page title on every config load.)

let siteName = "Prism";
let pageTitle: string | null = null;

function apply() {
  if (typeof document === "undefined") return;
  document.title = pageTitle ? `${pageTitle} · ${siteName}` : siteName;
}

export function setDocumentSiteName(name: string) {
  siteName = name;
  apply();
}

/** Set the page part; pass null to clear it (e.g. on unmount). */
export function setDocumentPageTitle(title: string | null) {
  pageTitle = title;
  apply();
}
