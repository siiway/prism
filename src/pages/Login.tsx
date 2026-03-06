// Login page with TOTP, passkey, and social provider support

import {
  Button,
  Divider,
  Field,
  Input,
  Link,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { KeyMultipleRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  startAuthentication,
} from '@simplewebauthn/browser';
import { api, ApiError } from '../lib/api';
import { Captcha } from '../components/Captcha';
import type { CaptchaValue } from '../components/Captcha';
import { useAuthStore } from '../store/auth';
import type { UserProfile } from '../lib/api';

const useStyles = makeStyles({
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: tokens.colorNeutralBackground1,
  },
  card: {
    width: '400px',
    padding: '40px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  providers: { display: 'flex', flexDirection: 'column', gap: '8px' },
  footer: { textAlign: 'center' },
});

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
  microsoft: 'Microsoft',
  discord: 'Discord',
};

export function Login() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth, token } = useAuthStore();
  const { data: site } = useQuery({ queryKey: ['site'], queryFn: api.site, staleTime: 60_000 });

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaValue>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const redirectTo = searchParams.get('redirect') ?? '/';

  // Redirect whenever a token appears (on mount if already logged in, or after login)
  useEffect(() => {
    if (token) navigate(redirectTo, { replace: true });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login({
        identifier,
        password,
        totp_code: totpRequired ? totpCode : undefined,
        ...captcha,
      });

      if (res.totp_required) {
        setTotpRequired(true);
        setLoading(false);
        return;
      }

      if (res.token && res.user) {
        setAuth(res.token, res.user as UserProfile);
        // navigation handled by the token useEffect
        console.debug('Login successful, token set, navigating to', redirectTo);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setPasskeyLoading(true);
    try {
      const options = await api.passkeyAuthBegin(identifier || undefined);
      const response = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'] });
      const res = await api.passkeyAuthFinish(
        (options as { challenge: string }).challenge,
        response,
      );
      setAuth(res.token, res.user);
      // navigation handled by the token useEffect
      console.debug('Login successful, token set, navigating to', redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Passkey authentication failed');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSocialLogin = (provider: string) => {
    window.location.href = `/api/connections/${provider}/begin?mode=login`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Title2>Sign in to {site?.site_name ?? 'Prism'}</Title2>

        <form onSubmit={handleLogin} className={styles.form}>
          {!totpRequired ? (
            <>
              <Field label="Email or username">
                <Input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
            </>
          ) : (
            <Field label="Two-factor authentication code">
              <Input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="000000 or backup code"
                maxLength={11}
                autoFocus
              />
            </Field>
          )}

          {site && site.captcha_provider !== 'none' && !totpRequired && (
            <Captcha
              provider={site.captcha_provider}
              siteKey={site.captcha_site_key}
              onVerified={setCaptcha}
              onError={setError}
            />
          )}

          {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}

          <Button appearance="primary" type="submit" disabled={loading} icon={loading ? <Spinner size="tiny" /> : undefined}>
            {loading ? 'Signing in…' : totpRequired ? 'Verify' : 'Sign in'}
          </Button>

          {totpRequired && (
            <Button appearance="subtle" onClick={() => setTotpRequired(false)}>Back</Button>
          )}
        </form>

        {!totpRequired && (
          <>
            <Button
              appearance="outline"
              icon={<KeyMultipleRegular />}
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading}
            >
              {passkeyLoading ? 'Authenticating…' : 'Sign in with passkey'}
            </Button>

            {(site?.enabled_providers?.length ?? 0) > 0 && (
              <>
                <Divider>or continue with</Divider>
                <div className={styles.providers}>
                  {site!.enabled_providers.map((p) => (
                    <Button key={p} appearance="outline" onClick={() => handleSocialLogin(p)}>
                      {PROVIDER_LABELS[p] ?? p}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {site?.allow_registration && !totpRequired && (
          <div className={styles.footer}>
            <Text>Don't have an account? </Text>
            <Link href="/register">Sign up</Link>
          </div>
        )}
      </div>
    </div>
  );
}
