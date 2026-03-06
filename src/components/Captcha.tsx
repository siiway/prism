// Captcha widget supporting Turnstile, hCaptcha, reCAPTCHA v3, and PoW

import { useEffect, useRef, useState, useCallback } from 'react';
import { Spinner, Text, ProgressBar } from '@fluentui/react-components';
import { api } from '../lib/api';
import { solvePoW } from '../lib/pow';

export interface CaptchaValue {
  captcha_token?: string;
  pow_challenge?: string;
  pow_nonce?: number;
}

interface CaptchaProps {
  provider: string;
  siteKey: string;
  onVerified: (value: CaptchaValue) => void;
  onError?: (err: string) => void;
}

export function Captcha({ provider, siteKey, onVerified, onError }: CaptchaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [powState, setPowState] = useState<'idle' | 'solving' | 'done' | 'error'>('idle');

  // ─── Turnstile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== 'turnstile') return;

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      if (!containerRef.current) return;
      widgetIdRef.current = (window as unknown as TurnstileWindow).turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onVerified({ captcha_token: token }),
        'error-callback': () => onError?.('Turnstile failed'),
      });
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [provider, siteKey, onVerified, onError]);

  // ─── hCaptcha ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== 'hcaptcha') return;

    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      if (!containerRef.current) return;
      widgetIdRef.current = (window as unknown as HCaptchaWindow).hcaptcha.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onVerified({ captcha_token: token }),
      });
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [provider, siteKey, onVerified, onError]);

  // ─── reCAPTCHA v3 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== 'recaptcha') return;

    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    script.onload = () => {
      (window as unknown as RecaptchaWindow).grecaptcha.ready(async () => {
        try {
          const token = await (window as unknown as RecaptchaWindow).grecaptcha.execute(siteKey, { action: 'login' });
          onVerified({ captcha_token: token });
        } catch { onError?.('reCAPTCHA failed'); }
      });
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [provider, siteKey, onVerified, onError]);

  // ─── Proof of Work ──────────────────────────────────────────────────────
  const solveChallenge = useCallback(async () => {
    setPowState('solving');
    try {
      const { challenge, difficulty } = await api.powChallenge();
      const nonce = await solvePoW(challenge, difficulty);
      onVerified({ pow_challenge: challenge, pow_nonce: nonce });
      setPowState('done');
    } catch {
      setPowState('error');
      onError?.('PoW solving failed');
    }
  }, [onVerified, onError]);

  useEffect(() => {
    if (provider === 'pow') solveChallenge();
  }, [provider, solveChallenge]);

  if (provider === 'none') return null;

  if (provider === 'pow') {
    return (
      <div style={{ padding: '12px', border: '1px solid var(--colorNeutralStroke1)', borderRadius: '4px' }}>
        {powState === 'idle' && <Text>Preparing challenge…</Text>}
        {powState === 'solving' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Spinner size="tiny" />
            <Text>Solving proof-of-work challenge…</Text>
          </div>
        )}
        {powState === 'done' && <Text style={{ color: 'var(--colorPaletteLightGreenForeground1)' }}>✓ Challenge solved</Text>}
        {powState === 'error' && <Text style={{ color: 'var(--colorPaletteRedForeground1)' }}>Challenge failed. <button onClick={solveChallenge}>Retry</button></Text>}
        <ProgressBar value={powState === 'done' ? 1 : powState === 'solving' ? undefined : 0} />
      </div>
    );
  }

  // For reCAPTCHA v3 there's no visible widget
  if (provider === 'recaptcha') return null;

  return <div ref={containerRef} />;
}

// Type stubs for injected globals
interface TurnstileWindow extends Window {
  turnstile: { render: (el: HTMLElement, opts: object) => string };
}
interface HCaptchaWindow extends Window {
  hcaptcha: { render: (el: HTMLElement, opts: object) => string };
}
interface RecaptchaWindow extends Window {
  grecaptcha: { ready: (fn: () => void) => void; execute: (key: string, opts: object) => Promise<string> };
}
