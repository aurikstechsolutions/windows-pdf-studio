import { useState } from 'react';
import { Activity, FileText, KeyRound, LockKeyhole, Monitor } from 'lucide-react';
import './_group.css';

export function Current() {
  const [mode, setMode] = useState<'new' | 'existing'>('new');

  return (
    <main className="extract-access">
      <div className="extract-brand">
        <span className="extract-brand-mark"><FileText size={16} /></span>
        <span>Windows PDF Studio<small>Secure shop access</small></span>
      </div>
      <div className="extract-wrap">
        <header className="extract-heading">
          <div className="extract-eyebrow">Shop access</div>
          <h1>Sign in to Windows PDF Studio.</h1>
          <p>The document workspace opens after this installation is connected to its licensed shop account.</p>
        </header>
        <div className="extract-grid">
          <section className="extract-card">
            <h2><KeyRound size={15} /> Shop account</h2>
            <div className="extract-tabs" role="tablist">
              <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>New shop</button>
              <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Existing shop</button>
            </div>
            {mode === 'new' && <div className="extract-field"><label>APPROVED LICENSE KEY</label><input placeholder="Enter the shop license key" /></div>}
            <div className="extract-field"><label>EMAIL ADDRESS</label><input placeholder="you@example.com" /></div>
            <div className="extract-field"><label>PASSWORD {mode === 'new' ? '· 12 CHARACTERS MINIMUM' : ''}</label><input type="password" /></div>
            {mode === 'new' && <div className="extract-field"><label>CONFIRM PASSWORD</label><input type="password" /></div>}
            <button className="extract-button primary">{mode === 'new' ? 'Create shop account' : 'Sign in'}</button>
            <div className="extract-id"><span>Installation ID</span><strong>wps-d5f0f68-d1f1-…</strong></div>
          </section>
          <section className="extract-card">
            <h2><Monitor size={15} /> Request a license</h2>
            <p>If you do not have an approved license yet, send a request for this installation.</p>
            <div className="extract-field"><label>YOUR NAME</label><input placeholder="Full name" /></div>
            <div className="extract-field"><label>EMAIL ADDRESS</label><input placeholder="you@example.com" /></div>
            <div className="extract-field"><label>SHOP / DEVICE NAME</label><input placeholder="e.g. Central Market Xerox" /></div>
            <button className="extract-button primary">Request license</button>
            <div className="extract-notice"><LockKeyhole size={12} /> Customer print jobs remain separate from shop account details.</div>
          </section>
          <section className="extract-card extract-service">
            <h2><Activity size={15} /> License service connection</h2>
            <p>Connect this shop app to the published Windows PDF Studio service. PDF viewing and printing work locally without this connection.</p>
            <div className="extract-field"><label>PUBLISHED APP ADDRESS</label><input placeholder="https://your-published-app.replit.app" /></div>
            <button className="extract-button">Save service address</button>
          </section>
        </div>
      </div>
    </main>
  );
}
