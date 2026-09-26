import type { ReactElement, ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TaskBar } from './TaskBar';
import { TitleBar } from './TitleBar';
import { UpdateBanner } from './UpdateBanner';
import { ToastHost } from '@/components/ui/ToastHost';
import { BackgroundLayer } from '@/features/appearance/BackgroundLayer';
import { CrashDialog } from '@/features/crash/CrashDialog';
import { DropZone } from '@/features/drop/DropZone';
import { ExportDialog } from '@/features/packs/ExportDialog';
import { SkippedFilesDialog } from '@/features/packs/SkippedFilesDialog';

/**
 * The wallpaper runs edge to edge under the whole window and everything
 * else floats above it: that is what the glass has to bend. The rail and the
 * task bar keep a margin so their edges stay visible.
 */
export function AppShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="ambient relative flex h-full w-full flex-col overflow-hidden">
      <BackgroundLayer />

      <TitleBar />

      <div className="relative z-10 flex min-h-0 w-full min-w-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
          <TaskBar />
        </div>
      </div>

      <ToastHost />
      <ExportDialog />
      <CrashDialog />
      <DropZone />
      <SkippedFilesDialog />
    </div>
  );
}
