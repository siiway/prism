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

  locales: {
    root: {
      label: "English",
      lang: "en",
      themeConfig: {
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
              { text: "Production Demo", link: "https://prism.siiway.org" },
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

        editLink: {
          pattern: "https://github.com/siiway/prism/edit/main/docs/:path",
          text: "Edit this page on GitHub",
        },
      },
    },

    zh: {
      label: "中文",
      lang: "zh-CN",
      themeConfig: {
        nav: [
          {
            text: "指南",
            link: "/zh/getting-started",
            activeMatch:
              "^/zh/(getting-started|configuration|architecture|admin|social-login)",
          },
          { text: "API", link: "/zh/api", activeMatch: "^/zh/api" },
          {
            text: "OAuth / OIDC",
            link: "/zh/oauth",
            activeMatch: "^/zh/oauth",
          },
          {
            text: "链接",
            items: [
              { text: "GitHub", link: "https://github.com/siiway/prism" },
              {
                text: "更新日志",
                link: "https://github.com/siiway/prism/releases",
              },
              { text: "线上演示", link: "https://prism.siiway.org" },
            ],
          },
        ],

        sidebar: [
          {
            text: "指南",
            items: [
              { text: "快速开始", link: "/zh/getting-started" },
              { text: "配置", link: "/zh/configuration" },
              { text: "社交登录配置", link: "/zh/social-login" },
              { text: "架构", link: "/zh/architecture" },
              { text: "管理员指南", link: "/zh/admin" },
            ],
          },
          {
            text: "参考",
            items: [
              { text: "API 参考", link: "/zh/api" },
              { text: "OAuth / OIDC 指南", link: "/zh/oauth" },
            ],
          },
        ],

        editLink: {
          pattern: "https://github.com/siiway/prism/edit/main/docs/:path",
          text: "在 GitHub 上编辑此页",
        },

        lastUpdatedText: "最后更新",

        docFooter: {
          prev: "上一页",
          next: "下一页",
        },

        outline: {
          label: "目录",
        },

        returnToTopLabel: "返回顶部",

        sidebarMenuLabel: "菜单",

        darkModeSwitchLabel: "外观",
      },
    },
  },

  themeConfig: {
    logo: {
      light: "https://icons.siiway.org/prism/icon.svg",
      dark: "https://icons.siiway.org/prism/icon.svg",
      alt: "Prism",
    },
    siteTitle: "Prism",

    socialLinks: [{ icon: "github", link: "https://github.com/siiway/prism" }],

    footer: {
      message: "Released under the GPL-3.0 License.",
      copyright: "Copyright © 2026 SiiWay & project contributors",
    },

    search: {
      provider: "local",
    },
  },
});
