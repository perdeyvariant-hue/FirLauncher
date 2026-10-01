import { useState } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { Segmented } from '@/components/ui/Segmented';
import { ART_GRADIENTS, artGradient } from '@/lib/art';
import { BLOCKS, BLOCK_PREFIX } from '@/lib/blocks';
import { GLYPHS, Glyph, LETTERS } from '@/lib/glyphs';
import { useVersionTextures } from '@/store/useGameArt';
import { t } from '@/lib/i18n';
import { BlockIcon } from './BlockIcon';

export interface CoverPickerProps {
  color: number;
  /** Whose textures the blocks are drawn with. */
  version: string;
  /** What the cover shows now: `block:<id>`, a glyph id or `letters`. */
  glyph: string;
  onColor: (color: number) => void;
  onGlyph: (glyph: string) => void;
}

const TILE =
  'grid h-9 w-9 place-items-center rounded-[10px] transition-[background,box-shadow,transform] duration-fast active:scale-90';

/**
 * Cover colour and what stands on it: a block from the game (when its
 * textures are on this computer), a drawn picture, or the initials.
 */
export function CoverPicker({ color, version, glyph, onColor, onGlyph }: CoverPickerProps): ReactElement {
  const textures = useVersionTextures(version);
  const blocks = BLOCKS.filter((block) => block.top in textures && block.side in textures);
  const [tab, setTab] = useState<'blocks' | 'glyphs'>(
    blocks.length > 0 && (glyph.startsWith(BLOCK_PREFIX) || glyph === '') ? 'blocks' : 'glyphs',
  );
  const showBlocks = blocks.length > 0 && tab === 'blocks';

  const ring = (selected: boolean): string =>
    selected
      ? 'shadow-[0_0_0_2px_var(--sheet-solid),0_0_0_3.5px_rgb(var(--accent-rgb))]'
      : 'bg-[var(--chip)] hover:bg-[var(--hover)]';

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
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
                    ? '0 0 0 2px var(--sheet-solid), 0 0 0 4px rgb(var(--accent-rgb))'
                    : 'inset 0 1px 0 rgb(255 255 255 / 0.3)',
              }}
            />
          ))}
        </div>
        {blocks.length > 0 && (
          <Segmented
            className="ml-auto"
            label={t`Что на обложке`}
            value={tab}
            options={[
              { value: 'blocks', label: t`Блоки` },
              { value: 'glyphs', label: t`Значки` },
            ]}
            onChange={setTab}
          />
        )}
      </div>

      {showBlocks ? (
        <div role="radiogroup" aria-label={t`Блок`} className="flex flex-wrap gap-1.5">
          {blocks.map((block) => {
            const value = `${BLOCK_PREFIX}${block.id}`;
            const selected = value === glyph;
            return (
              <button
                key={block.id}
                type="button"
                role="radio"
                aria-checked={selected}
                title={block.label}
                aria-label={block.label}
                onClick={() => {
                  onGlyph(value);
                }}
                className={cn(TILE, ring(selected))}
                style={selected ? { background: artGradient(color) } : undefined}
              >
                <BlockIcon block={block} textures={textures} size={28} />
              </button>
            );
          })}
        </div>
      ) : (
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
                className={cn(TILE, selected ? 'text-white' : 'text-text-dim hover:text-text', ring(selected))}
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
      )}
    </div>
  );
}
