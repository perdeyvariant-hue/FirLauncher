import type { ReactElement } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { openExternal } from '@/api/system';
import { usePacks } from '@/store/usePacks';

/** After an import: files that must be fetched by hand, with links. */
export function SkippedFilesDialog(): ReactElement {
  const skipped = usePacks((state) => state.skipped);
  const close = usePacks((state) => state.closeSkipped);

  return (
    <Dialog
      open={skipped !== null}
      onClose={close}
      title="Не все файлы скачались"
      description="Сборка создана, но эти файлы нужно скачать вручную и положить в папку сборки (обычно mods)."
      footer={
        <Button variant="primary" onClick={close}>
          Понятно
        </Button>
      }
    >
      <ul className="flex flex-col gap-1.5 py-2">
        {(skipped ?? []).map((file) => (
          <li key={file.name} className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-text">{file.name}</p>
              <p className="truncate text-2xs text-text-dim">{file.reason}</p>
            </div>
            {file.url !== null && (
              <IconButton
                label="Открыть страницу"
                size="sm"
                icon={<ExternalLink size={13} strokeWidth={1.5} />}
                onClick={() => {
                  void openExternal(file.url ?? '');
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
