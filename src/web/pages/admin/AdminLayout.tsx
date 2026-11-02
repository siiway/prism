// Admin section layout. Navigation lives in the app sidebar, which swaps to
// the admin list (adminNav.ts) while inside /admin; this layout only titles
// the page from the matching entry.

import { makeStyles } from "@fluentui/react-components";
import { useLocation, Outlet } from "react-router-dom";
import { useEffect } from "react";
import { PageHeader } from "../../components/PageHeader";
import { useAdminViewStore } from "../../store/adminView";
import { useAdminNav } from "./adminNav";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
  },
});

export function AdminLayout() {
  const styles = useStyles();
  const { pathname } = useLocation();
  const setNormalView = useAdminViewStore((state) => state.setNormalView);
  const groups = useAdminNav();

  // Resources opened from the admin panel must use the site's authority. The
  // ordinary team/app routes default to the administrator's own membership.
  useEffect(() => setNormalView(false), [setNormalView]);

  // Only section roots get the shared header; detail pages such as
  // /admin/users/:id render their own (with a back button).
  const path = pathname.replace(/\/+$/, "") || "/";
  const current = groups
    .flatMap((g) => g.items)
    .find((item) => item.to === path);

  return (
    <div className={styles.root}>
      {current && (
        <PageHeader title={current.label} subtitle={current.description} />
      )}
      <Outlet />
    </div>
  );
}
