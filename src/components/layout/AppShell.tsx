import type { ReactElement, ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TaskBar } from './TaskBar';
import { UpdateBanner } from './UpdateBanner';
import { ToastHost } from '@/components/ui/ToastHost';
import { BackgroundLayer } from '@/features/appearance/BackgroundLayer';
import { CrashDialog } from '@/features/crash/CrashDialog';
import { DropZone } from '@/features/drop/DropZone';
import { ExportDialog } from '@/features/packs/ExportDialog';
import { SkippedFilesDialog } from '@/features/packs/SkippedFilesDialog';

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): ReactElement {
  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <UpdateBanner />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <BackgroundLayer />
          <div className="relative h-full">{children}</div>
        </main>
        <TaskBar />
      </div>
      <ToastHost />
      <ExportDialog />
      <CrashDialog />
      <DropZone />
      <SkippedFilesDialog />
    </div>
  );
}
