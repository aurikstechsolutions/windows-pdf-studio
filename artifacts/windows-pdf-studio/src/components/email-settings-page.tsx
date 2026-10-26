import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, Mail, Save, Server, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import type { MailConnectionResult, MailSettingsForm, SavedMailSettings } from '@/lib/mail-bridge';
import './email-settings-page.css';

const emptyForm: MailSettingsForm = {
  emailAddress: '',
  displayName: '',
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  imapUsername: '',
  imapPassword: '',
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  smtpUsername: '',
  smtpPassword: '',
};

type Notice = { kind: 'success' | 'error' | 'info'; text: string };

export default function EmailSettingsPage({ onOpenInbox, embedded = false }: { onOpenInbox: () => void; embedded?: boolean }) {
  const bridge = window.pdfStudioMail;
  const [form, setForm] = useState<MailSettingsForm>(emptyForm);
  const [saved, setSaved] = useState<SavedMailSettings | null>(null);
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [connection, setConnection] = useState<MailConnectionResult | null>(null);

  useEffect(() => {
    if (!bridge) {
      setLoading(false);
      return;
    }
    let active = true;
    void bridge.getSettings().then((result) => {
      if (!active) return;
      setSecureStorageAvailable(result.secureStorageAvailable);
      setSaved(result.settings);
      if (result.settings) {
        setForm({
          ...emptyForm,
          emailAddress: result.settings.emailAddress,
          displayName: result.settings.displayName,
          imapHost: result.settings.imapHost,
          imapPort: result.settings.imapPort,
          imapSecure: result.settings.imapSecure,
          imapUsername: result.settings.imapUsername,
          smtpHost: result.settings.smtpHost,
          smtpPort: result.settings.smtpPort,
          smtpSecure: result.settings.smtpSecure,
          smtpUsername: result.settings.smtpUsername,
        });
      }
    }).catch(() => {
      if (active) setNotice({ kind: 'error', text: 'Saved mailbox settings could not be loaded. Reconnect the account to continue.' });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [bridge]);

  const change = (key: keyof MailSettingsForm, value: string | number | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setNotice(null);
    setConnection(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bridge) return;
    setBusy(true);
    setNotice(null);
    setConnection(null);
    try {
      const result = await bridge.saveSettings(form);
      setSaved(result);
      setForm((current) => ({ ...current, imapUsername: result.imapUsername, smtpUsername: result.smtpUsername, imapPassword: '', smtpPassword: '' }));
      setNotice({ kind: 'success', text: 'Mailbox settings saved securely on this device.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Mailbox settings could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!bridge) return;
    setBusy(true);
    setNotice(null);
    setConnection(null);
    try {
      const result = await bridge.testConnections(form);
      setConnection(result);
      if (result.ok) setNotice({ kind: 'success', text: 'Both incoming IMAP and outgoing SMTP connections are working.' });
    } catch {
      setNotice({ kind: 'error', text: 'The connection test could not run. Check the settings and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!bridge || !window.confirm('Remove the saved mailbox account and encrypted credentials from this device?')) return;
    setBusy(true);
    try {
      await bridge.clearSettings();
      setSaved(null);
      setForm(emptyForm);
      setConnection(null);
      setNotice({ kind: 'success', text: 'The mailbox account was removed from this device.' });
    } catch {
      setNotice({ kind: 'error', text: 'The saved mailbox account could not be removed.' });
    } finally {
      setBusy(false);
    }
  };

  const textField = (key: keyof MailSettingsForm, label: string, placeholder: string, type = 'text', hint?: string) => (
    <label className="email-field">
      <span>{label}</span>
      <input
        type={type}
        value={String(form[key])}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={(event) => change(key, event.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );

  const portField = (key: 'imapPort' | 'smtpPort', label: string) => (
    <label className="email-field email-port-field">
      <span>{label}</span>
      <input type="number" min={1} max={65535} value={form[key]} onChange={(event) => change(key, Number(event.target.value))}/>
    </label>
  );

  const secureToggle = (key: 'imapSecure' | 'smtpSecure', title: string) => (
    <label className="email-secure-toggle">
      <input type="checkbox" checked={form[key]} onChange={(event) => change(key, event.target.checked)}/>
      <span><strong>{title}</strong><small>Turn off for STARTTLS connections.</small></span>
    </label>
  );

  if (!bridge) {
    return <div className={embedded ? 'email-page email-page-embedded' : 'page-wrap email-page'}>
      <section className="email-notice notice info"><LockKeyhole size={16}/> Email accounts connect only in the installed Windows desktop app. Mail credentials and attachments are never sent to the license service.</section>
    </div>;
  }

  return <div className={embedded ? 'email-page email-page-embedded' : 'page-wrap email-page'}>
    {!secureStorageAvailable && <div className="email-notice notice error"><ShieldCheck size={16}/> Secure operating-system storage is unavailable. Credentials cannot be saved on this device.</div>}
    {notice && <div className={`email-notice notice ${notice.kind}`} role="status"><CheckCircle2 size={16}/>{notice.text}</div>}
    {loading ? <div className="panel email-loading">Loading saved mailbox settings…</div> : <form className="email-settings-layout" onSubmit={save}>
      <div className="email-settings-main">
        <section className="panel email-card">
          <div className="email-card-heading"><div className="email-card-icon"><Mail size={17}/></div><div><h2>Account</h2><p>Mailbox identity and login details.</p></div><span className={`email-status-pill ${saved ? 'connected' : ''}`}>{saved ? 'Configured' : 'Not connected'}</span></div>
          <div className="email-form-grid">
            {textField('emailAddress', 'EMAIL ADDRESS', 'you@example.com', 'email')}
            {textField('displayName', 'DISPLAY NAME (OPTIONAL)', 'Studio mailbox')}
            {textField('imapUsername', 'IMAP USERNAME', 'Usually your email address', 'text', 'Used to sign in to the incoming mailbox.')}
            {textField('imapPassword', 'IMAP PASSWORD / APP PASSWORD', saved?.imapPasswordSaved ? 'Saved securely — leave blank to keep it' : 'Enter your mailbox app password', 'password', 'If your provider groups an app password, enter it without spaces.')}
          </div>
        </section>

        <section className="panel email-card">
          <div className="email-card-heading"><div className="email-card-icon"><Server size={17}/></div><div><h2>Incoming mail · IMAP</h2><p>Used to check the inbox and find PDF or image attachments.</p></div></div>
          <div className="email-form-grid email-server-grid">
            {textField('imapHost', 'IMAP SERVER', 'imap.example.com')}
            {portField('imapPort', 'PORT')}
            {secureToggle('imapSecure', 'Use SSL/TLS')}
          </div>
        </section>

        <section className="panel email-card">
          <div className="email-card-heading"><div className="email-card-icon"><Wifi size={17}/></div><div><h2>Outgoing mail · SMTP</h2><p>Saved for outgoing mail and verified with the connection test.</p></div></div>
          <div className="email-form-grid email-server-grid">
            {textField('smtpHost', 'SMTP SERVER', 'smtp.example.com')}
            {portField('smtpPort', 'PORT')}
            {textField('smtpUsername', 'SMTP USERNAME', 'Usually your email address')}
            {textField('smtpPassword', 'SMTP PASSWORD / APP PASSWORD', saved?.smtpPasswordSaved ? 'Saved securely — leave blank to keep it' : 'Enter your SMTP app password', 'password', 'If your provider groups an app password, enter it without spaces.')}
            {secureToggle('smtpSecure', 'Use SSL/TLS')}
          </div>
        </section>
      </div>

      <aside className="email-settings-aside">
        <section className="panel email-card email-actions-card">
          <h2 className="card-title"><KeyRound size={15}/> Connection</h2>
          <button className="tool-btn" type="button" onClick={onOpenInbox}><Mail size={14}/> Open inbox <ArrowRight size={13}/></button>
          {saved && <div className="email-account-summary"><strong>{saved.emailAddress}</strong><span>Passwords {saved.imapPasswordSaved && saved.smtpPasswordSaved ? 'are' : 'are not'} stored in the OS secure store.</span></div>}
          <button className="tool-btn" type="button" onClick={test} disabled={busy || !secureStorageAvailable}><Wifi size={14}/>{busy ? 'Checking…' : 'Test IMAP & SMTP'}</button>
          {connection && <div className="email-test-results">
            <div className={connection.imap.ok ? 'email-test-ok' : 'email-test-fail'}>{connection.imap.ok ? 'IMAP connected' : connection.imap.message}</div>
            <div className={connection.smtp.ok ? 'email-test-ok' : 'email-test-fail'}>{connection.smtp.ok ? 'SMTP connected' : connection.smtp.message}</div>
          </div>}
          <button className="tool-btn primary" type="submit" disabled={busy || !secureStorageAvailable}><Save size={14}/>{busy ? 'Saving…' : 'Save mailbox settings'}</button>
          {saved && <button className="tool-btn email-remove-button" type="button" onClick={clear} disabled={busy}><Trash2 size={14}/> Remove mailbox</button>}
        </section>
        <section className="panel email-card email-security-card">
          <h2 className="card-title"><LockKeyhole size={15}/> Your mail stays local</h2>
          <p>Mailbox credentials are encrypted with the operating system’s secure storage. Email headers are read directly from your IMAP provider. Attachments are downloaded only when you choose to import them.</p>
          <p>Use an app password if your provider requires one. Enable IMAP access in your provider’s mail settings.</p>
        </section>
      </aside>
    </form>}
  </div>;
}
