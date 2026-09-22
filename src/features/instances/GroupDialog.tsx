import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import type { Instance } from '@/types/instance';
import { t } from '@/lib/i18n';

export interface GroupDialogProps {
  instance: Instance | null;
  /** Every group name in use, for one-click choice. */
  groups: readonly string[];
  onClose: () => void;
  onSave: (group: string | null) => void;
}

/** Moves an instance into an existing group, a new one, or out of groups. */
export function GroupDialog({ instance, groups, onClose, onSave }: GroupDialogProps): ReactElement {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(instance?.group ?? '');
  }, [instance]);

  const trimmed = value.trim();
  return (
    <Dialog
      open={instance !== null}
      onClose={onClose}
      width="sm"
      title={instance === null ? '' : t`Группа для «${instance.name}»`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onSave(null);
            }}
          >
            {t`Без группы`}</Button>
          <Button
            variant="primary"
            disabled={trimmed === ''}
            onClick={() => {
              onSave(trimmed);
            }}
          >
            {t`Сохранить`}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        <Input
          label={t`Название группы`}
          placeholder={t`Например, «Выживание» или «С друзьями»`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && trimmed !== '') onSave(trimmed);
          }}
        />
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {groups.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => {
                  setValue(group);
                }}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-2xs',
                  'transition-colors duration-fast ease-out',
                  group === trimmed
                    ? 'border-accent text-accent'
                    : 'border-border text-text-dim hover:text-text',
                )}
              >
                {group === trimmed && <Check size={11} strokeWidth={2} />}
                {group}
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
