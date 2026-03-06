// OAuth App detail / settings page

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
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowLeftRegular, CopyRegular, DeleteRegular, ShieldRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

const useStyles = makeStyles({
  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: '8px',
    padding: '24px',
    background: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  secretRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    background: tokens.colorNeutralBackground3,
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: tokens.fontSizeBase200,
  },
  scopeGrid: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
});

const SCOPES = ['openid', 'profile', 'email', 'apps:read', 'offline_access'];

export function AppDetail() {
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['app', id], queryFn: () => api.getApp(id!) });
  const app = data?.app;

  const [tab, setTab] = useState('settings');
  const [form, setForm] = useState<{ name: string; description: string; website_url: string; redirect_uris: string; allowed_scopes: string[]; is_public: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [secretRotating, setSecretRotating] = useState(false);
  const [newSecret, setNewSecret] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState<string>('');

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const initForm = () => {
    if (!app || form) return;
    setForm({
      name: app.name,
      description: app.description,
      website_url: app.website_url ?? '',
      redirect_uris: app.redirect_uris.join('\n'),
      allowed_scopes: app.allowed_scopes,
      is_public: app.is_public,
    });
  };

  const handleSave = async () => {
    if (!form || !id) return;
    setSaving(true);
    try {
      await api.updateApp(id, {
        name: form.name,
        description: form.description,
        website_url: form.website_url || undefined,
        redirect_uris: form.redirect_uris.split('\n').map((s) => s.trim()).filter(Boolean),
        allowed_scopes: form.allowed_scopes,
        is_public: form.is_public,
      });
      await qc.invalidateQueries({ queryKey: ['app', id] });
      showMsg('success', 'App updated');
    } catch (err) {
      showMsg('error', err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRotateSecret = async () => {
    if (!id) return;
    setSecretRotating(true);
    try {
      const res = await api.rotateSecret(id);
      setNewSecret(res.client_secret);
      showMsg('success', 'Client secret rotated — save it now!');
    } catch (err) {
      showMsg('error', err instanceof ApiError ? err.message : 'Rotation failed');
    } finally {
      setSecretRotating(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await api.deleteApp(id);
      navigate('/apps');
    } catch (err) {
      showMsg('error', err instanceof ApiError ? err.message : 'Delete failed');
    }
  };

  if (isLoading) return <Spinner />;
  if (!app) return <Text>App not found</Text>;

  if (!form) initForm();

  return (
    <div>
      <div className={styles.header}>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => navigate('/apps')} />
        <Title2>{app.name}</Title2>
        {app.is_verified && <Badge color="success" appearance="filled"><ShieldRegular /> Verified</Badge>}
        {!app.is_active && <Badge color="subtle" appearance="filled">Disabled</Badge>}
      </div>

      {message && <MessageBar intent={message.type === 'success' ? 'success' : 'error'} style={{ marginBottom: 16 }}>{message.text}</MessageBar>}

      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as string)} style={{ marginBottom: 24 }}>
        <Tab value="settings">Settings</Tab>
        <Tab value="credentials">Credentials</Tab>
        <Tab value="danger">Danger Zone</Tab>
      </TabList>

      {tab === 'settings' && form && (
        <div className={styles.card}>
          <div className={styles.form}>
            <Field label="App Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f!, name: e.target.value }))} /></Field>
            <Field label="Description"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f!, description: e.target.value }))} /></Field>
            <Field label="Website URL"><Input value={form.website_url} onChange={(e) => setForm((f) => ({ ...f!, website_url: e.target.value }))} /></Field>
            <Field label="Redirect URIs" hint="One per line">
              <Textarea value={form.redirect_uris} onChange={(e) => setForm((f) => ({ ...f!, redirect_uris: e.target.value }))} rows={4} />
            </Field>
            <Field label="Allowed Scopes">
              <div className={styles.scopeGrid}>
                {SCOPES.map((s) => (
                  <Checkbox
                    key={s}
                    label={s}
                    checked={form.allowed_scopes.includes(s)}
                    onChange={(_, d) => {
                      const scopes = d.checked
                        ? [...form.allowed_scopes, s]
                        : form.allowed_scopes.filter((x) => x !== s);
                      setForm((f) => ({ ...f!, allowed_scopes: scopes }));
                    }}
                  />
                ))}
              </div>
            </Field>
            <Checkbox
              label="Public client (no client secret, PKCE required)"
              checked={form.is_public}
              onChange={(_, d) => setForm((f) => ({ ...f!, is_public: !!d.checked }))}
            />
            <Button appearance="primary" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="tiny" /> : 'Save changes'}
            </Button>
          </div>
        </div>
      )}

      {tab === 'credentials' && (
        <div className={styles.card}>
          <Text weight="semibold" block>Client Credentials</Text>

          <Field label="Client ID">
            <div className={styles.secretRow}>
              <Text style={{ flex: 1, fontFamily: 'monospace' }}>{app.client_id}</Text>
              <Button icon={<CopyRegular />} size="small" appearance="subtle" onClick={() => copy(app.client_id, 'id')}>
                {copied === 'id' ? 'Copied!' : ''}
              </Button>
            </div>
          </Field>

          {!app.is_public && (
            <Field label="Client Secret">
              {newSecret ? (
                <div>
                  <div className={styles.secretRow}>
                    <Text style={{ flex: 1, fontFamily: 'monospace' }}>{newSecret}</Text>
                    <Button icon={<CopyRegular />} size="small" appearance="subtle" onClick={() => copy(newSecret, 'secret')}>
                      {copied === 'secret' ? 'Copied!' : ''}
                    </Button>
                  </div>
                  <MessageBar intent="warning" style={{ marginTop: 8 }}>
                    Save this secret now — it won't be shown again.
                  </MessageBar>
                </div>
              ) : (
                <Text style={{ color: tokens.colorNeutralForeground3 }}>{app.client_secret ? '••••••••••••••••' : 'No secret'}</Text>
              )}
              <Button appearance="outline" onClick={handleRotateSecret} disabled={secretRotating} style={{ marginTop: 8, width: 'fit-content' }}>
                {secretRotating ? <Spinner size="tiny" /> : 'Rotate secret'}
              </Button>
            </Field>
          )}

          <div>
            <Text weight="semibold" block style={{ marginBottom: 8 }}>OAuth Endpoints</Text>
            {[
              ['Authorization', `/api/oauth/authorize`],
              ['Token', `/api/oauth/token`],
              ['UserInfo', `/api/oauth/userinfo`],
            ].map(([label, path]) => (
              <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <Text size={200} style={{ width: 100, color: tokens.colorNeutralForeground3 }}>{label}</Text>
                <Text size={200} style={{ fontFamily: 'monospace', flex: 1 }}>{window.location.origin}{path}</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'danger' && (
        <div className={styles.card}>
          <Text weight="semibold" size={400} style={{ color: tokens.colorPaletteRedForeground1 }}>Danger Zone</Text>
          <Dialog>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="outline" icon={<DeleteRegular />} style={{ color: tokens.colorPaletteRedForeground1, width: 'fit-content' }}>
                Delete application
              </Button>
            </DialogTrigger>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Delete "{app.name}"?</DialogTitle>
                <DialogContent>
                  This will permanently delete the app and revoke all associated tokens. This action cannot be undone.
                </DialogContent>
                <DialogActions>
                  <DialogTrigger><Button>Cancel</Button></DialogTrigger>
                  <Button appearance="primary" style={{ background: tokens.colorPaletteRedBackground3 }} onClick={handleDelete}>
                    Delete permanently
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </div>
      )}
    </div>
  );
}
