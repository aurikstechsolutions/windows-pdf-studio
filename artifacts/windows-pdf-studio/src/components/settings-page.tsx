import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CheckCircle2, IndianRupee, LoaderCircle, Mail, Settings2 } from 'lucide-react';
import {
  getGetMyPrintShopQueryKey,
  useGetMyPrintShop,
  useSaveMyPrintShop,
} from '@workspace/api-client-react';
import EmailSettingsPage from '@/components/email-settings-page';
import './settings-page.css';

type Notice = { kind: 'success' | 'error'; text: string };

function PriceSettings({ apiReady }: { apiReady: boolean }) {
  const queryClient = useQueryClient();
  const profileQuery = useGetMyPrintShop({
    query: { enabled: apiReady, queryKey: getGetMyPrintShopQueryKey() },
  });
  const saveShop = useSaveMyPrintShop();
  const shop = profileQuery.data?.shop ?? null;
  const [bwRate, setBwRate] = useState('');
  const [colorRate, setColorRate] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!shop) return;
    setBwRate((shop.bwRatePaise / 100).toFixed(2));
    setColorRate((shop.colorRatePaise / 100).toFixed(2));
  }, [shop?.id]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!shop) return;
    const bw = Number(bwRate);
    const color = Number(colorRate);
    if (!Number.isFinite(bw) || !Number.isFinite(color) || bw < 0 || color < 0 || bw > 1000 || color > 1000) {
      setNotice({ kind: 'error', text: 'Enter a price from ₹0 to ₹1,000 for each page type.' });
      return;
    }

    setNotice(null);
    saveShop.mutate({
      data: {
        shopName: shop.shopName,
        phone: shop.phone,
        whatsappPhone: shop.whatsappPhone,
        address: shop.address,
        city: shop.city,
        acceptingOrders: shop.acceptingOrders,
        bwRatePaise: Math.round(bw * 100),
        colorRatePaise: Math.round(color * 100),
      },
    }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetMyPrintShopQueryKey() });
        setNotice({ kind: 'success', text: 'Prices saved. New customer estimates will use these rates.' });
      },
      onError: (error) => setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Prices could not be saved. Try again.',
      }),
    });
  };

  return <section className="panel settings-card settings-pricing-card" aria-labelledby="settings-pricing-heading">
    <div className="settings-card-heading">
      <span className="settings-card-icon"><IndianRupee size={18}/></span>
      <div><div className="settings-kicker">SHOP PRICING</div><h2 id="settings-pricing-heading">Price per page</h2></div>
    </div>
    <p className="settings-card-description">These rates are used to estimate new customer uploads. Existing quotes are not changed.</p>
    {!apiReady
      ? <div className="settings-callout">Connect this installation to its shop service to update prices.</div>
      : profileQuery.isLoading
        ? <div className="settings-loading">Loading shop prices…</div>
        : profileQuery.isError
          ? <div className="settings-callout error" role="alert">Shop prices could not be loaded. Refresh and try again.</div>
          : !shop
            ? <div className="settings-callout">Set up your shop before changing prices. <Link href="/shop">Open QR Uploads</Link></div>
            : <form className="settings-price-form" onSubmit={save}>
              <label className="settings-rate-field">
                <span>B&amp;W printing</span>
                <span className="settings-rate-input"><span aria-hidden="true">₹</span><input
                  type="number" min="0" max="1000" step="0.01" inputMode="decimal" required
                  value={bwRate} onChange={(event) => { setBwRate(event.target.value); setNotice(null); }}
                  disabled={saveShop.isPending} aria-label="Black and white price per page" data-testid="input-settings-bw-rate"
                /></span>
                <small>Price for each black-and-white page</small>
              </label>
              <label className="settings-rate-field">
                <span>Colour printing</span>
                <span className="settings-rate-input"><span aria-hidden="true">₹</span><input
                  type="number" min="0" max="1000" step="0.01" inputMode="decimal" required
                  value={colorRate} onChange={(event) => { setColorRate(event.target.value); setNotice(null); }}
                  disabled={saveShop.isPending} aria-label="Colour price per page" data-testid="input-settings-colour-rate"
                /></span>
                <small>Price for each colour page</small>
              </label>
              {notice && <div className={`settings-feedback ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
                {notice.kind === 'success' && <CheckCircle2 size={16}/>}<span>{notice.text}</span>
              </div>}
              <div className="settings-actions">
                <span className="settings-rate-shop">Prices apply to {shop.shopName}.</span>
                <button type="submit" className="tool-btn primary" disabled={saveShop.isPending} data-testid="button-save-settings-prices">
                  {saveShop.isPending ? <LoaderCircle className="settings-spin" size={15}/> : <Settings2 size={15}/>}
                  {saveShop.isPending ? 'Saving…' : 'Save prices'}
                </button>
              </div>
            </form>}
  </section>;
}

export function SettingsPage({ apiReady, onOpenInbox }: { apiReady: boolean; onOpenInbox: () => void }) {
  return <main className="page-wrap settings-page">
    <PriceSettings apiReady={apiReady}/>
    <section className="settings-email-section" aria-labelledby="settings-email-heading">
      <div className="settings-email-heading">
        <span className="settings-card-icon"><Mail size={18}/></span>
        <div><div className="settings-kicker">EMAIL</div><h2 id="settings-email-heading">Email settings</h2></div>
      </div>
      <EmailSettingsPage onOpenInbox={onOpenInbox} embedded/>
    </section>
  </main>;
}
