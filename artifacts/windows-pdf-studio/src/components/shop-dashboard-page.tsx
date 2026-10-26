import { Link } from 'wouter';
import {
  ArrowRight, CheckCircle2, Clock3, FileText, Printer, QrCode, RefreshCw,
  Settings2, ShieldCheck, WalletCards,
} from 'lucide-react';
import {
  getGetMyPrintShopQueryKey,
  getListMyShopPrintRequestsQueryKey,
  useGetMyPrintShop,
  useListMyShopPrintRequests,
  type PrintShopRequestStatus,
  type ShopPrintRequest,
} from '@workspace/api-client-react';
import './shop-dashboard-page.css';

const statusLabels: Record<PrintShopRequestStatus, string> = {
  received: 'Received',
  quoted: 'Awaiting customer',
  approved: 'Approved',
  printing: 'Printing',
  ready: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const currency = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

function formatRequestTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function requestPages(request: ShopPrintRequest) {
  return request.files.reduce((pages, file) => pages + file.pageCount, 0);
}

function DashboardSkeleton() {
  return <main className="shop-dashboard" aria-label="Loading shop dashboard" data-testid="loading-shop-dashboard">
    <div className="sd-skeleton-intro"><i /><i /><i /></div>
    <div className="sd-skeleton-profile" />
    <div className="sd-skeleton-metrics">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</div>
    <div className="sd-skeleton-requests"><i /><i /><i /></div>
  </main>;
}

function RetryPanel({ message, onRetry, testId }: { message: string; onRetry: () => void; testId: string }) {
  return <div className="sd-error-panel" role="alert" data-testid={testId}>
    <div className="sd-error-mark"><RefreshCw size={18} /></div>
    <div className="sd-error-copy"><strong>Could not load shop data</strong><span>{message}</span></div>
    <button type="button" className="sd-button sd-button-secondary" onClick={onRetry} data-testid="button-retry-dashboard">
      <RefreshCw size={14} /> Retry
    </button>
  </div>;
}

function RequestRow({ request }: { request: ShopPrintRequest }) {
  const pages = requestPages(request);
  const filesLabel = `${request.files.length} ${request.files.length === 1 ? 'file' : 'files'}`;
  const pagesLabel = `${pages} ${pages === 1 ? 'page' : 'pages'}`;
  return <article className="sd-request-row" data-testid={`card-dashboard-request-${request.id}`}>
    <div className="sd-request-main">
      <span className="sd-request-file-icon" aria-hidden="true"><FileText size={16} /></span>
      <div className="sd-request-identity">
        <strong data-testid={`text-dashboard-customer-${request.id}`}>{request.customerName}</strong>
        <span>{request.paperSize} · {request.colorMode === 'bw' ? 'B&W' : 'Colour'} · {request.copies} {request.copies === 1 ? 'copy' : 'copies'}</span>
      </div>
    </div>
    <div className="sd-request-details">
      <span className={`sd-status sd-status-${request.status}`} data-testid={`status-dashboard-request-${request.id}`}>{statusLabels[request.status]}</span>
      <span className="sd-request-meta" data-testid={`text-dashboard-files-pages-${request.id}`}>{filesLabel} · {pagesLabel}</span>
      <time className="sd-request-meta" dateTime={request.createdAt} data-testid={`time-dashboard-request-${request.id}`}>{formatRequestTime(request.createdAt)}</time>
      <span className="sd-request-quote" data-testid={`text-dashboard-quote-${request.id}`}>
        {request.quoteTotalPaise === null ? '—' : currency(request.quoteTotalPaise)}
      </span>
    </div>
  </article>;
}

export function ShopDashboardPage({ apiReady }: { apiReady: boolean }) {
  const profileQuery = useGetMyPrintShop({
    query: { enabled: apiReady, queryKey: getGetMyPrintShopQueryKey() },
  });
  const shop = profileQuery.data?.shop ?? null;
  const queueEnabled = apiReady && !!shop;
  const recentParams = { page: 1, pageSize: 5 };
  const recentQuery = useListMyShopPrintRequests(recentParams, {
    query: {
      enabled: queueEnabled,
      queryKey: getListMyShopPrintRequestsQueryKey(recentParams),
      refetchInterval: 18_000,
    },
  });

  const statusParams = {
    received: { page: 1, pageSize: 1, status: 'received' as const },
    quoted: { page: 1, pageSize: 1, status: 'quoted' as const },
    approved: { page: 1, pageSize: 1, status: 'approved' as const },
    printing: { page: 1, pageSize: 1, status: 'printing' as const },
    ready: { page: 1, pageSize: 1, status: 'ready' as const },
    completed: { page: 1, pageSize: 1, status: 'completed' as const },
  };
  const receivedQuery = useListMyShopPrintRequests(statusParams.received, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(statusParams.received), refetchInterval: 18_000 },
  });
  const quotedQuery = useListMyShopPrintRequests(statusParams.quoted, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(statusParams.quoted), refetchInterval: 18_000 },
  });
  const approvedQuery = useListMyShopPrintRequests(statusParams.approved, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(statusParams.approved), refetchInterval: 18_000 },
  });
  const printingQuery = useListMyShopPrintRequests(statusParams.printing, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(statusParams.printing), refetchInterval: 18_000 },
  });
  const readyQuery = useListMyShopPrintRequests(statusParams.ready, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(statusParams.ready), refetchInterval: 18_000 },
  });
  const completedQuery = useListMyShopPrintRequests(statusParams.completed, {
    query: { enabled: queueEnabled, queryKey: getListMyShopPrintRequestsQueryKey(statusParams.completed), refetchInterval: 18_000 },
  });

  if (!apiReady) return <main className="shop-dashboard">
    <section className="sd-connection-card" data-testid="panel-dashboard-api-unavailable">
      <span className="sd-connection-icon"><ShieldCheck size={20} /></span>
      <div className="sd-eyebrow">SHOP CONNECTION</div>
      <h1>Connect this installation to your shop.</h1>
      <p>Activate the shop license and service connection to see QR customer requests here. Local PDF editing remains available separately.</p>
      <Link href="/shop" className="sd-button sd-button-primary" data-testid="link-dashboard-shop-setup">Open QR Uploads <ArrowRight size={15} /></Link>
    </section>
  </main>;

  if (profileQuery.isLoading) return <DashboardSkeleton />;
  if (profileQuery.isError) return <main className="shop-dashboard">
    <RetryPanel message={profileQuery.error instanceof Error ? profileQuery.error.message : 'Shop details are temporarily unavailable.'}
      onRetry={() => void profileQuery.refetch()} testId="status-dashboard-profile-error" />
  </main>;

  if (!shop) return <main className="shop-dashboard">
    <section className="sd-setup-card" data-testid="panel-dashboard-no-shop">
      <div className="sd-setup-icon"><Settings2 size={20} /></div>
      <div className="sd-eyebrow">FIRST, SET UP YOUR COUNTER</div>
      <h1>Your shop profile is not set up yet.</h1>
      <p>Create the profile for this licensed installation to configure per-page rates, turn on customer orders, and get your permanent QR.</p>
      <Link href="/shop" className="sd-button sd-button-primary" data-testid="link-dashboard-create-shop">Set up shop and QR <ArrowRight size={15} /></Link>
    </section>
  </main>;

  const queries = [recentQuery, receivedQuery, quotedQuery, approvedQuery, printingQuery, readyQuery, completedQuery];
  const isLoadingQueue = queries.some((query) => query.isLoading);
  const failedQuery = queries.find((query) => query.isError);
  const hasStatusCountError = [receivedQuery, quotedQuery, approvedQuery, printingQuery, readyQuery, completedQuery]
    .some((query) => query.isError);
  const retryAll = () => queries.forEach((query) => void query.refetch());
  const counts = {
    received: receivedQuery.data?.total ?? 0,
    quoted: quotedQuery.data?.total ?? 0,
    inProgress: (approvedQuery.data?.total ?? 0) + (printingQuery.data?.total ?? 0),
    ready: readyQuery.data?.total ?? 0,
    completed: completedQuery.data?.total ?? 0,
  };
  const activeTotal = hasStatusCountError ? null : counts.received + counts.quoted + counts.inProgress + counts.ready;
  const displayCount = (query: typeof receivedQuery) => isLoadingQueue || query.isError ? '—' : query.data?.total ?? 0;
  const requests = recentQuery.data?.items ?? [];

  return <main className="shop-dashboard" data-testid="page-shop-dashboard">
    <section className="sd-shop-strip" aria-label="Shop profile">
      <div className="sd-shop-identity">
        <span className="sd-shop-mark"><Printer size={19} /></span>
        <div>
          <div className="sd-eyebrow">COUNTER OVERVIEW</div>
          <h1 data-testid="text-dashboard-shop-name">{shop.shopName}</h1>
          <p data-testid="text-dashboard-shop-city">{shop.city}</p>
        </div>
      </div>
      <div className="sd-shop-status">
        <span className={`sd-live-dot ${shop.acceptingOrders ? 'is-open' : 'is-paused'}`} />
        <div>
          <strong data-testid="status-dashboard-accepting-orders">{shop.acceptingOrders ? 'Accepting orders' : 'Orders paused'}</strong>
          <span>{shop.acceptingOrders ? 'Customer QR is open' : 'Customer QR is paused'}</span>
        </div>
      </div>
      <div className="sd-rate-pair" aria-label="Configured per-page rates">
        <div><span>B&amp;W / page</span><strong data-testid="text-dashboard-bw-rate">{currency(shop.bwRatePaise)}</strong></div>
        <div><span>Colour / page</span><strong data-testid="text-dashboard-colour-rate">{currency(shop.colorRatePaise)}</strong></div>
      </div>
    </section>

    <section className="sd-workspace-bar" aria-label="Separate workspaces">
      <div className="sd-workspace-copy"><QrCode size={16} /><span><strong>Customer QR jobs</strong><small>Requests sent to this shop</small></span></div>
      <span className="sd-workspace-divider" aria-hidden="true" />
      <div className="sd-workspace-copy sd-local-copy"><FileText size={16} /><span><strong>Local PDF editor</strong><small>Files stay on this device</small></span></div>
      <div className="sd-shortcuts">
        <Link href="/shop" className="sd-shortcut" data-testid="link-dashboard-qr-uploads">QR Uploads <ArrowRight size={14} /></Link>
        <Link href="/" className="sd-shortcut sd-shortcut-editor" data-testid="link-dashboard-editor">Open Editor <ArrowRight size={14} /></Link>
      </div>
    </section>

    <section className="sd-metrics" aria-label="Customer request totals">
      <div className="sd-metric sd-metric-total">
        <span className="sd-metric-label">Current requests</span>
        <strong data-testid="value-dashboard-current-total">{isLoadingQueue || activeTotal === null ? '—' : activeTotal}</strong>
        <small>Excludes completed and cancelled</small>
      </div>
      <div className="sd-metric">
        <span className="sd-metric-label"><Clock3 size={13} /> Received</span>
          <strong data-testid="value-dashboard-received">{displayCount(receivedQuery)}</strong>
        <small>New requests</small>
      </div>
      <div className="sd-metric">
        <span className="sd-metric-label"><WalletCards size={13} /> Awaiting customer</span>
          <strong data-testid="value-dashboard-quoted">{displayCount(quotedQuery)}</strong>
        <small>Price sent</small>
      </div>
      <div className="sd-metric">
        <span className="sd-metric-label"><Printer size={13} /> In progress</span>
          <strong data-testid="value-dashboard-in-progress">{isLoadingQueue || approvedQuery.isError || printingQuery.isError ? '—' : counts.inProgress}</strong>
        <small>Approved + printing</small>
      </div>
      <div className="sd-metric">
        <span className="sd-metric-label"><CheckCircle2 size={13} /> Ready</span>
          <strong data-testid="value-dashboard-ready">{displayCount(readyQuery)}</strong>
        <small>For pickup</small>
      </div>
      <div className="sd-metric sd-metric-completed">
        <span className="sd-metric-label">Completed</span>
          <strong data-testid="value-dashboard-completed">{displayCount(completedQuery)}</strong>
        <small>Customer requests</small>
      </div>
    </section>

    <section className="sd-activity-panel" aria-labelledby="sd-activity-heading">
      <div className="sd-activity-head">
        <div><div className="sd-eyebrow">CUSTOMER QR QUEUE</div><h2 id="sd-activity-heading">Latest requests</h2></div>
        <div className="sd-activity-actions">
          <span className="sd-refresh-note"><span /> Refreshes every 18 sec</span>
          <Link href="/shop" className="sd-all-requests" data-testid="link-dashboard-all-requests">View QR Uploads <ArrowRight size={14} /></Link>
        </div>
      </div>
      {failedQuery && <div className="sd-queue-error">
        <p data-testid="status-dashboard-queue-error">{failedQuery.error instanceof Error ? failedQuery.error.message : 'Request totals could not be loaded.'}</p>
        <button type="button" className="sd-button sd-button-secondary" onClick={retryAll} data-testid="button-retry-dashboard-queue"><RefreshCw size={14} /> Retry queue</button>
      </div>}
      {isLoadingQueue && <div className="sd-loading-rows" aria-label="Loading request totals and activity"><i /><i /><i /></div>}
      {!isLoadingQueue && !recentQuery.isError && requests.length === 0 && <div className="sd-empty-queue" data-testid="empty-dashboard-requests">
        <span className="sd-empty-icon"><QrCode size={20} /></span>
        <div><strong>No customer requests yet</strong><p>New submissions from your permanent QR will appear here. Local editor documents are kept separate.</p></div>
        <Link href="/shop" className="sd-empty-link" data-testid="link-dashboard-empty-qr">View QR Uploads <ArrowRight size={14} /></Link>
      </div>}
      {!isLoadingQueue && !recentQuery.isError && requests.length > 0 && <div className="sd-request-list">
        <div className="sd-request-column-head"><span>Customer &amp; job</span><span>Status</span><span>Files / pages</span><span>Received</span><span>Quote</span></div>
        {requests.map((request) => <RequestRow key={request.id} request={request} />)}
        <p className="sd-quote-footnote">Quoted amounts are customer estimates, not recorded payments or revenue.</p>
      </div>}
    </section>
  </main>;
}
