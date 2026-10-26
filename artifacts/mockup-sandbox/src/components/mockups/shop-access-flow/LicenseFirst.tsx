import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileKey2,
  FileText,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Store,
} from 'lucide-react';
import './_group.css';
import './LicenseFirst.css';

type View = 'license' | 'signup' | 'login' | 'request';

export function LicenseFirst() {
  const [view, setView] = useState<View>('license');
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseState, setLicenseState] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [shopName, setShopName] = useState('');

  const validateLicense = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (licenseKey.trim().toUpperCase() === 'DEMO-2026-PRINT') {
      setLicenseKey('DEMO-2026-PRINT');
      setLicenseState('valid');
      setFormMessage('');
      window.setTimeout(() => setView('signup'), 460);
    } else {
      setLicenseState('invalid');
      setFormMessage('We couldn’t verify that key. Check it and try again.');
    }
  };

  const submitAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (view === 'signup' && password !== confirmPassword) {
      setFormMessage('Those passwords don’t match yet.');
      return;
    }
    setFormMessage(view === 'login'
      ? 'Sign-in is ready to connect to your shop account.'
      : 'Your shop account details are ready to submit.');
  };

  const submitRequest = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequestSent(true);
  };

  const resetFlow = (next: View) => {
    setView(next);
    setFormMessage('');
    setLicenseState('idle');
  };

  return (
    <main className="lf-shell">
      <div className="lf-frame">
        <aside className="lf-aside">
          <div className="lf-brand">
            <span className="lf-brand-icon"><FileText size={19} strokeWidth={2.1} /></span>
            <span className="lf-brand-name">Windows PDF Studio<span>SHOP EDITION</span></span>
          </div>

          <div className="lf-aside-copy">
            <div className="lf-overline"><span /> BUILT FOR LOCAL PRINT SHOPS</div>
            <h1>Print work stays<br /><em>in your hands.</em></h1>
            <p>Secure access for the people and print counters your neighborhood already trusts.</p>
          </div>

          <div className="lf-trust-list">
            <div className="lf-trust-row">
              <span className="lf-trust-icon"><ShieldCheck size={17} /></span>
              <span><strong>Privacy comes first</strong><small>Customer documents stay on this PC.</small></span>
            </div>
            <div className="lf-trust-row">
              <span className="lf-trust-icon"><Store size={17} /></span>
              <span><strong>Made for the counter</strong><small>A dependable workspace for busy shops.</small></span>
            </div>
          </div>

          <div className="lf-aside-footer">
            <span className="lf-secure-mark"><LockKeyhole size={13} /> PRIVATE BY DESIGN</span>
            <span>Windows desktop software</span>
          </div>
          <div className="lf-orbit lf-orbit-one" />
          <div className="lf-orbit lf-orbit-two" />
          <div className="lf-grid-glow" />
        </aside>

        <section className="lf-main">
          <div className="lf-main-top">
            <span className="lf-step-context">SHOP ACCOUNT ACCESS</span>
            <div className="lf-online"><span /> ENCRYPTED CONNECTION</div>
          </div>

          <div className="lf-content" key={view}>
            {view === 'license' && (
              <>
                <div className="lf-step-line"><span className="lf-step-number">01</span><span className="lf-step-rule" /><span className="lf-step-label">LICENSE CHECK</span></div>
                <h2>Start with your<br />shop license.</h2>
                <p className="lf-intro">Enter the approved license key for this shop. We’ll verify it before you create an account.</p>
                <form className="lf-form" onSubmit={validateLicense}>
                  <label htmlFor="license-key">LICENSE KEY</label>
                  <div className={`lf-input-wrap lf-key-input ${licenseState === 'invalid' ? 'has-error' : ''} ${licenseState === 'valid' ? 'is-valid' : ''}`}>
                    <FileKey2 size={18} />
                    <input
                      id="license-key"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="e.g. DEMO-2026-PRINT"
                      value={licenseKey}
                      onChange={(event) => { setLicenseKey(event.target.value); setLicenseState('idle'); setFormMessage(''); }}
                      aria-describedby="license-feedback"
                    />
                    {licenseState === 'valid' && <CheckCircle2 className="lf-valid-icon" size={18} />}
                  </div>
                  <div className={`lf-feedback ${licenseState}`} id="license-feedback" aria-live="polite">
                    {licenseState === 'invalid' ? formMessage : licenseState === 'valid' ? 'License verified. Opening account setup…' : 'Your license key is provided with your shop approval.'}
                  </div>
                  <button className="lf-primary" type="submit" disabled={!licenseKey.trim()}>
                    Verify license <ArrowRight size={16} />
                  </button>
                </form>
                <div className="lf-divider"><span>OR</span></div>
                <button className="lf-text-action" type="button" onClick={() => resetFlow('request')}>
                  Request a shop license <ChevronRight size={15} />
                </button>
                <div className="lf-separate-login">
                  <span>Already have a shop account?</span>
                  <button type="button" onClick={() => resetFlow('login')}>Sign in <ArrowRight size={14} /></button>
                </div>
              </>
            )}

            {view === 'signup' && (
              <>
                <button className="lf-back" type="button" onClick={() => resetFlow('license')}><ArrowLeft size={14} /> Back to license</button>
                <div className="lf-step-line"><span className="lf-step-number lf-complete"><Check size={14} /></span><span className="lf-step-rule active" /><span className="lf-step-number">02</span><span className="lf-step-rule" /><span className="lf-step-label">ACCOUNT SETUP</span></div>
                <h2>Your license<br />is confirmed.</h2>
                <p className="lf-intro">Create the sign-in for your shop. Your license is securely linked to this account.</p>
                <div className="lf-verified-license"><CheckCircle2 size={16} /><span><small>VERIFIED SHOP LICENSE</small><strong>{licenseKey}</strong></span><span className="lf-active-pill">ACTIVE</span></div>
                <form className="lf-form lf-signup-form" onSubmit={submitAccount}>
                  <label htmlFor="signup-email">SHOP EMAIL ADDRESS</label>
                  <div className="lf-input-wrap"><Mail size={17} /><input id="signup-email" type="email" placeholder="you@yourprintshop.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
                  <label htmlFor="signup-password">CREATE PASSWORD <span>12 CHARACTERS MINIMUM</span></label>
                  <div className="lf-input-wrap"><LockKeyhole size={17} /><input id="signup-password" type="password" placeholder="Create a strong password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></div>
                  <label htmlFor="confirm-password">CONFIRM PASSWORD</label>
                  <div className="lf-input-wrap"><LockKeyhole size={17} /><input id="confirm-password" type="password" placeholder="Enter your password again" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required /></div>
                  {formMessage && <div className="lf-form-message" role="status">{formMessage}</div>}
                  <button className="lf-primary" type="submit">Create shop account <ArrowRight size={16} /></button>
                </form>
                <div className="lf-privacy-note"><ShieldCheck size={15} /> Print jobs and customer files remain separate from your account.</div>
              </>
            )}

            {view === 'login' && (
              <>
                <button className="lf-back" type="button" onClick={() => resetFlow('license')}><ArrowLeft size={14} /> Back to shop access</button>
                <div className="lf-step-line"><span className="lf-step-number">SIGN IN</span><span className="lf-step-rule" /><span className="lf-step-label">EXISTING SHOP</span></div>
                <h2>Welcome<br />back to work.</h2>
                <p className="lf-intro">Sign in with the email and password for your shop account.</p>
                <form className="lf-form lf-login-form" onSubmit={submitAccount}>
                  <label htmlFor="login-email">EMAIL ADDRESS</label>
                  <div className="lf-input-wrap"><Mail size={17} /><input id="login-email" type="email" placeholder="you@yourprintshop.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
                  <label htmlFor="login-password">PASSWORD</label>
                  <div className="lf-input-wrap"><LockKeyhole size={17} /><input id="login-password" type="password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
                  {formMessage && <div className="lf-form-message" role="status">{formMessage}</div>}
                  <button className="lf-primary" type="submit">Sign in to your shop <ArrowRight size={16} /></button>
                </form>
                <div className="lf-separate-login lf-login-bottom"><span>Setting up a new shop?</span><button type="button" onClick={() => resetFlow('license')}>Enter a license key <ArrowRight size={14} /></button></div>
              </>
            )}

            {view === 'request' && (
              <>
                <button className="lf-back" type="button" onClick={() => resetFlow('license')}><ArrowLeft size={14} /> Back to license entry</button>
                <div className="lf-step-line"><span className="lf-step-number">REQUEST</span><span className="lf-step-rule" /><span className="lf-step-label">SHOP APPROVAL</span></div>
                {requestSent ? (
                  <div className="lf-request-success">
                    <span className="lf-success-icon"><CheckCircle2 size={25} /></span>
                    <h2>Request received.</h2>
                    <p>We’ll follow up with license information for <strong>{shopName || 'your shop'}</strong> at <strong>{requestEmail}</strong>.</p>
                    <button className="lf-primary" type="button" onClick={() => { setRequestSent(false); resetFlow('license'); }}>Return to access <ArrowRight size={16} /></button>
                  </div>
                ) : (
                  <>
                    <h2>Get your shop<br />license started.</h2>
                    <p className="lf-intro">Tell us where to reach you. Our team will follow up about approval and setup.</p>
                    <form className="lf-form lf-request-form" onSubmit={submitRequest}>
                      <label htmlFor="request-name">YOUR NAME</label>
                      <div className="lf-input-wrap"><input id="request-name" placeholder="Full name" value={requestName} onChange={(event) => setRequestName(event.target.value)} required /></div>
                      <label htmlFor="request-email">WORK EMAIL</label>
                      <div className="lf-input-wrap"><Mail size={17} /><input id="request-email" type="email" placeholder="you@yourprintshop.com" value={requestEmail} onChange={(event) => setRequestEmail(event.target.value)} required /></div>
                      <label htmlFor="shop-name">SHOP NAME</label>
                      <div className="lf-input-wrap"><Store size={17} /><input id="shop-name" placeholder="e.g. Riverside Copy & Print" value={shopName} onChange={(event) => setShopName(event.target.value)} required /></div>
                      <button className="lf-primary" type="submit">Request a license <ArrowRight size={16} /></button>
                    </form>
                    <div className="lf-privacy-note"><LockKeyhole size={14} /> Your details are used only to respond to this request.</div>
                  </>
                )}
              </>
            )}
          </div>

          <footer className="lf-main-footer">
            <span>WINDOWS PDF STUDIO <b>·</b> SHOP ACCESS</span>
            <span className="lf-install-id">INSTALLATION <strong>WPS-D5F0F68-D1F1</strong></span>
          </footer>
        </section>
      </div>
    </main>
  );
}
