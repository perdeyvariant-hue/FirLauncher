import { create } from 'zustand';
import type { LogStream } from '@/types/instance';

export type LaunchLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

/** One line of the game's output, split the way Minecraft writes it. */
export interface LaunchLine {
  readonly seq: number;
  readonly time: string;
  readonly level: LaunchLevel;
  readonly thread: string;
  readonly message: string;
}

interface LaunchState {
  /** The instance being launched or played, while the panel is in use. */
  instanceId: string | null;
  phase: 'preparing' | 'running';
  visible: boolean;
  lines: LaunchLine[];
  open: (instanceId: string) => void;
  push: (stream: LogStream, text: string) => void;
  started: () => void;
  hide: () => void;
  close: () => void;
}

/** Enough to see the game come up; the full log lives in the Logs tab. */
const MAX_LINES = 400;

// "[12:34:56] [Render thread/INFO]: text" and Forge's
// "[12:34:56] [main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: text".
const VANILLA = /^\[(\d{2}:\d{2}:\d{2})\] \[([^\]/]+)\/([A-Z]+)\](?: \[[^\]]*\])?:? ?(.*)$/;

function now(): string {
  const date = new Date();
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function levelOf(value: string): LaunchLevel {
  if (value === 'WARN' || value === 'WARNING') return 'WARN';
  if (value === 'ERROR' || value === 'FATAL') return 'ERROR';
  if (value === 'DEBUG' || value === 'TRACE') return 'DEBUG';
  return 'INFO';
}

let seq = 0;

export function parseLine(stream: LogStream, text: string): LaunchLine {
  seq += 1;
  const match = VANILLA.exec(text);
  if (match !== null) {
    return {
      seq,
      time: match[1] ?? now(),
      thread: match[2] ?? '',
      level: levelOf(match[3] ?? 'INFO'),
      message: match[4] ?? '',
    };
  }
  const level: LaunchLevel =
    stream === 'stderr' || /\b(ERROR|FATAL|Exception)\b/.test(text)
      ? 'ERROR'
      : /\bWARN/.test(text)
        ? 'WARN'
        : 'INFO';
  return {
    seq,
    time: now(),
    thread: stream === 'launcher' ? 'FirLauncher' : '',
    level,
    message: text,
  };
}

/** The launch card: which instance is starting, and what it has said so far. */
export const useLaunch = create<LaunchState>()((set, get) => ({
  instanceId: null,
  phase: 'preparing',
  visible: false,
  lines: [],

  open: (instanceId) => {
    set({ instanceId, phase: 'preparing', visible: true, lines: [] });
  },

  push: (stream, text) => {
    if (get().instanceId === null || text.trim() === '') return;
    set((state) => {
      const lines = [...state.lines, parseLine(stream, text)];
      return { lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines };
    });
  },

  started: () => {
    set({ phase: 'running' });
  },

  hide: () => {
    set({ visible: false });
  },

  close: () => {
    set({ instanceId: null, visible: false, lines: [], phase: 'preparing' });
  },
}));
