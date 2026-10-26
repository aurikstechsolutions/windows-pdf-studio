import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { PaginationControls } from '@/components/pagination-controls';
import {
  getGetMyPrintShopQueryKey,
  getListMyShopPrintRequestsQueryKey,
  getGetPrintShopRequestTrackingQueryKey,
  getDownloadMyShopRequestFileQueryKey,
  getGetPublicPrintShopQueryKey,
  useGetMyPrintShop,
  useListMyShopPrintRequests,
  useSaveMyPrintShop,
  useUpdateMyShopPrintRequest,
  useDownloadMyShopRequestFile,
  useGetPublicPrintShop,
  useCreatePrintShopUpload,
  useSubmitPrintShopRequest,
  useGetPrintShopRequestTracking,
  useAcceptPrintShopQuote,
  type PrintShopProfileInput,
  type PrintShopRequestInput,
  type ShopPrintRequest,
  type PrintShopTracking,
  type PrintShopProfile,
} from '@workspace/api-client-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle, ArrowRight, BadgeCheck, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3,
  Copy, Download, FileImage, FileText, IndianRupee, LoaderCircle, LockKeyhole,
  MessageCircle, Printer, QrCode, RefreshCw, Send, ShieldCheck, Smartphone, Upload, X,
} from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './shop-portal-page.css';

type ShopOwnerPageProps = {
  apiReady: boolean;
  publicOrigin: string;
  onOpenFile: (file: File) => Promise<void>;
};

type CustomerUploadPageProps = { shopCode: string };
type RequestTrackingPageProps = { trackingCode: string };
type RequestStatus = ShopPrintRequest['status'];
type CustomerFormValues = {
  customerName: string;
  paperSize: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal';
  colorMode: 'bw' | 'color';
  sides: 'single' | 'double';
  copies: number;
  finishing: 'none' | 'staple' | 'bind';
  instructions: string;
  privacyAccepted: boolean;
};

const statuses: RequestStatus[] = ['received', 'quoted', 'approved', 'printing', 'ready', 'completed', 'cancelled'];
const statusLabels: Record<RequestStatus, string> = {
  received: 'Received', quoted: 'Price sent', approved: 'Approved', printing: 'Printing',
  ready: 'Ready for pickup', completed: 'Completed', cancelled: 'Cancelled',
};
const currency = (paise: number | null | undefined) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
}).format((paise ?? 0) / 100);
const compactDate = (value: string) => new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));
const prettySize = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const statusStep: Record<RequestStatus, number> = {
  received: 0, quoted: 1, approved: 2, printing: 3, ready: 4, completed: 5, cancelled: -1,
};
const allowedTransitions: Record<RequestStatus, RequestStatus[]> = {
  received: ['received', 'quoted', 'cancelled'],
  quoted: ['quoted', 'cancelled'],
  approved: ['approved', 'printing', 'cancelled'],
  printing: ['printing', 'ready', 'cancelled'],
  ready: ['ready', 'completed', 'printing'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

const profileSchema = z.object({
  shopName: z.string().trim().min(2, 'Enter at least 2 characters').max(100),
  phone: z.string().trim().min(7, 'Enter a valid shop phone').max(24),
  whatsappPhone: z.string().trim().min(7, 'Enter a WhatsApp number').max(24),
  address: z.string().max(240),
  city: z.string().trim().min(2, 'Enter your city').max(80),
  acceptingOrders: z.boolean(),
  bwRatePaise: z.coerce.number().min(0).max(100000),
  colorRatePaise: z.coerce.number().min(0).max(100000),
});
type ProfileValues = z.infer<typeof profileSchema>;
const customerFormSchema = z.object({
  customerName: z.string().trim().min(2, 'Enter at least 2 characters').max(100),
  paperSize: z.enum(['A4', 'A3', 'A5', 'Letter', 'Legal']),
  colorMode: z.enum(['bw', 'color']),
  sides: z.enum(['single', 'double']),
  copies: z.coerce.number().int().min(1).max(99),
  finishing: z.enum(['none', 'staple', 'bind']),
  instructions: z.string().max(500),
  privacyAccepted: z.boolean().refine((accepted) => accepted, 'Please acknowledge temporary file storage to continue.'),
});

function InlineNotice({ kind = 'info', children, testId }: { kind?: 'info' | 'error' | 'success'; children: ReactNode; testId: string }) {
  return <div className={`portal-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-testid={testId}>
    {kind === 'error' ? <AlertCircle size={16} /> : kind === 'success' ? <CheckCircle2 size={16} /> : <ShieldCheck size={16} />}
    <span>{children}</span>
  </div>;
}

function PortalHeader({ kicker, title, description, accessory }: { kicker: string; title: string; description: string; accessory?: React.ReactNode }) {
  return <header className="portal-heading">
    <div>
      <div className="portal-kicker">{kicker}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    {accessory && <div className="portal-heading-accessory">{accessory}</div>}
  </header>;
}

function TextField({
  label, id, value, onChange, placeholder, type = 'text', hint, testId, required,
}: {
  label: string; id: string; value: string | number; onChange: (value: string) => void;
  placeholder?: string; type?: string; hint?: string; testId: string; required?: boolean;
}) {
  return <label className="portal-field" htmlFor={id}>
    <span className="portal-label">{label}{required && <b aria-hidden="true"> *</b>}</span>
    <input id={id} type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder} required={required} className="portal-input" data-testid={testId} />
    {hint && <small>{hint}</small>}
  </label>;
}

function OwnerSkeleton() {
  return <main className="portal-page owner-page"><div className="portal-skeleton-heading"><i /><i /><i /></div>
    <div className="portal-owner-grid"><div className="portal-skeleton-card" /><div className="portal-skeleton-card" /><div className="portal-skeleton-card wide" /></div>
  </main>;
}

function ProfileEditor({ shop, onSaved }: { shop: PrintShopProfile | null; onSaved: () => void }) {
  const saveShop = useSaveMyPrintShop();
  const queryClient = useQueryClient();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: shop ? {
      shopName: shop.shopName, phone: shop.phone, whatsappPhone: shop.whatsappPhone,
      address: shop.address, city: shop.city, acceptingOrders: shop.acceptingOrders,
      bwRatePaise: shop.bwRatePaise / 100, colorRatePaise: shop.colorRatePaise / 100,
    } : {
      shopName: '', phone: '', whatsappPhone: '', address: '', city: '',
      acceptingOrders: true, bwRatePaise: 2, colorRatePaise: 10,
    },
  });
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!shop) return;
    form.reset({
      shopName: shop.shopName, phone: shop.phone, whatsappPhone: shop.whatsappPhone,
      address: shop.address, city: shop.city, acceptingOrders: shop.acceptingOrders,
      bwRatePaise: shop.bwRatePaise / 100, colorRatePaise: shop.colorRatePaise / 100,
    });
  }, [shop?.id, shop?.updatedAt, form.reset]);
  const save = (values: ProfileValues) => {
    setSaveError('');
    setSaved(false);
    const data: PrintShopProfileInput = {
      ...values, bwRatePaise: Math.round(Number(values.bwRatePaise) * 100),
      colorRatePaise: Math.round(Number(values.colorRatePaise) * 100),
    };
    saveShop.mutate({ data }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetMyPrintShopQueryKey() });
        setSaved(true);
        onSaved();
      },
      onError: (error) => setSaveError(errorText(error)),
    });
  };
  const accepting = form.watch('acceptingOrders');

  return <section className="portal-card profile-card" aria-labelledby="profile-heading">
    <div className="portal-card-head"><div><div className="portal-kicker">Shop details</div><h2 id="profile-heading">{shop ? 'Your counter profile' : 'Set up your shop'}</h2></div>
      {shop && <span className="license-bound"><LockKeyhole size={13} /> Bound to this installation</span>}</div>
    {!shop && <p className="portal-card-intro">One shop profile for this Windows license. Customers can send a job without an account.</p>}
    {shop && <p className="portal-card-intro">Update your counter details here. Change B&amp;W and colour page prices in Settings.</p>}
    <Form {...form}>
      <form onSubmit={form.handleSubmit(save)} className="profile-form">
        <FormField control={form.control} name="shopName" render={({ field }) => <FormItem className="portal-form-item">
          <FormLabel className="portal-label">Shop name</FormLabel><FormControl><input {...field} className="portal-input" placeholder="e.g. Shree Sai Prints" data-testid="input-shop-name" /></FormControl><FormMessage />
        </FormItem>} />
        <FormField control={form.control} name="city" render={({ field }) => <FormItem className="portal-form-item">
          <FormLabel className="portal-label">City</FormLabel><FormControl><input {...field} className="portal-input" placeholder="Pune" data-testid="input-shop-city" /></FormControl><FormMessage />
        </FormItem>} />
        <FormField control={form.control} name="phone" render={({ field }) => <FormItem className="portal-form-item">
          <FormLabel className="portal-label">Counter phone</FormLabel><FormControl><input {...field} className="portal-input" type="tel" placeholder="+91 98765 43210" data-testid="input-shop-phone" /></FormControl><FormMessage />
        </FormItem>} />
        <FormField control={form.control} name="whatsappPhone" render={({ field }) => <FormItem className="portal-form-item">
          <FormLabel className="portal-label">WhatsApp number</FormLabel><FormControl><input {...field} className="portal-input" type="tel" placeholder="+91 98765 43210" data-testid="input-shop-whatsapp" /></FormControl><FormMessage />
        </FormItem>} />
        <FormField control={form.control} name="address" render={({ field }) => <FormItem className="portal-form-item full">
          <FormLabel className="portal-label">Shop address</FormLabel><FormControl><input {...field} className="portal-input" placeholder="Street, landmark or area" data-testid="input-shop-address" /></FormControl><FormMessage />
        </FormItem>} />
        {!shop && <div className="portal-rate-box">
          <div><strong>Prices shown with your QR</strong><small>Set per-page rates here. The customer’s total is calculated from page count and copies before they submit. Optional finishing charges are separate.</small></div>
          <FormField control={form.control} name="bwRatePaise" render={({ field }) => <FormItem className="portal-form-item rate-item">
            <FormLabel className="portal-label">B&amp;W / page</FormLabel><FormControl><div className="rupee-input"><span>₹</span><input {...field} type="number" min="0" step="1" className="portal-input" data-testid="input-shop-bw-rate" /></div></FormControl><FormMessage />
          </FormItem>} />
          <FormField control={form.control} name="colorRatePaise" render={({ field }) => <FormItem className="portal-form-item rate-item">
            <FormLabel className="portal-label">Colour / page</FormLabel><FormControl><div className="rupee-input"><span>₹</span><input {...field} type="number" min="0" step="1" className="portal-input" data-testid="input-shop-color-rate" /></div></FormControl><FormMessage />
          </FormItem>} />
        </div>}
        <FormField control={form.control} name="acceptingOrders" render={({ field }) => <FormItem className="portal-form-item full">
          <div className="accept-switch-row"><div><strong>Accepting customer jobs</strong><small>{accepting ? 'Your QR link is open for new requests.' : 'The customer page will show that orders are paused.'}</small></div>
            <FormControl><button type="button" role="switch" aria-checked={field.value} onClick={() => field.onChange(!field.value)}
              className={`portal-switch ${field.value ? 'on' : ''}`} data-testid="switch-accepting-orders"><span /></button></FormControl>
          </div>
        </FormItem>} />
        {saveError && <InlineNotice kind="error" testId="status-profile-save-error">{saveError}</InlineNotice>}
        {saved && <InlineNotice kind="success" testId="status-profile-saved">Shop details saved to this installation.</InlineNotice>}
        <div className="profile-actions"><span className="portal-footnote">Changes apply to your permanent QR link.</span>
          <button className="portal-button primary" type="submit" disabled={saveShop.isPending} data-testid="button-save-shop">
            {saveShop.isPending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{saveShop.isPending ? 'Saving…' : shop ? 'Save shop details' : 'Create shop profile'}
          </button>
        </div>
      </form>
    </Form>
  </section>;
}

function QrPanel({ shopCode, publicOrigin }: { shopCode: string; publicOrigin: string }) {
  const [copied, setCopied] = useState(false);
  const sendUrl = `${publicOrigin.replace(/\/$/, '')}/send/${encodeURIComponent(shopCode)}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(sendUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  };
  return <section className="portal-card qr-card" aria-labelledby="qr-title">
    <div className="portal-card-head"><div><div className="portal-kicker">One QR. Every customer.</div><h2 id="qr-title">Your permanent counter code</h2></div><span className="live-mark"><i /> Permanent</span></div>
    <p className="portal-card-intro">Keep this beside the register. No customer account, app install or changing link.</p>
    <div className="qr-sheet" data-testid="panel-permanent-qr">
      <div className="qr-identity"><div className="qr-monogram">P</div><span>PRINT REQUEST</span></div>
      <QRCodeSVG value={sendUrl} size={170} level="M" marginSize={2} title={`QR code for ${shopCode}`} data-testid="image-shop-qr" />
      <strong>{shopCode}</strong><span className="qr-sheet-caption">SCAN TO SEND A PRINT JOB</span>
    </div>
    <div className="qr-url" title={sendUrl} data-testid="text-shop-public-url"><span><LockKeyhole size={13} />{sendUrl}</span>
      <button type="button" className="icon-action" onClick={() => void copyLink()} aria-label="Copy customer link" data-testid="button-copy-shop-link">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
    </div>
    <div className="qr-actions">
      <button type="button" className="portal-button secondary" onClick={() => window.print()} data-testid="button-print-qr"><Printer size={15} /> Print QR sheet</button>
      <button type="button" className="portal-button quiet" onClick={() => void copyLink()} data-testid="button-copy-qr-link">{copied ? 'Link copied' : 'Copy link'}</button>
    </div>
    <p className="portal-footnote">Print the QR sheet, place it at the counter, and leave it there.</p>
  </section>;
}

function DownloadRequestFile({ requestId, file, onOpenFile }: { requestId: string; file: ShopPrintRequest['files'][number]; onOpenFile: (file: File) => Promise<void> }) {
  const [error, setError] = useState('');
  const fileQuery = useDownloadMyShopRequestFile(requestId, file.id, {
    query: { enabled: false, queryKey: getDownloadMyShopRequestFileQueryKey(requestId, file.id) },
  });
  const openFile = async () => {
    setError('');
    try {
      const result = await fileQuery.refetch();
      if (!result.data) throw result.error ?? new Error('The file could not be downloaded.');
      await onOpenFile(new File([result.data], file.name, { type: file.mimeType || result.data.type || 'application/octet-stream' }));
    } catch (issue) { setError(errorText(issue)); }
  };
  return <>
    <div className="request-file" data-testid={`file-request-${file.id}`}>
      <div className="file-icon">{file.mimeType.startsWith('image/') ? <FileImage size={16} /> : <FileText size={16} />}</div>
      <div className="file-metadata"><strong title={file.name}>{file.name}</strong><span>{file.pageCount} {file.pageCount === 1 ? 'page' : 'pages'} · {prettySize(file.sizeBytes)}</span></div>
      <button type="button" className="file-open-button" disabled={fileQuery.isFetching}
        onClick={() => void openFile()} data-testid={`button-open-request-file-${file.id}`}>
        {fileQuery.isFetching ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}<span>{fileQuery.isFetching ? 'Opening' : 'Open / print'}</span>
      </button>
    </div>
    {error && <InlineNotice kind="error" testId={`status-request-file-error-${file.id}`}>{error}</InlineNotice>}
    {fileQuery.isFetching && <span className="sr-only" aria-live="polite">Opening {file.name}</span>}
  </>;
}

function OwnerRequestCard({ request, onOpenFile }: {
  request: ShopPrintRequest;
  onOpenFile: (file: File) => Promise<void>;
}) {
  const [quote, setQuote] = useState(request.quoteTotalPaise === null ? '' : (request.quoteTotalPaise / 100).toFixed(2));
  const [message, setMessage] = useState(request.publicMessage ?? '');
  const [nextStatus, setNextStatus] = useState<RequestStatus>(request.status);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const update = useUpdateMyShopPrintRequest();
  const needsManualPrice = request.status === 'received';
  useEffect(() => {
    setQuote(request.quoteTotalPaise === null ? '' : (request.quoteTotalPaise / 100).toFixed(2));
    setMessage(request.publicMessage ?? '');
    setNextStatus(request.status);
  }, [request.id, request.updatedAt]);
  const saveRequest = () => {
    setError(''); setSaved(false);
    const quoteTotalPaise = quote.trim() === '' ? null : Math.round(Number(quote) * 100);
    if (quote.trim() !== '' && (!Number.isFinite(quoteTotalPaise) || quoteTotalPaise! < 0)) {
      setError('Enter a valid customer price.'); return;
    }
    if (nextStatus === 'quoted' && quoteTotalPaise === null && request.quoteTotalPaise === null) {
      setError('Enter a customer price before sharing it.'); return;
    }
    update.mutate({ requestId: request.id, data: { status: nextStatus, quoteTotalPaise, publicMessage: message.trim() || null } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListMyShopPrintRequestsQueryKey() });
        setSaved(true);
      }, onError: (issue) => setError(errorText(issue)),
    });
  };
  const customerWhatsapp = request.customerPhone ? `https://wa.me/${request.customerPhone.replace(/\D/g, '')}` : '';
  return <article className="request-card" data-testid={`card-request-${request.id}`}>
    <div className="request-card-top">
      <div className="request-person"><span className="request-avatar">{request.customerName.slice(0, 1).toUpperCase()}</span><div>
        <strong data-testid={`text-request-customer-${request.id}`}>{request.customerName}</strong>
        <span>{request.customerPhone ? `${request.customerPhone} · ` : ''}{compactDate(request.createdAt)}</span>
      </div></div>
      <span className={`request-status status-${request.status}`} data-testid={`status-request-${request.id}`}>{statusLabels[request.status]}</span>
    </div>
    <div className="request-specs">
      <span><FileText size={13} />{request.files.length} {request.files.length === 1 ? 'file' : 'files'}</span>
      <span>{request.paperSize}</span><span>{request.colorMode === 'bw' ? 'B&W' : 'Colour'}</span>
      <span>{request.sides === 'double' ? 'Double-sided' : 'Single-sided'}</span><span>{request.copies} {request.copies === 1 ? 'copy' : 'copies'}</span>
      {request.finishing !== 'none' && <span>{request.finishing === 'bind' ? 'Binding' : 'Staple'}</span>}
    </div>
    {request.instructions && <p className="request-instructions">{request.instructions}</p>}
    <div className="request-files" aria-label="Customer files">
      {request.files.map((file) => <DownloadRequestFile requestId={request.id} file={file} key={file.id} onOpenFile={onOpenFile} />)}
    </div>
    {request.quoteTotalPaise !== null && <div className="request-quote"><span>Calculated customer price</span><strong>{currency(request.quoteTotalPaise)}</strong></div>}
    {needsManualPrice && <div className="legacy-price-notice">This older request needs a price before the customer can approve it.</div>}
    <div className={`request-manage ${needsManualPrice ? 'needs-price' : ''}`}>
      {needsManualPrice && <label className="portal-field quote-field"><span className="portal-label">Price for the customer</span>
        <div className="rupee-input"><span>₹</span><input type="number" min="0" step=".01" value={quote} onChange={(event) => setQuote(event.currentTarget.value)}
          className="portal-input" placeholder="0.00" data-testid={`input-quote-${request.id}`} /></div>
      </label>}
      <label className="portal-field message-field"><span className="portal-label">Note to customer</span>
        <input value={message} onChange={(event) => setMessage(event.currentTarget.value)} maxLength={500} className="portal-input"
          placeholder="Optional pickup or print details" data-testid={`input-request-note-${request.id}`} />
      </label>
      <label className="portal-field status-field"><span className="portal-label">Job status</span>
        <div className="select-wrap"><select value={nextStatus} onChange={(event) => setNextStatus(event.currentTarget.value as RequestStatus)}
          disabled={update.isPending} className="portal-input" aria-label={`Update status for ${request.customerName}`} data-testid={`select-request-status-${request.id}`}>
          {allowedTransitions[request.status].map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
        </select><ChevronDown size={14} /></div>
      </label>
      <button className="portal-button primary save-request-button" type="button" disabled={update.isPending}
        onClick={saveRequest} data-testid={`button-save-request-${request.id}`}>
        {update.isPending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{needsManualPrice && nextStatus === 'quoted' ? 'Share price' : 'Save update'}
      </button>
    </div>
    {error && <InlineNotice kind="error" testId={`status-request-error-${request.id}`}>{error}</InlineNotice>}
    {saved && <span className="request-saved" data-testid={`status-request-saved-${request.id}`}><CheckCircle2 size={13} /> Customer tracking page updated</span>}
    {customerWhatsapp && <a className="request-contact" href={customerWhatsapp} target="_blank" rel="noreferrer" data-testid={`link-whatsapp-${request.id}`}><MessageCircle size={14} /> Message customer on WhatsApp</a>}
  </article>;
}

export function ShopOwnerPage({ apiReady, publicOrigin, onOpenFile }: ShopOwnerPageProps) {
  const shopQuery = useGetMyPrintShop({ query: { enabled: apiReady, queryKey: getGetMyPrintShopQueryKey() } });
  const queryClient = useQueryClient();
  const [qrOpen, setQrOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | RequestStatus>('all');
  const [page, setPage] = useState(1);
  const requestParams = useMemo(() => ({ page, pageSize: 10, ...(filter === 'all' ? {} : { status: filter }) }), [filter, page]);
  const pendingApprovalParams = useMemo(() => ({ page: 1, pageSize: 1, status: 'quoted' as RequestStatus }), []);
  const shop = shopQuery.data?.shop ?? null;
  const queueEnabled = apiReady && !!shop;
  const requestsQuery = useListMyShopPrintRequests(requestParams, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(requestParams), refetchInterval: 18_000 },
  });
  const pendingApprovalQuery = useListMyShopPrintRequests(pendingApprovalParams, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(pendingApprovalParams), refetchInterval: 18_000 },
  });
  useEffect(() => {
    if (shop) void queryClient.invalidateQueries({ queryKey: getListMyShopPrintRequestsQueryKey() });
  }, [shop?.id, queryClient]);
  useEffect(() => {
    const totalPages = requestsQuery.data?.totalPages;
    if (totalPages !== undefined && page > Math.max(1, totalPages)) setPage(Math.max(1, totalPages));
  }, [page, requestsQuery.data?.totalPages]);

  if (!apiReady) return <main className="portal-page owner-page">
    <PortalHeader kicker="QR uploads · Windows PDF Studio" title="Connect your licensed shop"
      description="The shop portal uses the active shop license and service connection for this installation." />
    <section className="portal-card api-connection-card" data-testid="panel-api-connection-required">
      <div className="api-connection-icon"><LockKeyhole size={19} /></div>
      <div className="portal-kicker">SETUP REQUIRED</div><h2>Activate this shop license to connect.</h2>
      <p>Open the License page to activate this installation and set the API origin. Your shop profile stays bound to this device; no separate portal login is needed.</p>
      <Link className="portal-button primary" href="/licenses" data-testid="link-api-connection-license">Go to License settings <ArrowRight size={15} /></Link>
    </section>
  </main>;
  if (shopQuery.isLoading) return <OwnerSkeleton />;
  if (shopQuery.isError) return <main className="portal-page owner-page"><InlineNotice kind="error" testId="status-shop-load-error">{errorText(shopQuery.error)}</InlineNotice>
    <button className="portal-button secondary" onClick={() => void shopQuery.refetch()} data-testid="button-retry-shop"><RefreshCw size={15} /> Try again</button></main>;

  const requests = requestsQuery.data?.items ?? [];
  const requestsTotal = requestsQuery.data?.total ?? 0;
  const awaitingApproval = pendingApprovalQuery.data?.total ?? 0;
  const changeFilter = (nextFilter: 'all' | RequestStatus) => {
    setFilter(nextFilter);
    setPage(1);
  };
  return <main className="portal-page owner-page">
    {!shop && <PortalHeader kicker="QR uploads · Windows PDF Studio" title="Bring your counter online"
      description="Set up once. Customers scan your QR, send a print job and track it without an account." />}
    {!shop && <div className="setup-banner"><div className="setup-mark"><Smartphone size={20} /></div><div><strong>One shop. One active license.</strong><p>Your shop profile and permanent customer QR stay attached to this active license.</p></div><span>SETUP · 01</span></div>}
    <div className={`portal-owner-grid ${shop ? 'owner-queue-only' : ''}`}>
      <div className="portal-owner-main">
        {!shop && <ProfileEditor shop={null} onSaved={() => { void shopQuery.refetch(); }} />}
        {shop && <section className="portal-card queue-card" aria-labelledby="queue-title">
          <div className="portal-card-head queue-head"><div><div className="portal-kicker">Customer print requests</div><h2 id="queue-title">Print jobs <span className="queue-total">{requestsTotal}</span></h2></div>
            <div className="queue-head-actions">
              {awaitingApproval > 0 && <span className="attention-count">{awaitingApproval} awaiting approval</span>}
              <button type="button" className="portal-button secondary show-qr-button" onClick={() => setQrOpen(true)} data-testid="button-open-shop-qr">
                <QrCode size={15} /> Show shop QR
              </button>
            </div>
          </div>
          {requestsQuery.isLoading ? <div className="request-skeletons" aria-label="Loading request queue" data-testid="loading-request-queue"><i /><i /><i /></div>
            : requestsQuery.isError ? <div className="queue-error"><InlineNotice kind="error" testId="status-request-list-error">{errorText(requestsQuery.error)}</InlineNotice>
              <button type="button" className="portal-button secondary" onClick={() => void requestsQuery.refetch()} data-testid="button-retry-requests"><RefreshCw size={14} /> Retry queue</button></div>
            : requestsTotal === 0 && filter === 'all' ? <div className="queue-empty" data-testid="empty-request-queue"><div className="empty-stamp"><FileText size={21} /></div><h3>Your job queue is clear.</h3><p>Customer submissions from your QR will arrive here, separate from your local documents.</p></div>
              : <>
                <div className="queue-filter-row">
                  <div className="queue-status-filters" role="group" aria-label="Filter print jobs by status">
                    <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'}
                      onClick={() => changeFilter('all')} data-testid="button-filter-jobs-all">All jobs</button>
                    {statuses.map((status) => <button type="button" key={status} className={filter === status ? 'active' : ''}
                      aria-pressed={filter === status} onClick={() => changeFilter(status)} data-testid={`button-filter-jobs-${status}`}>
                      {statusLabels[status]}
                    </button>)}
                  </div>
                  <span className="queue-refresh-note">Updates automatically every 18 seconds</span>
                </div>
                  {requests.length ? <div className="request-list">{requests.map((request) => <OwnerRequestCard request={request} key={request.id} onOpenFile={onOpenFile} />)}</div>
                  : <div className="queue-empty filtered-empty" data-testid="empty-filtered-requests"><p>No jobs in this status.</p><button type="button" onClick={() => changeFilter('all')} data-testid="button-clear-request-filter">Show all jobs</button></div>}
                <PaginationControls page={page} pageSize={10} total={requestsTotal} itemLabel="print requests" onPageChange={setPage} />
              </>}
        </section>}
      </div>
      {!shop && <aside className="portal-owner-side">
        <section className="portal-card qr-placeholder">
          <div className="portal-kicker">Your next step</div><div className="placeholder-qr"><span /></div><h2>Your QR is created with your profile</h2><p>Save your shop details and your permanent code will appear here.</p>
        </section>
        <section className="reassurance-card"><div className="reassurance-icon"><ShieldCheck size={17} /></div><div><strong>Built for the counter</strong><p>Customers don’t need an account. Their uploaded files are temporary and linked only to a job.</p></div></section>
      </aside>}
    </div>
    {shop && <Dialog open={qrOpen} onOpenChange={setQrOpen}>
      <DialogContent className="shop-qr-dialog" data-testid="dialog-shop-qr"
        onPointerDown={(event) => { if (event.target === event.currentTarget) setQrOpen(false); }}>
        <div className="shop-qr-modal-panel">
          <DialogTitle className="sr-only">Your permanent shop QR code</DialogTitle>
          <DialogClose className="shop-qr-close" aria-label="Close shop QR dialog"><X size={15}/></DialogClose>
          <QrPanel shopCode={shop.shopCode} publicOrigin={publicOrigin} />
        </div>
      </DialogContent>
    </Dialog>}
  </main>;
}

type SelectedFile = { id: string; file: File; mimeType: string; previewUrl?: string; pageCount: number | null; pageError?: string };
const allowedMime = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const maxEach = 25 * 1024 * 1024;
const maxTotal = 80 * 1024 * 1024;
const inferMime = (file: File) => file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' :
  /\.(jpe?g)$/i.test(file.name) ? 'image/jpeg' : /\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : '');

function FullDocumentPreview({ file, pageNumber }: { file: File; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [previewWidth, setPreviewWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setLoadError('');
    setRendering(true);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        task = pdfjs.getDocument({ data: await file.arrayBuffer() });
        const loaded = await task.promise;
        if (!cancelled) setPdf(loaded);
      } catch {
        if (!cancelled) {
          setLoadError('This PDF could not be opened. Go back and choose another file.');
          setRendering(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [file]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const measure = () => setPreviewWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current || previewWidth < 1) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    setRendering(true);
    setLoadError('');
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.8, Math.max(.1, (previewWidth - 32) / baseViewport.width));
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is not available.');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setRendering(false);
      } catch {
        if (!cancelled) {
          setLoadError('This page could not be displayed. Try another page or file.');
          setRendering(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, previewWidth]);

  return <div className="full-document-preview" ref={previewRef}>
    {rendering && <span className="full-document-loading"><LoaderCircle className="spin" size={18} /> Loading page {pageNumber}…</span>}
    {loadError && <span className="full-document-error">{loadError}</span>}
    <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
  </div>;
}

export function CustomerUploadPage({ shopCode }: CustomerUploadPageProps) {
  const shopQuery = useGetPublicPrintShop(shopCode, { query: { queryKey: getGetPublicPrintShopQueryKey(shopCode), retry: false } });
  const uploadMutation = useCreatePrintShopUpload();
  const submitMutation = useSubmitPrintShopRequest();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [fileError, setFileError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [activeReviewFileId, setActiveReviewFileId] = useState('');
  const [reviewPage, setReviewPage] = useState(1);
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof submitMutation.mutateAsync>> | null>(null);
  const customerForm = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    mode: 'onChange',
    defaultValues: {
      customerName: '', paperSize: 'A4', colorMode: 'bw',
      sides: 'single', copies: 1, finishing: 'none', instructions: '', privacyAccepted: false,
    },
  });
  const values = customerForm.watch();
  const shop = shopQuery.data;
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);
  const allPagesKnown = files.every((item) => item.pageCount !== null && !item.pageError);
  const pages = files.reduce((sum, item) => sum + (item.pageCount ?? 0), 0);
  const calculatedPricePaise = pages * values.copies * (values.colorMode === 'color' ? shop?.colorRatePaise ?? 0 : shop?.bwRatePaise ?? 0);
  const activeReviewFile = files.find((item) => item.id === activeReviewFileId) ?? files[0];
  const canSubmit = !!shop?.acceptingOrders && !!files.length && allPagesKnown && customerForm.formState.isValid
    && values.privacyAccepted && !isSending && !submitMutation.isPending && !uploadMutation.isPending;

  const currentFilesRef = useRef(files);
  currentFilesRef.current = files;
  useEffect(() => () => currentFilesRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl)), []);

  const inspectFile = async (file: File): Promise<{ pageCount: number; previewUrl?: string; pageError?: string }> => {
    if (inferMime(file) !== 'application/pdf') return { pageCount: 1 };
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      let previewUrl: string | undefined;
      if (pdf.numPages > 0) {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: .22 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (context) {
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          previewUrl = canvas.toDataURL('image/jpeg', .72);
        }
      }
      return { pageCount: pdf.numPages, previewUrl, pageError: pdf.numPages > 1000 ? 'PDFs are limited to 1,000 pages per file.' : undefined };
    } catch { return { pageCount: 1, pageError: 'Could not read this PDF. Remove it and try a different copy.' }; }
  };
  const addFiles = (incoming: FileList | File[]) => {
    setFileError('');
    const batch = Array.from(incoming);
    const next: SelectedFile[] = [];
    let currentSize = totalBytes;
    for (const file of batch) {
      const mime = inferMime(file);
      if (!allowedMime.includes(mime)) { setFileError(`${file.name}: choose a PDF, JPEG, PNG or WEBP file.`); continue; }
      if (file.size > maxEach) { setFileError(`${file.name} is over the 25 MB per-file limit.`); continue; }
      if (files.length + next.length >= 5) { setFileError('A request can include up to 5 files.'); break; }
      if (currentSize + file.size > maxTotal) { setFileError('The combined file size cannot exceed 80 MB.'); continue; }
      currentSize += file.size;
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = mime.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const item: SelectedFile = { id, file, mimeType: mime, previewUrl, pageCount: null };
      next.push(item);
      void inspectFile(file).then((result) => setFiles((current) => current.map((entry) => entry.id === id ? { ...entry, ...result } : entry)));
    }
    setFiles((current) => [...current, ...next]);
    if (inputRef.current) inputRef.current.value = '';
  };
  const removeFile = (id: string) => {
    const item = files.find((entry) => entry.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setFiles((current) => current.filter((entry) => entry.id !== id));
  };
  const updateValue = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) => {
    customerForm.setValue(key, value as never, { shouldDirty: true, shouldValidate: true });
  };
  const sendRequest = async (formValues: CustomerFormValues) => {
    if (!canSubmit || !shop) return;
    setReviewOpen(false);
    setUploadError('');
    setUploadProgress('Preparing secure upload…');
    setIsSending(true);
    try {
      const ticketIds: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const item = files[index];
        setUploadProgress(`Uploading file ${index + 1} of ${files.length}…`);
        const ticket = await uploadMutation.mutateAsync({
          shopCode,
          data: { name: item.file.name, sizeBytes: item.file.size, contentType: item.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp', pageCount: item.pageCount ?? 1 },
        });
        const response = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': item.mimeType }, body: item.file });
        if (!response.ok) throw new Error(`Upload failed for ${item.file.name}. Please try again.`);
        ticketIds.push(ticket.ticketId);
      }
      setUploadProgress('Sending your request…');
      const data: PrintShopRequestInput = {
        customerName: formValues.customerName.trim(),
        uploadTicketIds: ticketIds, paperSize: formValues.paperSize,
        colorMode: formValues.colorMode, sides: formValues.sides,
        copies: Number(formValues.copies), finishing: formValues.finishing,
        instructions: formValues.instructions.trim(),
      };
      const result = await submitMutation.mutateAsync({ shopCode, data });
      setReceipt(result);
    } catch (error) {
      setUploadError(errorText(error));
      setReviewOpen(true);
    }
    finally {
      setUploadProgress('');
      setIsSending(false);
    }
  };

  if (shopQuery.isLoading) return <main className="public-page"><section className="public-skeleton"><i /><i /><i /><i /></section></main>;
  if (shopQuery.isError || !shop) return <main className="public-page"><div className="public-error"><div className="public-error-mark"><AlertCircle size={22} /></div>
    <div className="portal-kicker">SHOP LINK NOT AVAILABLE</div><h1>We couldn’t open this shop.</h1><p>This QR link may be incorrect or temporarily unavailable.</p>
    <button type="button" className="portal-button secondary" onClick={() => void shopQuery.refetch()} data-testid="button-retry-public-shop"><RefreshCw size={15} /> Try again</button>
  </div></main>;

  if (receipt) return <main className="public-page"><div className="public-topline"><div className="public-brand"><span className="public-brand-mark">P</span><span>PRINT REQUEST</span></div><span className="guest-badge"><CheckCircle2 size={12} /> Request sent</span></div>
    <section className="receipt-panel receipt-panel-compact" data-testid="panel-upload-confirmation">
      <div className="portal-kicker">ORDER RECEIVED BY {receipt.shopName.toUpperCase()}</div><h1>Print request sent</h1>
      <div className="tracking-code-box"><span>TRACKING CODE</span><strong data-testid="text-confirmation-tracking-code">{receipt.trackingCode}</strong>
        <Link className="portal-button primary" href={`/track/${encodeURIComponent(receipt.trackingCode)}`} data-testid="link-track-request">Track order <ArrowRight size={15} /></Link>
      </div>
      <p className="public-footnote">Estimated price: {currency(receipt.estimatedTotalPaise)} · Keep this code to check your order’s progress.</p>
    </section>
  </main>;

  return <main className="public-page">
    <div className="public-topline"><div className="public-brand" data-testid="text-public-brand"><span className="public-brand-mark">P</span><span>PRINT REQUEST</span></div><span className="guest-badge"><LockKeyhole size={12} /> No account needed</span></div>
    <div className="customer-layout">
      <section className="customer-main">
        {!shop.acceptingOrders && <InlineNotice kind="info" testId="status-orders-paused">This shop has paused new requests. Please contact the counter directly.</InlineNotice>}
        <Form {...customerForm}>
        <form onSubmit={customerForm.handleSubmit(() => {
          setUploadError('');
          setReviewConfirmed(false);
          setActiveReviewFileId(files[0]?.id ?? '');
          setReviewPage(1);
          setReviewOpen(true);
        })} className="customer-form">
          <section className="customer-section">
             <div className="customer-section-title"><span>01</span><div><h2>Add your files</h2><p>Choose files to review here. Nothing is sent to the shop until you submit.</p></div></div>
            <input ref={inputRef} className="visually-hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              disabled={isSending} onChange={(event) => event.currentTarget.files && addFiles(event.currentTarget.files)} data-testid="input-customer-files" />
            <button type="button" className="upload-dropzone" disabled={isSending || !shop.acceptingOrders || files.length >= 5}
              onClick={() => inputRef.current?.click()} data-testid="button-add-customer-files">
              <span className="upload-drop-icon"><Upload size={18} /></span><strong>Tap to choose files</strong><span>PDF, JPEG, PNG or WEBP · up to 25 MB each</span><small>{files.length} / 5 files <b>·</b> {prettySize(totalBytes)} / 80 MB</small>
            </button>
            {fileError && <InlineNotice kind="error" testId="status-file-validation">{fileError}</InlineNotice>}
            {files.length > 0 && <div className="customer-file-list">{files.map((item) => <article className="customer-file-card" key={item.id} data-testid={`card-customer-file-${item.id}`}>
              {item.previewUrl ? <img className="customer-file-preview" src={item.previewUrl} alt={`Preview of ${item.file.name}`} data-testid={`image-customer-preview-${item.id}`} />
                : <div className="customer-file-preview file-type-preview"><FileText size={20} /><span>PDF</span></div>}
      <div className="customer-file-info"><strong title={item.file.name}>{item.file.name}</strong><span>{item.pageError || `${prettySize(item.file.size)} · ${item.pageCount === null ? 'Reading pages…' : `${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`}`}</span></div>
              <button type="button" className="icon-action remove-file" disabled={isSending} onClick={() => removeFile(item.id)} aria-label={`Remove ${item.file.name}`} data-testid={`button-remove-customer-file-${item.id}`}><X size={16} /></button>
            </article>)}</div>}
          </section>
          <section className="customer-section">
            <div className="customer-section-title"><span>02</span><div><h2>Print settings</h2><p>Choose how you’d like the shop to prepare it.</p></div></div>
            <div className="settings-grid">
              <label className="portal-field"><span className="portal-label">Paper size</span><div className="select-wrap"><select className="portal-input" value={values.paperSize} onChange={(event) => updateValue('paperSize', event.currentTarget.value as CustomerFormValues['paperSize'])} data-testid="select-paper-size">
                {['A4', 'A3', 'A5', 'Letter', 'Legal'].map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></div></label>
              <fieldset className="choice-field"><legend className="portal-label">Print in</legend><div className="choice-pair">
                {(['bw', 'color'] as const).map((value) => <button type="button" aria-pressed={values.colorMode === value} className={`choice-button ${values.colorMode === value ? 'selected' : ''}`} onClick={() => updateValue('colorMode', value)} key={value} data-testid={`button-color-mode-${value}`}>
                  <span className={`color-dot ${value}`} />{value === 'bw' ? 'B&W' : 'Colour'}<small>{currency(value === 'bw' ? shop.bwRatePaise : shop.colorRatePaise)}/page</small>
                </button>)}
              </div></fieldset>
              <fieldset className="choice-field"><legend className="portal-label">Sides</legend><div className="choice-pair">
                {(['single', 'double'] as const).map((value) => <button type="button" aria-pressed={values.sides === value} className={`choice-button ${values.sides === value ? 'selected' : ''}`} onClick={() => updateValue('sides', value)} key={value} data-testid={`button-sides-${value}`}>
                  {value === 'single' ? 'Single-sided' : 'Double-sided'}
                </button>)}
              </div></fieldset>
              <label className="portal-field copies-field"><span className="portal-label">Copies</span><input className="portal-input" type="number" min="1" max="99" value={values.copies} onChange={(event) => updateValue('copies', Math.min(99, Math.max(1, Number(event.currentTarget.value))))} data-testid="input-copies" /></label>
              <label className="portal-field"><span className="portal-label">Finishing</span><div className="select-wrap"><select className="portal-input" value={values.finishing} onChange={(event) => updateValue('finishing', event.currentTarget.value as CustomerFormValues['finishing'])} data-testid="select-finishing">
                <option value="none">No finishing</option><option value="staple">Staple</option><option value="bind">Bind</option>
              </select><ChevronDown size={14} /></div></label>
            </div>
          </section>
          <section className="customer-section">
            <div className="customer-section-title"><span>03</span><div><h2>Your details</h2><p>So the shop can identify your job.</p></div></div>
            <div className="settings-grid details-grid">
              <TextField label="Your name" id="customer-name" value={values.customerName} onChange={(value) => updateValue('customerName', value)} placeholder="Name for this job" testId="input-customer-name" required />
              <label className="portal-field full"><span className="portal-label">Notes for the shop <small>OPTIONAL</small></span><textarea className="portal-input customer-notes" maxLength={500} value={values.instructions} onChange={(event) => updateValue('instructions', event.currentTarget.value)} placeholder="Paper preferences, pickup timing, or other details" data-testid="input-customer-instructions" /></label>
            </div>
          </section>
          <section className="calculated-price-bar" data-testid="panel-calculated-price"><div><div className="portal-kicker">CALCULATED TOTAL</div>
            <strong>{allPagesKnown && files.length ? currency(calculatedPricePaise) : '—'}</strong>
            <span>{files.length ? `${pages} pages · ${values.copies} ${values.copies === 1 ? 'copy' : 'copies'}` : 'Add files to calculate your price'}</span>
          </div><p>Calculated from the shop’s posted per-page rates. Optional finishing charges are separate.</p></section>
          <FormField control={customerForm.control} name="privacyAccepted" render={({ field }) => <FormItem className="privacy-consent-item">
            <label className="privacy-consent"><FormControl><input type="checkbox" checked={field.value} onChange={(event) => field.onChange(event.currentTarget.checked)}
              required aria-required="true" data-testid="checkbox-upload-privacy" /></FormControl><LockKeyhole size={15} />
               <span>If I submit, my files will be stored temporarily for this job and shared with <strong>{shop.shopName}</strong>.</span>
            </label><FormMessage className="privacy-consent-error" />
          </FormItem>} />
          {uploadError && <InlineNotice kind="error" testId="status-submit-error">{uploadError}</InlineNotice>}
          <button className="portal-button primary submit-customer" type="submit" disabled={!canSubmit || !shop.acceptingOrders || isSending} data-testid="button-submit-print-request">
            <FileImage size={16} /> Review files and price<ArrowRight size={15} />
          </button>
          <p className="submit-disclaimer">The shop receives your request only after you review and confirm it.</p>
        </form>
        </Form>
      </section>
    </div>
    <Dialog open={isSending}>
      <DialogContent className="customer-upload-dialog" data-testid="dialog-customer-upload-progress">
        <div className="customer-upload-modal">
          <div className="customer-upload-spinner"><LoaderCircle className="spin" size={23} /></div>
          <DialogTitle>Sending your print request</DialogTitle>
          <DialogDescription data-testid="text-upload-progress">{uploadProgress || 'Preparing your files securely…'}</DialogDescription>
          <div className="customer-upload-progress-track" role="progressbar" aria-label="Print request upload in progress" aria-valuetext={uploadProgress || 'Preparing your files'}>
            <span />
          </div>
          <p>Keep this page open while your files are sent to the shop.</p>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={reviewOpen} onOpenChange={(open) => { if (!isSending) setReviewOpen(open); }}>
      <DialogContent className="document-review-dialog" data-testid="dialog-review-print-order">
        <DialogTitle>Review your print order</DialogTitle>
        <DialogDescription>Check the full document and estimated price. The shop will receive your order only after you submit it here.</DialogDescription>
        {activeReviewFile && <div className="document-review-meta">
          <div className="document-review-file-select">
            {files.map((item) => <button type="button" key={item.id} className={item.id === activeReviewFile.id ? 'selected' : ''}
              onClick={() => { setActiveReviewFileId(item.id); setReviewPage(1); }} title={item.file.name} data-testid={`button-review-file-${item.id}`}>
              <FileText size={14} /><span>{item.file.name}</span>
            </button>)}
          </div>
          <div className="document-review-file-summary"><strong title={activeReviewFile.file.name}>{activeReviewFile.file.name}</strong>
            <span>{activeReviewFile.pageCount ?? 1} {activeReviewFile.pageCount === 1 ? 'page' : 'pages'} · {prettySize(activeReviewFile.file.size)}</span></div>
        </div>}
        {activeReviewFile && <div className="document-review-viewer" data-testid="viewer-full-document">
          {activeReviewFile.mimeType === 'application/pdf'
            ? <FullDocumentPreview key={activeReviewFile.id} file={activeReviewFile.file} pageNumber={reviewPage} />
            : <img src={activeReviewFile.previewUrl} alt={`Full preview of ${activeReviewFile.file.name}`} />}
        </div>}
        {activeReviewFile?.mimeType === 'application/pdf' && <div className="document-review-pager">
          <button type="button" className="portal-button secondary" disabled={reviewPage <= 1} onClick={() => setReviewPage((page) => Math.max(1, page - 1))} aria-label="Previous page" data-testid="button-review-previous-page"><ChevronLeft size={15} /> Previous</button>
          <span>Page {reviewPage} of {activeReviewFile.pageCount ?? 1}</span>
          <button type="button" className="portal-button secondary" disabled={reviewPage >= (activeReviewFile.pageCount ?? 1)} onClick={() => setReviewPage((page) => Math.min(activeReviewFile.pageCount ?? 1, page + 1))} aria-label="Next page" data-testid="button-review-next-page">Next <ChevronRight size={15} /></button>
        </div>}
        <div className="document-review-total"><span>Estimated total for {pages} {pages === 1 ? 'page' : 'pages'} · {values.copies} {values.copies === 1 ? 'copy' : 'copies'}</span><strong>{currency(calculatedPricePaise)}</strong></div>
        <label className="receipt-price-confirmation document-review-confirmation">
          <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.currentTarget.checked)} data-testid="checkbox-confirm-files-and-price" />
          <span>I’ve reviewed all pages and confirm the estimated price of <strong>{currency(calculatedPricePaise)}</strong>.</span>
        </label>
        {uploadError && <InlineNotice kind="error" testId="status-submit-error">{uploadError}</InlineNotice>}
        <div className="document-review-actions">
          <button type="button" className="portal-button secondary" onClick={() => setReviewOpen(false)} data-testid="button-edit-print-order">Back to edit</button>
          <button type="button" className="portal-button primary" disabled={!reviewConfirmed || !canSubmit || !shop.acceptingOrders}
            onClick={() => void sendRequest(customerForm.getValues())} data-testid="button-confirm-send-print-request">
            <Send size={15} /> Submit print request <ArrowRight size={15} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  </main>;
}

export function RequestTrackingPage({ trackingCode }: RequestTrackingPageProps) {
  const trackingQuery = useGetPrintShopRequestTracking(trackingCode, {
    query: { queryKey: getGetPrintShopRequestTrackingQueryKey(trackingCode), refetchInterval: 18_000, retry: false },
  });
  const acceptQuote = useAcceptPrintShopQuote();
  const queryClient = useQueryClient();
  const [acceptError, setAcceptError] = useState('');
  const tracking = trackingQuery.data as PrintShopTracking | undefined;
  const accept = () => {
    setAcceptError('');
    acceptQuote.mutate({ trackingCode }, {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetPrintShopRequestTrackingQueryKey(trackingCode) }),
      onError: (error) => setAcceptError(errorText(error)),
    });
  };
  const whatsapp = tracking?.whatsappPhone ? `https://wa.me/${tracking.whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${tracking.shopName}, I’m checking on print request ${trackingCode}.`)}` : undefined;
  if (trackingQuery.isLoading) return <main className="public-page"><section className="tracking-skeleton"><i /><i /><i /><i /><i /></section></main>;
  if (trackingQuery.isError || !tracking) return <main className="public-page"><div className="public-error"><div className="public-error-mark"><AlertCircle size={22} /></div>
    <div className="portal-kicker">TRACKING LINK</div><h1>We couldn’t find this request.</h1><p>Check the code and try again. This page does not show customer files or personal details.</p>
    <button type="button" className="portal-button secondary" onClick={() => void trackingQuery.refetch()} data-testid="button-retry-tracking"><RefreshCw size={15} /> Try again</button>
  </div></main>;

  const step = statusStep[tracking.status];
  const timeline = [
    { key: 'received', label: 'Request received', detail: 'Your files reached the shop.' },
    { key: 'quoted', label: 'Price shared', detail: 'Review and accept the automatically calculated price.' },
    { key: 'approved', label: 'Approved', detail: 'The job is confirmed for printing.' },
    { key: 'printing', label: 'Printing', detail: 'The shop is preparing your pages.' },
    { key: 'ready', label: 'Ready for pickup', detail: 'Your print job is at the counter.' },
    { key: 'completed', label: 'Completed', detail: 'This print request is complete.' },
  ];
  return <main className="public-page tracking-page">
    <div className="public-topline"><div className="public-brand" data-testid="text-tracking-brand"><span className="public-brand-mark">P</span><span>PRINT REQUEST</span></div><span className="guest-badge"><LockKeyhole size={12} /> Private status</span></div>
    <section className="tracking-head"><div className="portal-kicker">REQUEST STATUS</div><h1>{tracking.shopName}</h1><p>{tracking.city} <span>·</span> Request <code data-testid="text-tracking-code">{tracking.trackingCode}</code></p></section>
    <div className="tracking-layout">
      <section className="tracking-main">
        <div className="tracking-status-card" data-testid="panel-tracking-status"><div className={`status-emblem status-${tracking.status}`}>
          {tracking.status === 'ready' || tracking.status === 'completed' ? <CheckCircle2 size={22} /> : tracking.status === 'cancelled' ? <X size={22} /> : <Clock3 size={22} />}
        </div><div><span className={`request-status status-${tracking.status}`} data-testid="status-tracking-current">{statusLabels[tracking.status]}</span>
          <h2>{tracking.status === 'cancelled' ? 'This request has been cancelled.' : tracking.status === 'ready' ? 'Your prints are ready at the shop.' : tracking.status === 'completed' ? 'This job is complete.' : tracking.status === 'quoted' ? 'Review your calculated price.' : tracking.status === 'printing' ? 'Your job is being printed.' : tracking.status === 'approved' ? 'Your price is approved.' : 'The shop has received your request.'}</h2>
          <p>{tracking.publicMessage || `Last updated ${compactDate(tracking.updatedAt)}`}</p>
        </div></div>
        <div className="tracking-timeline" aria-label="Request progress" data-testid="list-tracking-events">
          <div className="timeline-label">JOB PROGRESS</div>
          {tracking.status === 'cancelled' ? <div className="timeline-cancelled"><span className="timeline-dot cancelled"><X size={12} /></span><div><strong>Request cancelled</strong><small>{tracking.publicMessage || 'Contact the shop if you have questions.'}</small></div></div>
            : timeline.map((item, index) => {
              const current = index === step;
              const done = index < step;
              const event = tracking.events.find((entry) => entry.status === item.key);
              return <div className={`timeline-row ${done ? 'done' : ''} ${current ? 'current' : ''}`} key={item.key} data-testid={`step-tracking-${item.key}`}>
                <span className="timeline-dot">{done ? <Check size={12} /> : current ? <i /> : null}</span>
                <div className="timeline-copy"><strong>{item.label}</strong><small>{event?.message || item.detail}</small></div>
                {event && <time>{compactDate(event.createdAt)}</time>}
              </div>;
            })}
        </div>
        {tracking.status === 'quoted' && tracking.quoteTotalPaise !== null && <section className="quote-accept-card" data-testid="panel-price-acceptance">
          <div className="portal-kicker">CALCULATED CUSTOMER PRICE</div><div className="quote-total">{currency(tracking.quoteTotalPaise)}</div>
          <p>Accept this price to let the shop proceed with printing.</p>
          {acceptError && <InlineNotice kind="error" testId="status-price-accept-error">{acceptError}</InlineNotice>}
          <button type="button" className="portal-button primary" onClick={accept} disabled={acceptQuote.isPending} data-testid="button-accept-price">
            {acceptQuote.isPending ? <LoaderCircle className="spin" size={15} /> : <BadgeCheck size={16} />}{acceptQuote.isPending ? 'Confirming…' : 'Accept price'}
          </button>
        </section>}
      </section>
      <aside className="tracking-aside">
        <section className="portal-card tracking-summary"><div className="portal-kicker">JOB SUMMARY</div>
          <div className="summary-row"><span>Pages requested</span><strong>{tracking.fileCount} {tracking.fileCount === 1 ? 'file' : 'files'}</strong></div>
          <div className="summary-row"><span>Paper</span><strong>{tracking.paperSize}</strong></div>
          <div className="summary-row"><span>Print mode</span><strong>{tracking.colorMode === 'bw' ? 'B&W' : 'Colour'} · {tracking.sides === 'double' ? 'double-sided' : 'single-sided'}</strong></div>
          <div className="summary-row"><span>Copies</span><strong>{tracking.copies}</strong></div>
          {tracking.finishing !== 'none' && <div className="summary-row"><span>Finishing</span><strong>{tracking.finishing === 'bind' ? 'Binding' : 'Staple'}</strong></div>}
          {tracking.quoteTotalPaise !== null && <div className="summary-row summary-price"><span>Price</span><strong>{currency(tracking.quoteTotalPaise)}</strong></div>}
          <div className="summary-created">Sent {compactDate(tracking.createdAt)}</div>
        </section>
        <section className="tracking-contact-card"><div className="contact-seal"><MessageCircle size={17} /></div><strong>Need to ask the shop?</strong><p>They can help with your price, pickup or job details.</p>
          {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer" className="portal-button secondary" data-testid="link-tracking-whatsapp"><MessageCircle size={15} /> Contact on WhatsApp</a>}
        </section>
        <div className="privacy-note"><LockKeyhole size={13} /><span>This page shows job status only. Customer details and file contents are never shown here.</span></div>
      </aside>
    </div>
  </main>;
}
