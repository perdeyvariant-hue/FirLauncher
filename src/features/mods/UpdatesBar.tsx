import type { ReactElement } from 'react';
import { ArrowUpCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import type { ContentUpdates } from './useContentUpdates';

/** "Check for updates", then "select all / update selected / update all". */
export function UpdatesBar({
  state,
  canCheck,
}: {
  state: ContentUpdates;
  canCheck: boolean;
}): ReactElement {
  const pending = [...state.updates.values()];
  const chosen = pending.filter((update) => state.selected.has(update.fileName));
  const busy = state.updating.size > 0;
  const all = chosen.length === pending.length;

  return (
    <>
      {canCheck && (
        <Button
          size="sm"
          loading={state.checking}
          disabled={busy}
          icon={<RefreshCw size={13} strokeWidth={1.5} />}
          onClick={() => {
            void state.check();
          }}
        >
          Проверить обновления
        </Button>
      )}

      {pending.length > 0 && (
        <>
          <div className="flex h-8 items-center gap-2 rounded-lg border border-border px-2.5">
            <Checkbox
              label={all ? 'Снять выбор со всех' : 'Выбрать все обновления'}
              checked={all}
              indeterminate={chosen.length > 0 && !all}
              disabled={busy}
              onChange={(on) => {
                for (const update of pending) state.setSelected(update.fileName, on);
              }}
            />
            <span className="text-2xs text-text-dim">
              {chosen.length} из {pending.length}
            </span>
          </div>
          {!all && (
            <Button
              size="sm"
              disabled={chosen.length === 0 || busy}
              icon={<ArrowUpCircle size={14} strokeWidth={1.5} />}
              onClick={() => {
                void state.apply(chosen);
              }}
            >
              Обновить выбранные ({chosen.length})
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            icon={<ArrowUpCircle size={14} strokeWidth={1.5} />}
            onClick={() => {
              void state.apply(pending);
            }}
          >
            Обновить все ({pending.length})
          </Button>
        </>
      )}
    </>
  );
}
