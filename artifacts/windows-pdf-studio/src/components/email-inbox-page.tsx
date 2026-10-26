import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock3, FileImage, FileText, FolderOpen,
  Inbox, LockKeyhole, Mail, Paperclip, RefreshCw, Search, Settings2,
} from 'lucide-react';
import type { MailAttachmentInfo, MailMessageInfo } from '@/lib/mail-bridge';
import { PaginationControls } from '@/components/pagination-controls';
import './email-inbox-page.css';

type InboxFilter = 'all' | 'attachments' | 'unread';
type BodyState = { loading: boolean; text?: string; available?: boolean; error?: string };

function messageKey(message: MailMessageInfo) {
  return `${message.uidValidity}:${message.uid}`;
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return 'Date unavailable';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  return mimeType === 'application/pdf' ? <FileText size={16}/> : <FileImage size={16}/>;
}

export default function EmailInboxPage({
  onOpenSettings,
  onSaveAttachment,
}: {
  onOpenSettings: () => void;
  onSaveAttachment: (file: File) => Promise<void>;
}) {
  const bridge = window.pdfStudioMail;
  const [accountState, setAccountState] = useState<'loading' | 'missing' | 'ready' | 'unavailable'>('loading');
  const [messages, setMessages] = useState<MailMessageInfo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [messagePage, setMessagePage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [bodyByMessage, setBodyByMessage] = useState<Record<string, BodyState>>({});
  const [savingAttachment, setSavingAttachment] = useState<string | null>(null);
  const [savedAttachments, setSavedAttachments] = useState<Set<string>>(() => new Set());
  const [saveNotice, setSaveNotice] = useState('');
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (!bridge || inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    setSyncError('');
    try {
      const response = await bridge.listMessages();
      setMessages(response.messages);
      setLastSynced(Date.now());
      setSelectedKey((current) => current && response.messages.some((message) => messageKey(message) === current) ? current : null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'The inbox could not be synced. Check your IMAP settings.');
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) {
      setAccountState('unavailable');
      return;
    }
    let active = true;
    let interval: number | undefined;
    void bridge.getSettings().then(({ settings }) => {
      if (!active) return;
      if (!settings) {
        setAccountState('missing');
        return;
      }
      setAccountState('ready');
      void sync();
      interval = window.setInterval(() => void sync(), 120_000);
    }).catch(() => {
      if (active) {
        setAccountState('ready');
        setSyncError('Mailbox settings could not be loaded. Reconnect the account in Settings.');
      }
    });
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
    };
  }, [bridge, sync]);

  const filteredMessages = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return messages.filter((message) => {
      if (filter === 'attachments' && !message.attachments.length) return false;
      if (filter === 'unread' && !message.unread) return false;
      if (!normalizedQuery) return true;
      return [message.subject, message.from, ...message.attachments.map((attachment) => attachment.name)]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [filter, messages, query]);
  const messagePageSize = 10;
  const messagePageCount = Math.max(1, Math.ceil(filteredMessages.length / messagePageSize));
  const safeMessagePage = Math.min(messagePage, messagePageCount);
  const pageMessages = filteredMessages.slice((safeMessagePage - 1) * messagePageSize, safeMessagePage * messagePageSize);

  useEffect(() => {
    setMessagePage(1);
  }, [query, filter]);
  useEffect(() => {
    setMessagePage((page) => Math.min(page, Math.max(1, Math.ceil(filteredMessages.length / messagePageSize))));
  }, [filteredMessages.length]);

  const openMessage = async (message: MailMessageInfo) => {
    const key = messageKey(message);
    if (selectedKey === key) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey(key);
    if (!bridge || bodyByMessage[key]) return;
    setBodyByMessage((current) => ({ ...current, [key]: { loading: true } }));
    try {
      const body = await bridge.getMessageBody({ uid: message.uid, uidValidity: message.uidValidity });
      setBodyByMessage((current) => ({ ...current, [key]: { loading: false, ...body } }));
      if (body.markedRead) setMessages((current) => current.map((item) => messageKey(item) === key ? { ...item, unread: false } : item));
    } catch {
      setBodyByMessage((current) => ({ ...current, [key]: { loading: false, error: 'Message text could not be loaded. Try again after syncing.' } }));
    }
  };

  const saveAttachment = async (message: MailMessageInfo, attachment: MailAttachmentInfo) => {
    if (!bridge) return;
    const id = `${messageKey(message)}:${attachment.partId}`;
    setSavingAttachment(id);
    setSaveNotice('');
    try {
      const data = await bridge.getAttachment({ uid: message.uid, uidValidity: message.uidValidity, partId: attachment.partId });
      const buffer = new ArrayBuffer(data.bytes.byteLength);
      new Uint8Array(buffer).set(data.bytes);
      const file = new File([buffer], data.name, { type: data.mimeType });
      await onSaveAttachment(file);
      setSavedAttachments((current) => new Set(current).add(id));
      setSaveNotice(`${data.name} saved to File Manager.`);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : 'The attachment could not be saved.');
    } finally {
      setSavingAttachment(null);
    }
  };

  if (accountState === 'unavailable') {
    return <div className="page-wrap email-page inbox-page">
      <section className="panel inbox-connect-card"><div className="inbox-connect-icon"><Inbox size={23}/></div><h2>Open this in the Windows desktop app</h2><p>Email connects directly from the installed app so your mailbox password and documents never go through the web service.</p><button className="tool-btn" onClick={onOpenSettings}><Settings2 size={14}/> Settings</button></section>
    </div>;
  }

  return <div className="page-wrap email-page inbox-page">
    {accountState === 'missing' ? <section className="panel inbox-connect-card">
      <div className="inbox-connect-icon"><Inbox size={23}/></div><h2>Connect a mailbox to get started.</h2>
      <p>Enter your incoming IMAP and outgoing SMTP settings. The app will check for email while this inbox is open.</p>
      <button className="tool-btn primary" onClick={onOpenSettings}><Settings2 size={14}/> Configure email</button>
    </section> : <>
      <section className="panel inbox-toolbar">
        <div className="inbox-search"><Search size={15}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search sender, subject, or attachment"/></div>
        <div className="inbox-filters" role="group" aria-label="Filter messages">
          {([['all','All mail'],['attachments','With files'],['unread','Unread']] as const).map(([value,label])=>
            <button key={value} className={`inbox-filter ${filter===value?'active':''}`} onClick={()=>setFilter(value)}>{label}</button>)}
        </div>
        <div className="inbox-sync-time"><Clock3 size={13}/>{lastSynced ? `Synced ${new Date(lastSynced).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : 'Ready to sync'}</div>
        <div className="inbox-heading-actions">
          <button className="tool-btn" onClick={onOpenSettings}><Settings2 size={14}/> Settings</button>
          <button className="tool-btn primary" onClick={() => void sync()} disabled={syncing || accountState !== 'ready'}><RefreshCw size={14} className={syncing ? 'inbox-spinning' : ''}/>{syncing ? 'Syncing…' : 'Sync inbox'}</button>
        </div>
      </section>

      {syncError && <div className="notice error inbox-error" role="alert"><AlertCircle size={15}/>{syncError}</div>}
      {saveNotice && <div className="notice success inbox-error" role="status"><CheckCircle2 size={15}/>{saveNotice}</div>}

      <section className="inbox-message-list" aria-live="polite">
        {accountState === 'loading' || (syncing && messages.length === 0) ? <div className="panel inbox-empty"><RefreshCw size={18} className="inbox-spinning"/><h2>Checking your inbox</h2><p>Fetching recent message details from your mail provider.</p></div> :
          filteredMessages.length ? pageMessages.map((message) => {
            const key = messageKey(message);
            const expanded = selectedKey === key;
            const body = bodyByMessage[key];
            return <article className={`panel inbox-message ${message.unread ? 'unread' : ''} ${expanded ? 'expanded' : ''}`} key={key}>
              <button className="inbox-message-toggle" onClick={()=>void openMessage(message)} aria-expanded={expanded}>
                <span className={`inbox-message-icon ${message.unread ? 'unread' : ''}`}><Mail size={16}/></span>
                <span className="inbox-message-summary">
                  <span className="inbox-message-meta"><strong>{message.from}</strong><time>{formatDate(message.date)}</time></span>
                  <span className="inbox-message-subject">{message.subject}</span>
                  <span className="inbox-message-submeta">{message.attachments.length ? <><Paperclip size={12}/>{message.attachments.length} supported attachment{message.attachments.length===1?'':'s'}</> : 'No supported PDF or image attachments'}</span>
                </span>
              </button>
              {expanded && <div className="inbox-message-details">
                <div className="inbox-body">
                  {body?.loading ? <span className="inbox-muted">Loading message text…</span> :
                    body?.error ? <span className="inbox-error-text">{body.error}</span> :
                    body?.available ? <pre>{body.text}</pre> :
                    <span className="inbox-muted">This email has no available plain-text message body.</span>}
                </div>
                {message.attachments.length > 0 && <div className="inbox-attachments">
                  <div className="inbox-attachments-title"><Paperclip size={13}/> DOCUMENTS & IMAGES <span>{message.attachments.length}</span></div>
                  {message.attachments.map((attachment) => {
                    const attachmentKey = `${key}:${attachment.partId}`;
                    const savedAlready = savedAttachments.has(attachmentKey);
                    return <div className="inbox-attachment" key={attachment.partId}>
                      <div className="inbox-attachment-icon"><AttachmentIcon mimeType={attachment.mimeType}/></div>
                      <div className="inbox-attachment-info"><strong title={attachment.name}>{attachment.name}</strong><span>{attachment.mimeType==='application/pdf'?'PDF':'Image'} · {formatSize(attachment.size)}</span></div>
                      <button className={`tool-btn ${savedAlready?'soft':''}`} onClick={()=>void saveAttachment(message,attachment)} disabled={savedAlready || savingAttachment===attachmentKey}>
                        {savedAlready ? <><CheckCircle2 size={13}/> Saved</> : savingAttachment===attachmentKey ? 'Saving…' : <><FolderOpen size={13}/> Save to File Manager</>}
                      </button>
                    </div>;
                  })}
                </div>}
                <div className="inbox-local-note"><CheckCircle2 size={13}/> Attachments download only when you save them. Mail files are stored in this device’s File Manager.</div>
              </div>}
            </article>;
          }) : <div className="panel inbox-empty"><Inbox size={22}/><h2>{messages.length ? 'No matching email' : 'Your inbox is empty'}</h2><p>{messages.length ? 'Try another search or filter.' : 'When mail arrives, sync the inbox to see supported PDF and image attachments here.'}</p>{!messages.length && <button className="tool-btn" onClick={()=>void sync()} disabled={syncing}><RefreshCw size={13}/> Check again</button>}</div>}
      </section>
      {accountState === 'ready' && filteredMessages.length > 0 && (
        <PaginationControls page={safeMessagePage} pageSize={messagePageSize} total={filteredMessages.length} itemLabel="messages" onPageChange={setMessagePage} />
      )}
      <p className="inbox-footer-note"><LockKeyhole size={13}/> Inbox checks run every 2 minutes while this page is open. Only the latest 50 messages are listed; attachments larger than 30 MB are skipped.</p>
    </>}
  </div>;
}
