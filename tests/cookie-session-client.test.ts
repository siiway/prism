import { describe, expect, test } from "bun:test";
import { createApiClient, type UserProfile } from "../src/lib/api";
import { createAuthStore } from "../src/store/auth";

const user = {
  id: "user-1",
  email: "user@example.com",
  username: "user",
  display_name: "User",
  avatar_url: null,
  unproxied_avatar_url: null,
  role: "user",
  email_verified: true,
} as UserProfile;

describe("cookie-only browser sessions", () => {
  test("auth state contains no session credential or account token list", () => {
    const store = createAuthStore({ initialAuth: { user } });

    expect(Object.keys(store.getState()).sort()).toEqual([
      "clearAuth",
      "isLoading",
      "setAuth",
      "setLoading",
      "user",
    ]);
    expect(store.getState()).not.toHaveProperty("token");
    expect(store.getState()).not.toHaveProperty("accounts");
  });

  test("the default API client authenticates login follow-ups by cookie", async () => {
    let request: RequestInit | undefined;
    const client = createApiClient({
      fetcher: async (_input, init) => {
        request = init;
        return Response.json({ user });
      },
    });

    const response = await client.login({
      identifier: "user",
      password: "password",
    });

    expect(response).toEqual({ user });
    expect(response).not.toHaveProperty("token");
    expect(request?.credentials).toBe("include");
    expect(new Headers(request?.headers).has("Authorization")).toBeFalse();
  });
});
