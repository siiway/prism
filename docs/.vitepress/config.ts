import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Prism",
  description:
    "Self-hosted OAuth 2.0 / OpenID Connect identity platform on Cloudflare Workers.",
  cleanUrls: true,
  ignoreDeadLinks: true,

  head: [
    ["meta", { name: "theme-color", content: "#0078d4" }],
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "https://icons.siiway.org/prism/icon.svg",
      },
    ],
  ],

  themeConfig: {
    logo: {
      light: "https://icons.siiway.org/prism/icon.svg",
      dark: "https://icons.siiway.org/prism/icon.svg",
      alt: "Prism",
    },
    siteTitle: "Prism",

    nav: [
      {
        text: "Guide",
        link: "/getting-started",
        activeMatch:
          "^/(getting-started|configuration|architecture|admin|social-login)",
      },
      { text: "API", link: "/api", activeMatch: "^/api" },
      { text: "OAuth / OIDC", link: "/oauth", activeMatch: "^/oauth" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/siiway/prism" },
          {
            text: "Changelog",
            link: "https://github.com/siiway/prism/releases",
          },
        ],
      },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/getting-started" },
          { text: "Configuration", link: "/configuration" },
          { text: "Social Login Setup", link: "/social-login" },
          { text: "Architecture", link: "/architecture" },
          { text: "Admin Guide", link: "/admin" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "API Reference", link: "/api" },
          { text: "OAuth / OIDC Guide", link: "/oauth" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/siiway/prism" }],

    editLink: {
      pattern: "https://github.com/siiway/prism/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the GPL-3.0 License.",
      copyright: "Copyright © 2026 SiiWay & project contributors",
    },

    search: {
      provider: "local",
    },
  },
});
