import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import { readOAuthBody } from "../src/worker/lib/oauthClients";
import {
  findRepeatedParam,
  rejectRepeatedParams,
} from "../src/worker/middleware/repeatedParams";
import type { Variables } from "../src/worker/types";
import { executionCtx } from "./setup/d1";

type AppEnv = { Bindings: Env; Variables: Variables };

const form = { "Content-Type": "application/x-www-form-urlencoded" };

describe("findRepeatedParam", () => {
  test("names the first parameter sent twice", () => {
    expect(findRepeatedParam(new URLSearchParams("scope=a&scope=b"))).toBe(
      "scope",
    );
    expect(
      findRepeatedParam(new URLSearchParams("a=1&state=x&b=2&state=x")),
    ).toBe("state");
    expect(findRepeatedParam(new URLSearchParams("scope=a+b&state=x"))).toBe(
      null,
    );
  });

  test("lets resource and audience repeat", () => {
    expect(
      findRepeatedParam(
        new URLSearchParams(
          "resource=https://a&resource=https://b&audience=x&audience=y",
        ),
      ),
    ).toBe(null);
  });
});

describe("rejectRepeatedParams", () => {
  const app = new Hono<AppEnv>();
  app.all("/echo", rejectRepeatedParams, async (c) => {
    const { params } = await readOAuthBody(c);
    return c.json(params);
  });

  test("refuses a repeated query parameter", async () => {
    const res = await app.request("/echo?scope=a&scope=b");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  test("refuses a repeated form parameter", async () => {
    const res = await app.request("/echo", {
      method: "POST",
      headers: form,
      body: "grant_type=refresh_token&scope=a&scope=b",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  test("leaves the body readable for the route", async () => {
    const res = await app.request("/echo", {
      method: "POST",
      headers: form,
      body: "grant_type=refresh_token&scope=a+b",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      grant_type: "refresh_token",
      scope: "a b",
    });
  });

  test("passes a JSON body through", async () => {
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "a" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scope: "a" });
  });
});

describe("OAuth endpoints", () => {
  const app = new Hono();
  app.route("/oauth", oauthRoutes);
  const env = {} as Env;

  test("the authorization request refuses a repeated parameter", async () => {
    const res = await app.fetch(
      new Request(
        "https://prism.example/oauth/app-info?client_id=c&redirect_uri=https://a/cb&redirect_uri=https://b/cb&response_type=code",
      ),
      env,
      executionCtx,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  test("the token endpoint refuses a repeated parameter", async () => {
    const res = await app.fetch(
      new Request("https://prism.example/oauth/token", {
        method: "POST",
        headers: form,
        body: "grant_type=authorization_code&code=x&code=y",
      }),
      env,
      executionCtx,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });
});
