import { useState } from 'react';
import type { ReactElement } from 'react';
import { FileArchive, FolderOpen } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import * as packsApi from '@/api/packs';
import { isTauri } from '@/lib/ipc';
import { usePacks } from '@/store/usePacks';
import { useToasts } from '@/store/useToasts';

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
}

function Option({
  icon,
  title,
  text,
  disabled,
  onClick,
}: {
  icon: ReactElement;
  title: string;
  text: string;
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors duration-fast ease-out hover:border-accent disabled:pointer-events-none disabled:opacity-45"
    >
      <span className="mt-0.5 shrink-0 text-text-dim">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-text">{title}</span>
        <span className="mt-1 block text-2xs leading-relaxed text-text-dim">{text}</span>
      </span>
    </button>
  );
}

export function ImportDialog({ open, onClose }: ImportDialogProps): ReactElement {
  const finishImport = usePacks((state) => state.finishImport);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);
  const [busy, setBusy] = useState(false);

  const run = async (pick: () => Promise<string | null>): Promise<void> => {
    if (!isTauri()) {
      notify('Импорт доступен только в приложении');
      return;
    }
    const path = await pick();
    if (path === null) return;
    setBusy(true);
    try {
      finishImport(await packsApi.importPack(path));
      onClose();
    } catch (raw) {
      fail(raw);
    }
    setBusy(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Импорт сборки"
      description="Сборка появится как новая, со своей папкой. Прогресс — в нижней панели."
      busy={busy}
    >
      <div className="flex flex-col gap-2 py-2">
        <Option
          icon={<FileArchive size={16} strokeWidth={1.5} />}
          title="Файл сборки"
          text="Модпак Modrinth (.mrpack), модпак CurseForge (.zip с manifest.json), экспорт MultiMC/Prism или архив FirLauncher."
          disabled={busy}
          onClick={() => {
            void run(packsApi.pickPackFile);
          }}
        />
        <Option
          icon={<FolderOpen size={16} strokeWidth={1.5} />}
          title="Папка MultiMC / Prism"
          text="Папка инстанса, где лежат instance.cfg и mmc-pack.json — например, из instances/ в PrismLauncher."
          disabled={busy}
          onClick={() => {
            void run(packsApi.pickInstanceFolder);
          }}
        />
        {busy && <p className="text-2xs text-text-dim">Импорт идёт…</p>}
      </div>
    </Dialog>
  );
}
