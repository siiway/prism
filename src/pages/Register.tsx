// Registration page

import {
  Button,
  Divider,
  Field,
  Input,
  Link,
  MessageBar,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
    width: '420px',
    padding: '40px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  footer: { textAlign: 'center' },
});

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub', google: 'Google', microsoft: 'Microsoft', discord: 'Discord',
};

export function Register() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { data: site } = useQuery({ queryKey: ['site'], queryFn: api.site, staleTime: 60_000 });

  const [form, setForm] = useState({ email: '', username: '', password: '', display_name: '' });
  const [captcha, setCaptcha] = useState<CaptchaValue>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await api.register({ ...form, ...captcha });
      if ('token' in res && res.token) {
        setAuth(res.token as string, res.user as UserProfile);
        navigate('/');
      } else {
        setSuccess('Registration successful! Please check your email to verify your account.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (!site?.allow_registration) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Title2>Registration Disabled</Title2>
          <Text>New account registration is currently disabled. Contact the administrator.</Text>
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Title2>Create account</Title2>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          Join {site?.site_name ?? 'Prism'}
        </Text>

        {success ? (
          <MessageBar intent="success">{success}</MessageBar>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <Field label="Email" required>
              <Input type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" />
            </Field>

            <div className={styles.row}>
              <Field label="Username" required>
                <Input value={form.username} onChange={update('username')} placeholder="johndoe" />
              </Field>
              <Field label="Display name">
                <Input value={form.display_name} onChange={update('display_name')} placeholder="John Doe" />
              </Field>
            </div>

            <Field label="Password" required>
              <Input type="password" value={form.password} onChange={update('password')} placeholder="At least 8 characters" />
            </Field>

            {site.captcha_provider !== 'none' && (
              <Captcha provider={site.captcha_provider} siteKey={site.captcha_site_key} onVerified={setCaptcha} onError={setError} />
            )}

            {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}

            <Button appearance="primary" type="submit" disabled={loading} icon={loading ? <Spinner size="tiny" /> : undefined}>
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        )}

        {(site?.enabled_providers?.length ?? 0) > 0 && !success && (
          <>
            <Divider>or sign up with</Divider>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {site!.enabled_providers.map((p) => (
                <Button key={p} appearance="outline" onClick={() => (window.location.href = `/api/connections/${p}/begin?mode=login`)}>
                  {PROVIDER_LABELS[p] ?? p}
                </Button>
              ))}
            </div>
          </>
        )}

        <div className={styles.footer}>
          <Text>Already have an account? </Text>
          <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
