export interface ChipStatus {
  index: number;
  id: string;
  name: string;
  phone: string;
  isMain: boolean;
  status: 'disconnected' | 'connecting' | 'qrcode' | 'pairing_code' | 'connected';
  qrCodeDataUrl: string | null;
  pairingCode: string | null;
  addedToday: number;
  error: string | null;
  lastSeen: string | null;
}

export interface ActiveTaskStatus {
  isRunning: boolean;
  isPaused: boolean;
  currentIndex: number;
  totalContacts: number;
  successCount: number;
  failedCount: number;
  currentChip: string | null;
  currentContact: string | null;
  nextAdditionInSeconds: number;
  groupName: string;
  groupJid: string;
}

export interface RobotLog {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export declare const robotManager: {
  chips: ChipStatus[];
  activeTask: ActiveTaskStatus;
  logs: RobotLog[];
  getStatus(): { chips: ChipStatus[]; activeTask: ActiveTaskStatus; logs: RobotLog[] };
  connectChip(chipIndex: number, targetPhoneNumber?: string | null): Promise<any>;
  disconnectChip(chipIndex: number, clearCredentials?: boolean): Promise<{ ok: boolean }>;
  disconnectAll(): Promise<{ ok: boolean }>;
  startAddingContacts(params: {
    groupLinkOrJid: string;
    contacts: Array<{ name?: string; digits?: string; phone?: string }>;
    delaySeconds?: number;
    dailyLimitPerChip?: number;
  }): Promise<any>;
  pauseTask(): void;
  resumeTask(): void;
  stopTask(): void;
  clearLogs(): void;
};
