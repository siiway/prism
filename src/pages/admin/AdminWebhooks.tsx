// Admin webhook management — create, configure, and monitor webhooks

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  CheckmarkCircleRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  DeleteRegular,
  DismissCircleRegular,
  EditRegular,
  LinkRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";

// ─── Event catalogue ─────────────────────────────────────────────────────────

const ALL_EVENTS = [
  { value: "*", group: "webhooks.groupWildcard" },
  { value: "admin.config.update", group: "webhooks.groupAdmin" },
  { value: "admin.user.update", group: "webhooks.groupAdmin" },
  { value: "admin.user.delete", group: "webhooks.groupAdmin" },
  { value: "admin.app.update", group: "webhooks.groupAdmin" },
  { value: "admin.team.delete", group: "webhooks.groupAdmin" },
  { value: "invite.create", group: "webhooks.groupInvites" },
  { value: "invite.revoke", group: "webhooks.groupInvites" },
  { value: "oauth_source.create", group: "webhooks.groupOAuthSources" },
  { value: "oauth_source.update", group: "webhooks.groupOAuthSources" },
  { value: "oauth_source.delete", group: "webhooks.groupOAuthSources" },
  { value: "webhook.create", group: "webhooks.groupWebhooks" },
  { value: "webhook.update", group: "webhooks.groupWebhooks" },
  { value: "webhook.delete", group: "webhooks.groupWebhooks" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Webhook {
  id: string;
  name: string;
  url: string;
  secret?: string;
  events: string; // JSON
  is_active: number;
  created_at: number;
  updated_at: number;
}

interface Delivery {
  id: string;
  event_type: string;
  response_status: number | null;
  success: number;
  delivered_at: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEvents(raw: string): string[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

// ─── Event selector ──────────────────────────────────────────────────────────

function EventSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const { t } = useTranslation();

  const groups = [...new Set(ALL_EVENTS.map((e) => e.group))];

  const toggle = (value: string) => {
    if (value === "*") {
      onChange(selected.includes("*") ? [] : ["*"]);
      return;
    }
    const next = selected.filter((v) => v !== "*");
    onChange(
      next.includes(value) ? next.filter((v) => v !== value) : [...next, value],
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {groups.map((group) => (
        <div key={group}>
          <Text
            size={200}
            weight="semibold"
            style={{
              color: tokens.colorNeutralForeground3,
              display: "block",
              marginBottom: 4,
            }}
          >
            {t(group)}
          </Text>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingLeft: 4,
            }}
          >
            {ALL_EVENTS.filter((e) => e.group === group).map((ev) => (
              <Checkbox
                key={ev.value}
                id={`admin-webhook-${group}-${ev.value}`}
                label={ev.value}
                checked={selected.includes(ev.value)}
                onChange={() => toggle(ev.value)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Create / Edit dialog ────────────────────────────────────────────────────

function WebhookDialog({
  existing,
  onClose,
}: {
  existing?: Webhook;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [secret, setSecret] = useState(existing?.secret ?? "");
  const [events, setEvents] = useState<string[]>(
    existing ? parseEvents(existing.events) : [],
  );
  const [isActive, setIsActive] = useState(
    existing ? !!existing.is_active : true,
  );
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (): Promise<unknown> =>
      existing
        ? api.updateWebhook(existing.id, {
            name,
            url,
            secret: secret || undefined,
            events,
            is_active: isActive,
          })
        : api.createWebhook({ name, url, secret: secret || undefined, events }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-webhooks"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <DialogSurface>
      <DialogBody>
        <DialogTitle>
          {existing ? t("webhooks.editTitle") : t("webhooks.createTitle")}
        </DialogTitle>
        <DialogContent>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              paddingTop: 8,
            }}
          >
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={t("webhooks.name")} required>
              <Input
                value={name}
                onChange={(_, d) => setName(d.value)}
                placeholder={t("webhooks.namePlaceholder")}
              />
            </Field>
            <Field label={t("webhooks.url")} required>
              <Input
                value={url}
                onChange={(_, d) => setUrl(d.value)}
                placeholder="https://example.com/hooks"
                contentBefore={<LinkRegular />}
              />
            </Field>
            <Field label={t("webhooks.secret")} hint={t("webhooks.secretHint")}>
              <Input
                value={secret}
                onChange={(_, d) => setSecret(d.value)}
                placeholder={t("webhooks.secretPlaceholder")}
                type="password"
              />
            </Field>
            <Field label={t("webhooks.events")}>
              <EventSelector selected={events} onChange={setEvents} />
            </Field>
            {existing && (
              <Switch
                label={t("common.enabled")}
                checked={isActive}
                onChange={(_, d) => setIsActive(d.checked)}
              />
            )}
          </div>
        </DialogContent>
        <DialogActions>
          <DialogTrigger disableButtonEnhancement>
            <Button appearance="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </DialogTrigger>
          <Button
            appearance="primary"
            onClick={() => save.mutate()}
            disabled={!name.trim() || !url.trim() || save.isPending}
            icon={save.isPending ? <Spinner size="tiny" /> : undefined}
          >
            {existing ? t("common.saveChanges") : t("common.create")}
          </Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  );
}

// ─── Delivery history row ────────────────────────────────────────────────────

function DeliveryRow({ d }: { d: Delivery }) {
  return (
    <TableRow>
      <TableCell>
        {d.success ? (
          <CheckmarkCircleRegular
            style={{
              color: tokens.colorPaletteGreenForeground1,
              verticalAlign: "middle",
            }}
          />
        ) : (
          <DismissCircleRegular
            style={{
              color: tokens.colorPaletteRedForeground1,
              verticalAlign: "middle",
            }}
          />
        )}{" "}
        <Badge
          appearance="outline"
          color={d.success ? "success" : "danger"}
          size="small"
        >
          {d.response_status ?? "—"}
        </Badge>
      </TableCell>
      <TableCell>
        <Text size={200} font="monospace">
          {d.event_type}
        </Text>
      </TableCell>
      <TableCell>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {fmtDate(d.delivered_at)}
        </Text>
      </TableCell>
    </TableRow>
  );
}

// ─── Webhook row ─────────────────────────────────────────────────────────────

function WebhookRow({ wh }: { wh: Webhook }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    status: number | null;
  } | null>(null);

  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", wh.id],
    queryFn: () => api.listWebhookDeliveries(wh.id),
    enabled: expanded,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteWebhook(wh.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-webhooks"] }),
  });

  const test = useMutation({
    mutationFn: () => api.testWebhook(wh.id),
    onSuccess: (d) => {
      setTestResult({ success: d.success, status: d.status });
      qc.invalidateQueries({ queryKey: ["webhook-deliveries", wh.id] });
    },
  });

  const events = parseEvents(wh.events);

  return (
    <>
      <TableRow>
        <TableCell>
          <Button
            appearance="transparent"
            size="small"
            icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
            onClick={() => setExpanded((v) => !v)}
          />
          <Text weight="semibold">{wh.name}</Text>
          {!wh.is_active && (
            <Badge
              appearance="tint"
              color="warning"
              size="small"
              style={{ marginLeft: 8 }}
            >
              {t("webhooks.disabled")}
            </Badge>
          )}
        </TableCell>
        <TableCell>
          <Text
            size={200}
            font="monospace"
            style={{ color: tokens.colorNeutralForeground3 }}
          >
            {wh.url}
          </Text>
        </TableCell>
        <TableCell>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {events.map((e) => (
              <Badge key={e} appearance="outline" size="small">
                {e}
              </Badge>
            ))}
          </div>
        </TableCell>
        <TableCell>
          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
            {testResult && (
              <Tooltip
                content={`HTTP ${testResult.status ?? "err"}`}
                relationship="label"
              >
                {testResult.success ? (
                  <CheckmarkCircleRegular
                    style={{
                      color: tokens.colorPaletteGreenForeground1,
                      fontSize: 16,
                      alignSelf: "center",
                    }}
                  />
                ) : (
                  <DismissCircleRegular
                    style={{
                      color: tokens.colorPaletteRedForeground1,
                      fontSize: 16,
                      alignSelf: "center",
                    }}
                  />
                )}
              </Tooltip>
            )}
            <Button
              appearance="subtle"
              size="small"
              icon={
                test.isPending ? (
                  <Spinner size="tiny" />
                ) : (
                  <ArrowClockwiseRegular />
                )
              }
              onClick={() => test.mutate()}
              disabled={test.isPending}
              title={t("webhooks.sendTest")}
            />
            <Button
              appearance="subtle"
              size="small"
              icon={<EditRegular />}
              onClick={() => setEditing(true)}
              title={t("webhooks.edit")}
            />
            <Button
              appearance="subtle"
              size="small"
              icon={<DeleteRegular />}
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              title={t("common.delete")}
            />
          </div>
          {editing && (
            <Dialog
              open
              onOpenChange={(_, d) => {
                if (!d.open) setEditing(false);
              }}
            >
              <WebhookDialog existing={wh} onClose={() => setEditing(false)} />
            </Dialog>
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell
            colSpan={4}
            style={{
              background: tokens.colorNeutralBackground2,
              padding: "8px 16px",
            }}
          >
            <Text
              size={200}
              weight="semibold"
              style={{ display: "block", marginBottom: 8 }}
            >
              {t("webhooks.recentDeliveries")}
            </Text>
            {deliveries.isLoading ? (
              <Spinner size="tiny" />
            ) : deliveries.data?.deliveries.length ? (
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>
                      {t("webhooks.deliveryStatus")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                      {t("webhooks.deliveryEvent")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                      {t("webhooks.deliveryTime")}
                    </TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(deliveries.data.deliveries as Delivery[]).map((d) => (
                    <DeliveryRow key={d.id} d={d} />
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("webhooks.noDeliveries")}
              </Text>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function AdminWebhooks() {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-webhooks"],
    queryFn: () => api.listWebhooks(),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <Text size={500} weight="semibold" block>
            {t("webhooks.title")}
          </Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("webhooks.subtitle")}
          </Text>
        </div>
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => setCreating(true)}
        >
          {t("webhooks.createBtn")}
        </Button>
      </div>

      {creating && (
        <Dialog
          open
          onOpenChange={(_, d) => {
            if (!d.open) setCreating(false);
          }}
        >
          <WebhookDialog onClose={() => setCreating(false)} />
        </Dialog>
      )}

      {isLoading ? (
        <Spinner size="small" />
      ) : !data?.webhooks.length ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            borderRadius: tokens.borderRadiusMedium,
            border: `1px dashed ${tokens.colorNeutralStroke1}`,
          }}
        >
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {t("webhooks.empty")}
          </Text>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell style={{ width: 240 }}>
                {t("webhooks.colName")}
              </TableHeaderCell>
              <TableHeaderCell>{t("webhooks.colUrl")}</TableHeaderCell>
              <TableHeaderCell>{t("webhooks.colEvents")}</TableHeaderCell>
              <TableHeaderCell style={{ width: 140 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.webhooks as Webhook[]).map((wh) => (
              <WebhookRow key={wh.id} wh={wh} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
