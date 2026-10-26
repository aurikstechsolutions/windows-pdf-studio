export interface MailSettingsForm {
  emailAddress: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
}

export type SavedMailSettings = Omit<MailSettingsForm, 'imapPassword' | 'smtpPassword'> & {
  imapPasswordSaved: boolean;
  smtpPasswordSaved: boolean;
};

export interface MailAttachmentInfo {
  partId: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface MailMessageInfo {
  uid: number;
  uidValidity: string;
  subject: string;
  from: string;
  date: number | null;
  unread: boolean;
  attachments: MailAttachmentInfo[];
}

export interface MailConnectionResult {
  ok: boolean;
  imap: { ok: boolean; message?: string };
  smtp: { ok: boolean; message?: string };
}

export interface MailAttachmentData {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface MailMessageBody {
  text: string;
  available: boolean;
  markedRead: boolean;
}

export interface MailBridge {
  getSettings(): Promise<{ secureStorageAvailable: boolean; settings: SavedMailSettings | null }>;
  saveSettings(settings: MailSettingsForm): Promise<SavedMailSettings>;
  clearSettings(): Promise<boolean>;
  testConnections(settings: MailSettingsForm): Promise<MailConnectionResult>;
  listMessages(): Promise<{ uidValidity: string; messages: MailMessageInfo[] }>;
  getMessageBody(request: { uid: number; uidValidity: string }): Promise<MailMessageBody>;
  getAttachment(request: { uid: number; uidValidity: string; partId: string }): Promise<MailAttachmentData>;
}

declare global {
  interface Window {
    pdfStudioMail?: MailBridge;
  }
}
