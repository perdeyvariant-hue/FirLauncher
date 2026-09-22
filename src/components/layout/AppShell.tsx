import type { ReactElement, ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TaskBar } from './TaskBar';
import { ToastHost } from '@/components/ui/ToastHost';
import { BackgroundLayer } from '@/features/appearance/BackgroundLayer';
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
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <BackgroundLayer />
          <div className="relative h-full">{children}</div>
        </main>
        <TaskBar />
      </div>
      <ToastHost />
      <ExportDialog />
      <SkippedFilesDialog />
    </div>
  );
}
