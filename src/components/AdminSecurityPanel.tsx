import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  Eye,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { app, auth } from '../firebase';
import type { CustomerInquiry } from '../types/showroom';
import {
  disableCloudflareTotp,
  enableCloudflareTotp,
  fetchCloudflareAdminSessions,
  fetchCloudflareSecurityStatus,
  fetchCloudflareVisitorAnalytics,
  forceSignOutAllCloudflareDevices,
  respondToCloudflareLoginAlert,
  revokeCloudflareAdminSession,
  setupCloudflareTotp,
  updateCloudflareSecuritySettings,
  type CloudflareAdminSession,
  type CloudflareLoginAlert,
  type CloudflareSecurityStatus,
  type CloudflareVisitorAnalytics,
} from '../utils/cloudflareStore';
import { fetchCustomerInquiries } from '../utils/storeClient';
import {
  buildOtpAuthUrl,
  generateBase32Secret,
  normalizeTotpSecret,
  verifyTotpCode,
} from '../utils/totp';
import {
  getOrCreateWebDeviceId,
  readFirestoreSecurityDashboardData,
  respondToFirestoreLoginAlert,
  revokeFirestoreAdminSession,
  saveFirestoreSecuritySettings,
} from '../utils/webAdminSessionSync';

function formatRelativeTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function PendingLoginAlertsBanner({
  alerts,
  onDecide,
  busyId,
}: {
  alerts: CloudflareLoginAlert[];
  onDecide: (alertId: string, decision: 'approved' | 'denied') => Promise<void>;
  busyId: string | null;
}) {
  const pending = alerts.filter((a) => a.decision === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="space-y-2.5" role="alert" aria-live="polite">
      {pending.map((alert) => {
        const isUnauth = alert.alertType === 'unauthorized_email';
        const busy = busyId === alert.id;
        return (
          <div
            key={alert.id}
            className="rounded-xl border border-amber-500/40 bg-amber-950/35 px-4 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-amber-100">
                    {isUnauth
                      ? 'Admin Access Grant Request'
                      : 'New Device Sign-In Alert'}
                  </p>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30">
                    {alert.platform}
                  </span>
                  <span className="text-[11px] text-amber-200/70">
                    {formatRelativeTime(alert.timestampMillis)}
                  </span>
                </div>
                <p className="text-xs text-zinc-200">
                  <span className="font-semibold text-white">{alert.email}</span> tried to sign in from{' '}
                  <span className="font-medium text-white">{alert.deviceName}</span>
                  {alert.location ? ` (${alert.location})` : ''}.
                </p>
                {alert.verificationCode && (
                  <p className="text-xs text-amber-200 flex items-center gap-2 pt-0.5">
                    <span>Verification code for this login:</span>
                    <span className="font-mono text-sm font-bold tracking-[0.2em] px-2 py-0.5 rounded bg-black/50 border border-amber-400/40 text-white">
                      {alert.verificationCode}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDecide(alert.id, 'approved')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>{isUnauth ? 'Grant Access' : 'Approve Login'}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDecide(alert.id, 'denied')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800/70 disabled:opacity-60 text-red-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Deny</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AdminSecurityTab({
  alerts,
  onAlertsUpdated,
  onForceSignOutSelf,
}: {
  alerts: CloudflareLoginAlert[];
  onAlertsUpdated: () => Promise<void>;
  onForceSignOutSelf: () => void;
}) {
  const [security, setSecurity] = useState<CloudflareSecurityStatus | null>(null);
  const [sessions, setSessions] = useState<CloudflareAdminSession[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // TOTP Setup state
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    source: 'cloudflare' | 'firestore';
  } | null>(null);
  const [customSecretInput, setCustomSecretInput] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  const currentDeviceId = getOrCreateWebDeviceId();
  const notifSupported = typeof window !== 'undefined' && 'Notification' in window;
  const [notifPermission, setNotifPermission] = useState<string>(
    notifSupported ? Notification.permission : 'unsupported'
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfRes, fsRes] = await Promise.allSettled([
        Promise.all([fetchCloudflareSecurityStatus(), fetchCloudflareAdminSessions()]),
        readFirestoreSecurityDashboardData(app, auth.currentUser),
      ]);

      if (cfRes.status === 'fulfilled') {
        const [sec, sess] = cfRes.value;
        const fsData = fsRes.status === 'fulfilled' ? fsRes.value : null;
        const mergedSessionsMap = new Map<string, CloudflareAdminSession>();
        for (const s of sess.sessions) mergedSessionsMap.set(s.id, s);
        if (fsData) {
          for (const s of fsData.sessions) {
            if (!mergedSessionsMap.has(s.id)) mergedSessionsMap.set(s.id, s);
          }
        }
        const mergedSessions = Array.from(mergedSessionsMap.values()).sort(
          (a, b) => b.lastActiveMillis - a.lastActiveMillis
        );
        setSecurity({
          ...sec,
          twoFactorEnabled: Boolean(sec.twoFactorEnabled || fsData?.security.twoFactorEnabled),
          hasTotpSecret: Boolean(sec.hasTotpSecret || fsData?.security.hasTotpSecret),
        });
        setSessions(mergedSessions);
        setActiveCount(mergedSessions.filter((s) => s.status === 'active').length);
        await onAlertsUpdated();
      } else if (fsRes.status === 'fulfilled') {
        setSecurity(fsRes.value.security);
        setSessions(fsRes.value.sessions);
        setActiveCount(fsRes.value.activeCount);
        await onAlertsUpdated();
      } else {
        throw new Error('Unable to load security settings right now.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load security settings.');
    } finally {
      setLoading(false);
    }
  }, [onAlertsUpdated]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleSetting = async (
    key: 'requireDeviceApproval' | 'loginAlertsEnabled',
    nextVal: boolean
  ) => {
    setBusyAction(key);
    setError(null);
    setNotice(null);
    try {
      let updated: CloudflareSecurityStatus | null = null;
      try {
        updated = await updateCloudflareSecuritySettings({ [key]: nextVal });
      } catch {
        // Fallback to Firestore
      }
      await saveFirestoreSecuritySettings(app, { [key]: nextVal }).catch(() => undefined);
      setSecurity((prev) =>
        updated ?? (prev ? { ...prev, [key]: nextVal } : prev)
      );
      setNotice('Security setting saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update security setting.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStartTotpSetup = async () => {
    setBusyAction('totp-setup');
    setError(null);
    setNotice(null);
    try {
      try {
        const res = await setupCloudflareTotp();
        setTotpSetup({ secret: res.secret, otpauthUrl: res.otpauthUrl, source: 'cloudflare' });
      } catch {
        const secret = generateBase32Secret();
        const email = auth.currentUser?.email || 'alifcarimports@gmail.com';
        setTotpSetup({
          secret,
          otpauthUrl: buildOtpAuthUrl(secret, email),
          source: 'firestore',
        });
      }
      setCustomSecretInput('');
      setTotpCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initialize 2FA authenticator setup.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEnableTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSetup) return;
    setBusyAction('totp-enable');
    setError(null);
    setNotice(null);
    try {
      const cleanCode = totpCode.trim();
      const customSecret = normalizeTotpSecret(customSecretInput);
      const activeSecret = customSecret.length >= 16 ? customSecret : totpSetup.secret;

      const validLocal = await verifyTotpCode(activeSecret, cleanCode);
      if (!validLocal) {
        throw new Error(
          'Invalid 6-digit code. Check that the setup key in your Authenticator app matches and try again.'
        );
      }

      if (totpSetup.source === 'cloudflare' && !customSecret) {
        await enableCloudflareTotp(cleanCode).catch(() => undefined);
      }

      await saveFirestoreSecuritySettings(app, {
        twoFactorEnabled: true,
        totpSecret: activeSecret,
      });

      setTotpSetup(null);
      setCustomSecretInput('');
      setTotpCode('');
      setNotice('Two-Factor Authentication (6-digit code) is now enabled for all admin logins.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid 6-digit code.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisableTotp = async () => {
    setBusyAction('totp-disable');
    setError(null);
    setNotice(null);
    try {
      await Promise.allSettled([
        disableCloudflareTotp(),
        saveFirestoreSecuritySettings(app, { twoFactorEnabled: false, totpSecret: '' }),
      ]);
      setTotpSetup(null);
      setNotice('Two-Factor Authentication disabled.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disable 2FA.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeSession = async (session: CloudflareAdminSession) => {
    setBusyAction(`revoke-${session.id}`);
    setError(null);
    try {
      await Promise.allSettled([
        revokeCloudflareAdminSession(null, session.id),
        revokeFirestoreAdminSession(app, session.id),
      ]);
      if (session.deviceId === currentDeviceId) {
        onForceSignOutSelf();
        return;
      }
      setNotice(`Signed out ${session.deviceName}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke session.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleForceSignOutAll = async () => {
    setBusyAction('force-all');
    setError(null);
    try {
      await Promise.allSettled([
        forceSignOutAllCloudflareDevices(),
        saveFirestoreSecuritySettings(app, { forceSignOutAll: true }),
      ]);
      onForceSignOutSelf();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign out all devices.');
      setBusyAction(null);
    }
  };

  const handleAlertDecision = async (alertId: string, decision: 'approved' | 'denied') => {
    setBusyAction(`alert-${alertId}`);
    setError(null);
    const target = alerts.find((a) => a.id === alertId);
    try {
      const [cfRes, fsRes] = await Promise.allSettled([
        respondToCloudflareLoginAlert(alertId, decision),
        respondToFirestoreLoginAlert(
          app,
          alertId,
          decision,
          target?.email,
          target?.uid,
          target?.alertType === 'unauthorized_email'
        ),
      ]);
      if (cfRes.status === 'rejected' && fsRes.status === 'rejected') {
        throw new Error('Unable to respond to alert.');
      }
      setNotice(decision === 'approved' ? 'Approved login / granted access.' : 'Denied login attempt.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to respond to alert.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRequestBrowserNotifications = async () => {
    if (!notifSupported) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    } catch {
      // Ignore
    }
  };

  const activeSessions = sessions.filter((s) => s.status === 'active');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-white">
            Security, Active Devices & Login Alerts
          </h2>
          <p className="text-xs text-zinc-400">
            Manage 2-step authentication codes, approve new devices or emails, and monitor signed-in devices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-white text-xs font-medium text-zinc-200 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/70 bg-red-950/50 px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-900/70 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
          {notice}
        </div>
      )}

      {/* Security Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Active Devices</span>
            <MonitorSmartphone className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">{activeCount}</p>
          <p className="text-[11px] text-zinc-500">Signed-in Website & Mobile sessions</p>
        </div>

        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Authentication Code (2FA)</span>
            <KeyRound className="w-4 h-4 text-emerald-400" />
          </div>
          <p className={`text-lg font-bold ${security?.twoFactorEnabled ? 'text-emerald-400' : 'text-zinc-300'}`}>
            {security?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
          </p>
          <p className="text-[11px] text-zinc-500">
            {security?.twoFactorEnabled
              ? '6-digit code required on admin logins'
              : 'Turn on to require a 6-digit code'}
          </p>
        </div>

        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Pending Alerts</span>
            <Bell className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">
            {alerts.filter((a) => a.decision === 'pending').length}
          </p>
          <p className="text-[11px] text-zinc-500">Waiting for your Approve or Deny</p>
        </div>
      </div>

      {/* Authentication Code (2FA) & Alert Controls */}
      <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#E11D2A]" />
              <h3 className="text-sm font-semibold text-white">
                Two-Factor Authentication (6-Digit Code)
              </h3>
            </div>
            <p className="text-xs text-zinc-400">
              Require a 6-digit Authenticator App code (Google Authenticator / Authy) or trusted-device approval code every time someone logs into `/admin`.
            </p>
          </div>

          {security?.twoFactorEnabled ? (
            <button
              type="button"
              disabled={busyAction === 'totp-disable'}
              onClick={() => void handleDisableTotp()}
              className="px-3.5 py-2 rounded-lg border border-red-800/70 bg-red-950/50 hover:bg-red-900/60 text-xs font-semibold text-red-200 cursor-pointer shrink-0"
            >
              {busyAction === 'totp-disable' ? 'Disabling...' : 'Disable 2FA'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busyAction === 'totp-setup'}
              onClick={() => void handleStartTotpSetup()}
              className="px-3.5 py-2 rounded-lg bg-[#E11D2A] hover:bg-[#C81722] text-xs font-semibold text-white cursor-pointer shrink-0"
            >
              {busyAction === 'totp-setup' ? 'Preparing...' : 'Enable Authentication Code'}
            </button>
          )}
        </div>

        {totpSetup && (
          <form onSubmit={handleEnableTotp} className="rounded-xl bg-[#09090c] border border-white/[0.1] p-4 space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-white">
                Step 1: Add this secret key to Google Authenticator, Authy, or Microsoft Authenticator
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="px-3 py-2 rounded-lg bg-[#141418] border border-zinc-700 font-mono text-xs text-amber-200 tracking-wider break-all">
                  {totpSetup.secret}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(totpSetup.secret);
                    setCopiedSecret(true);
                    window.setTimeout(() => setCopiedSecret(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 hover:border-white text-xs text-zinc-200 cursor-pointer"
                >
                  {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSecret ? 'Copied' : 'Copy Key'}</span>
                </button>
              </div>
              <p className="text-[11px] text-zinc-400">
                Account name: Alif Car Import · Type: Time-based (30 seconds, 6 digits).
              </p>
              <div className="pt-2 space-y-1">
                <label htmlFor="custom-totp-secret" className="block text-[11px] text-zinc-400">
                  Already set up on your phone app? Paste your existing setup key here (optional):
                </label>
                <input
                  id="custom-totp-secret"
                  type="text"
                  value={customSecretInput}
                  onChange={(e) => setCustomSecretInput(e.target.value)}
                  placeholder="Optional: paste existing Base32 key from mobile app"
                  className="w-full max-w-md h-9 px-3 rounded-lg bg-[#141418] border border-zinc-700 font-mono text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D2A]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="setup-totp-code" className="block text-xs font-semibold text-white">
                Step 2: Enter the 6-digit code from your Authenticator app to activate
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="setup-totp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-40 h-10 px-3 rounded-lg bg-[#141418] border border-zinc-700 text-center font-mono text-base tracking-[0.3em] text-white focus:outline-none focus:border-[#E11D2A]"
                />
                <button
                  type="submit"
                  disabled={totpCode.length !== 6 || busyAction === 'totp-enable'}
                  className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
                >
                  {busyAction === 'totp-enable' ? 'Verifying...' : 'Verify & Activate 2FA'}
                </button>
                <button
                  type="button"
                  onClick={() => setTotpSetup(null)}
                  className="h-10 px-3 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-[#0b0b0e] border border-white/[0.06] cursor-pointer">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-white block">
                New-Device Approval & Alert
              </span>
              <span className="text-[11px] text-zinc-400 block">
                Notify active devices and require approval or 6-digit code whenever another device signs in.
              </span>
            </div>
            <input
              type="checkbox"
              checked={Boolean(security?.requireDeviceApproval)}
              disabled={busyAction === 'requireDeviceApproval' || !security}
              onChange={(e) => void handleToggleSetting('requireDeviceApproval', e.target.checked)}
              className="mt-1 accent-[#E11D2A] w-4 h-4"
            />
          </label>

          <div className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-[#0b0b0e] border border-white/[0.06]">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-white block">
                Browser Alert Notifications
              </span>
              <span className="text-[11px] text-zinc-400 block">
                {notifPermission === 'granted'
                  ? 'Browser notifications are active for login & access requests.'
                  : 'Enable browser alerts when another email or device tries to log in.'}
              </span>
            </div>
            {notifSupported && notifPermission !== 'granted' && (
              <button
                type="button"
                onClick={() => void handleRequestBrowserNotifications()}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-white text-xs font-medium text-white shrink-0 cursor-pointer"
              >
                Enable
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active Devices Section */}
      <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Active Signed-In Devices ({activeSessions.length})
            </h3>
            <p className="text-xs text-zinc-400">
              All website browsers and mobile devices currently logged into your admin console.
            </p>
          </div>
          {activeSessions.length > 0 && (
            <button
              type="button"
              disabled={busyAction === 'force-all'}
              onClick={() => void handleForceSignOutAll()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-800/70 bg-red-950/40 hover:bg-red-900/60 text-xs font-semibold text-red-200 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{busyAction === 'force-all' ? 'Signing Out...' : 'Sign Out All Devices'}</span>
            </button>
          )}
        </div>

        {activeSessions.length === 0 ? (
          <p className="text-xs text-zinc-500 py-4 text-center">No active device sessions recorded yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {activeSessions.map((sess) => {
              const isCurrent = sess.deviceId === currentDeviceId;
              const isMobile =
                sess.platform.toLowerCase().includes('android') ||
                sess.platform.toLowerCase().includes('ios') ||
                sess.deviceName.toLowerCase().includes('android');
              return (
                <div
                  key={sess.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-300 flex items-center justify-center shrink-0">
                      {isMobile ? <Smartphone className="w-4 h-4" /> : <Laptop className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-white">{sess.deviceName}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                          {sess.platform}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/50">
                            This Device
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 truncate">
                        {sess.email}
                        {sess.location ? ` · ${sess.location}` : ''} · Active {formatRelativeTime(sess.lastActiveMillis)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busyAction === `revoke-${sess.id}`}
                    onClick={() => void handleRevokeSession(sess)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-red-500/70 text-xs font-medium text-zinc-300 hover:text-red-300 cursor-pointer shrink-0 self-start sm:self-center"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Login Alerts History */}
      <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Recent Login Alerts & Access Requests</h3>
          <p className="text-xs text-zinc-400">
            Every sign-in from another device or unauthorized email is logged here.
          </p>
        </div>

        {alerts.length === 0 ? (
          <p className="text-xs text-zinc-500 py-4 text-center">No login alerts recorded yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {alerts.slice(0, 20).map((a) => (
              <div
                key={a.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-white">{a.email}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      {a.alertType === 'unauthorized_email' ? 'Access Request' : a.platform}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                        a.decision === 'pending'
                          ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                          : a.decision === 'approved' || a.decision === 'notified'
                          ? 'bg-emerald-950 text-emerald-300'
                          : 'bg-red-950 text-red-300'
                      }`}
                    >
                      {a.decision}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {a.deviceName}
                    {a.location ? ` · ${a.location}` : ''} · {formatRelativeTime(a.timestampMillis)}
                    {a.verificationCode ? ` · Code: ${a.verificationCode}` : ''}
                  </p>
                </div>

                {a.decision === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyAction === `alert-${a.id}`}
                      onClick={() => void handleAlertDecision(a.id, 'approved')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                    >
                      {a.alertType === 'unauthorized_email' ? 'Grant' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === `alert-${a.id}`}
                      onClick={() => void handleAlertDecision(a.id, 'denied')}
                      className="px-3 py-1.5 rounded-lg border border-red-800 text-red-300 hover:bg-red-950/60 text-xs font-semibold cursor-pointer"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminVisitorsTab() {
  const [analytics, setAnalytics] = useState<CloudflareVisitorAnalytics | null>(null);
  const [inquiries, setInquiries] = useState<CustomerInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stats, inq] = await Promise.all([
        fetchCloudflareVisitorAnalytics(),
        fetchCustomerInquiries(),
      ]);
      setAnalytics(stats);
      setInquiries(inq);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load visitor analytics.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const maxDaily = Math.max(1, ...(analytics?.dailyStats ?? []).map((d) => d.visits));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-white">
            Visitors & Customer Interactions
          </h2>
          <p className="text-xs text-zinc-400">
            Live page views, unique visitors, popular vehicles, and customer inquiries from your website.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAnalytics()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-white text-xs font-medium text-zinc-200 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/70 bg-red-950/50 px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Total Visits</span>
            <Eye className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">
            {analytics?.totalVisits ?? 0}
          </p>
          <p className="text-[11px] text-zinc-500">All-time showroom views</p>
        </div>

        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Unique Visitors</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">
            {analytics?.uniqueVisitors ?? 0}
          </p>
          <p className="text-[11px] text-zinc-500">Distinct browsers & devices</p>
        </div>

        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Today&apos;s Visits</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">
            {analytics?.todayVisits ?? 0}
          </p>
          <p className="text-[11px] text-zinc-500">
            {analytics?.todayUnique ?? 0} unique today
          </p>
        </div>

        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Inquiries</span>
            <MessageSquare className="w-4 h-4 text-[#E11D2A]" />
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">
            {Math.max(analytics?.inquiriesCount ?? 0, inquiries.length)}
          </p>
          <p className="text-[11px] text-zinc-500">Customer contact messages</p>
        </div>
      </div>

      {/* 7-Day Activity & Top Pages */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Last 7 Days Visits</h3>
          {!analytics || analytics.dailyStats.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">
              Visitor trend will appear here as visitors browse your showroom.
            </p>
          ) : (
            <div className="space-y-2.5">
              {analytics.dailyStats.map((day) => {
                const pct = Math.max(8, Math.round((day.visits / maxDaily) * 100));
                return (
                  <div key={day.dateKey} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-zinc-300">{day.dateKey}</span>
                      <span className="text-zinc-400 tabular-nums">
                        {day.visits} visits · {day.uniqueVisitors} unique
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#E11D2A]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Top Visited Pages</h3>
          {!analytics || analytics.topPages.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">No page views recorded yet.</p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {analytics.topPages.map((p) => (
                <div key={p.page} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <span className="font-mono text-zinc-200 truncate">{p.page}</span>
                  <span className="font-semibold text-white tabular-nums shrink-0">
                    {p.visits} views
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Customer Inquiries List */}
      <div className="bg-[#111115] border border-white/[0.08] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#E11D2A]" />
          <h3 className="text-sm font-semibold text-white">
            Customer Inquiries ({inquiries.length})
          </h3>
        </div>
        {inquiries.length === 0 ? (
          <p className="text-xs text-zinc-500 py-4 text-center">No customer inquiries yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {inquiries.slice(0, 30).map((inq) => (
              <div key={inq.id} className="py-3 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{inq.name}</span>
                  <span className="text-[11px] text-zinc-400">
                    {inq.createdAt ? new Date(inq.createdAt).toLocaleString() : ''}
                  </span>
                </div>
                <p className="text-xs text-zinc-300">
                  {inq.phone}
                  {inq.email ? ` · ${inq.email}` : ''}
                  {inq.vehicleTitle ? ` · Vehicle: ${inq.vehicleTitle}` : ''}
                </p>
                <p className="text-xs text-zinc-400 whitespace-pre-line">{inq.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
