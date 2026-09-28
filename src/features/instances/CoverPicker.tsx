import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { ART_GRADIENTS, artGradient } from '@/lib/art';
import { GLYPHS, Glyph, LETTERS } from '@/lib/glyphs';
import { t } from '@/lib/i18n';

export interface CoverPickerProps {
  color: number;
  /** The picture currently shown, including one picked automatically. */
  glyph: string;
  onColor: (color: number) => void;
  onGlyph: (glyph: string) => void;
}

/** Cover colour and picture: seven gradients and the glyph set, plus initials. */
export function CoverPicker({ color, glyph, onColor, onGlyph }: CoverPickerProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-[7px]" role="radiogroup" aria-label={t`Цвет обложки`}>
        {ART_GRADIENTS.map((_, index) => (
          <button
            key={index}
            type="button"
            role="radio"
            aria-checked={index === color}
            aria-label={t`Цвет ${String(index + 1)}`}
            onClick={() => {
              onColor(index);
            }}
            className="h-5 w-5 rounded-full transition-transform duration-fast hover:scale-110"
            style={{
              background: artGradient(index),
              boxShadow:
                index === color
                  ? '0 0 0 2px var(--sheet), 0 0 0 4px rgb(var(--accent-rgb))'
                  : 'inset 0 1px 0 rgb(255 255 255 / 0.4)',
            }}
          />
        ))}
      </div>

      <div role="radiogroup" aria-label={t`Значок`} className="flex flex-wrap gap-1.5">
        {[{ id: LETTERS, label: t`Инициалы` }, ...GLYPHS].map((item) => {
          const selected = item.id === glyph;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={item.label}
              aria-label={item.label}
              onClick={() => {
                onGlyph(item.id);
              }}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-[10px] transition-[background,box-shadow,transform] duration-fast active:scale-90',
                selected
                  ? 'text-white shadow-[0_0_0_2px_var(--sheet),0_0_0_3.5px_rgb(var(--accent-rgb))]'
                  : 'bg-[var(--chip)] text-text-dim hover:bg-[var(--hover)] hover:text-text',
              )}
              style={selected ? { background: artGradient(color) } : undefined}
            >
              {item.id === LETTERS ? (
                <span className="font-mono text-[11px] font-bold">Аа</span>
              ) : (
                <Glyph id={item.id} size={16} strokeWidth={1.9} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
