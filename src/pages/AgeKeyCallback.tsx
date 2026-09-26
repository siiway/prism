// Lands here after AgeKey redirects back. The id_token is in the URL
// fragment, so this page is the only thing that can see it. It posts the
// fragment to the API with the session cookie, then leaves for Security.

import { Spinner } from "@fluentui/react-components";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/api-context";

const RESULTS = new Set([
  "ok",
  "denied",
  "create_requested",
  "invalid",
  "downgrade",
  "unconfigured",
]);

// Survives the dev-mode remount so the fragment is posted once. A ref would
// reset and the second run would see an already-cleared hash.
let pending: Promise<unknown> | null = null;

export function AgeKeyCallback() {
  const api = useApi();
  const navigate = useNavigate();

  useEffect(() => {
    if (pending) return;
    const hash = window.location.hash.replace(/^#/, "");
    window.history.replaceState(null, "", window.location.pathname);
    const params = new URLSearchParams(hash);
    pending = api
      .completeAgeKey({
        state: params.get("state"),
        id_token: params.get("id_token"),
        error: params.get("error"),
        create_requested: params.get("create_requested"),
      })
      .then((res) => {
        const result = RESULTS.has(res.result) ? res.result : "invalid";
        navigate(`/security?agekey=${result}`, { replace: true });
      })
      .catch(() => {
        navigate("/security?agekey=invalid", { replace: true });
      })
      .finally(() => {
        pending = null;
      });
  }, [api, navigate]);

  return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <Spinner />
    </div>
  );
}
