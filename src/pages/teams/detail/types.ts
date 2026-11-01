import type { Team } from "../../../lib/api";

/** What every team tab gets from the page. */
export interface TeamTabProps {
  team: Team;
  myRole: string;
  /** Owner, co-owner or admin. */
  canManage: boolean;
  isOwner: boolean;
  isCoOwnerOrAbove: boolean;
  showMsg: (type: "success" | "error", text: string) => void;
}
