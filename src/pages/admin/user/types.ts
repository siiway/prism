import type { AdminUserDetail } from "../../../lib/api";
import type { ConfirmOptions } from "../../../lib/useConfirm";

export type ShowMsg = (type: "success" | "error", text: string) => void;

export interface UserTabProps {
  userId: string;
  user: AdminUserDetail["user"];
  /** Personal apps, from the detail response. */
  apps: AdminUserDetail["apps"];
  /** The admin looking at their own account. */
  isSelf: boolean;
  showMsg: ShowMsg;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}
