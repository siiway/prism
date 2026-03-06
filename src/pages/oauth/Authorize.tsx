// OAuth 2.0 Authorization / Consent screen

import {
  Avatar,
  Badge,
  Button,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkRegular, DismissRegular, GlobeRegular, ShieldRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

const useStyles = makeStyles({
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: tokens.colorNeutralBackground1,
  },
  card: {
    width: '440px',
    padding: '40px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  appRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    background: tokens.colorNeutralBackground3,
    borderRadius: '8px',
  },
  scopeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  scopeItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase300,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  divider: {
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    margin: '0 -40px',
  },
});

const SCOPE_LABELS: Record<string, { label: string; desc: string }> = {
  openid: { label: 'Identity', desc: 'Know who you are' },
  profile: { label: 'Profile', desc: 'Access your name and profile picture' },
  email: { label: 'Email', desc: 'Access your email address' },
  'apps:read': { label: 'Applications', desc: 'View your registered applications' },
  offline_access: { label: 'Offline access', desc: 'Access your data when you\'re not online' },
};

export function Authorize() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, token } = useAuthStore();

  const params = Object.fromEntries(searchParams.entries());

  const { data, isLoading, error } = useQuery({
    queryKey: ['oauth-authorize', params.client_id, params.redirect_uri],
    queryFn: () => api.oauthAuthorizeInfo(params),
    retry: false,
  });

  const [loading, setLoading] = useState(false);

  // If not logged in, redirect to login
  if (!user || !token) {
    const loginUrl = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    navigate(loginUrl, { replace: true });
    return null;
  }

  const handleDecision = async (action: 'approve' | 'deny') => {
    if (!data) return;
    setLoading(true);
    try {
      const res = await api.oauthApprove({
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        scope: data.scopes.join(' '),
        state: params.state,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        nonce: params.nonce,
        action,
      });
      window.location.href = res.redirect;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Authorization failed';
      const url = new URL(params.redirect_uri);
      url.searchParams.set('error', 'server_error');
      url.searchParams.set('error_description', msg);
      if (params.state) url.searchParams.set('state', params.state);
      window.location.href = url.toString();
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Title2>Authorization Error</Title2>
          <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
            {error instanceof ApiError ? error.message : 'Invalid authorization request'}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Title2>Authorization Request</Title2>

        {/* App info */}
        <div className={styles.appRow}>
          {data.app.icon_url ? (
            <Avatar image={{ src: data.app.icon_url }} name={data.app.name} size={48} />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: 8, background: tokens.colorBrandBackground, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GlobeRegular fontSize={24} style={{ color: tokens.colorNeutralForegroundOnBrand }} />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text weight="semibold" size={400}>{data.app.name}</Text>
              {data.app.is_verified && (
                <Badge color="success" appearance="filled" size="small" icon={<ShieldRegular />}>Verified</Badge>
              )}
            </div>
            {data.app.website_url && (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{data.app.website_url}</Text>
            )}
          </div>
        </div>

        {/* Logged in as */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Signing in as</Text>
          <Avatar name={user.display_name} image={user.avatar_url ? { src: user.avatar_url } : undefined} size={20} />
          <Text size={200} weight="semibold">@{user.username}</Text>
        </div>

        <div className={styles.divider} />

        {/* Requested scopes */}
        <div>
          <Text weight="semibold" block style={{ marginBottom: 12 }}>
            {data.app.name} is requesting access to:
          </Text>
          <div className={styles.scopeList}>
            {data.scopes.map((scope) => {
              const info = SCOPE_LABELS[scope];
              return (
                <div key={scope} className={styles.scopeItem}>
                  <CheckmarkRegular style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
                  <div>
                    <Text weight="semibold" block size={300}>{info?.label ?? scope}</Text>
                    {info?.desc && <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{info.desc}</Text>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {data.app.description && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
            "{data.app.description}"
          </Text>
        )}

        <div className={styles.divider} />

        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={loading ? <Spinner size="tiny" /> : <CheckmarkRegular />}
            disabled={loading}
            onClick={() => handleDecision('approve')}
          >
            Authorize {data.app.name}
          </Button>
          <Button
            appearance="outline"
            icon={<DismissRegular />}
            disabled={loading}
            onClick={() => handleDecision('deny')}
          >
            Deny
          </Button>
        </div>

        <Text size={100} style={{ color: tokens.colorNeutralForeground4, textAlign: 'center' }}>
          By authorizing, you allow {data.app.name} to access the requested information from your Prism account.
        </Text>
      </div>
    </div>
  );
}
