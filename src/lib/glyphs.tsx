import type { ComponentType, ReactElement } from 'react';
import type { LucideProps } from 'lucide-react';
import {
  Axe,
  Box,
  Castle,
  Cat,
  Cloud,
  Cog,
  Crown,
  Fish,
  FlaskConical,
  Flame,
  Gem,
  Ghost,
  Hammer,
  Heart,
  Moon,
  MountainSnow,
  Pickaxe,
  Rocket,
  Shield,
  Shovel,
  Skull,
  Snowflake,
  Sprout,
  Star,
  Sun,
  Sword,
  Swords,
  TreePine,
  Trees,
  Waves,
  Wheat,
  Zap,
} from 'lucide-react';
import { hashOf } from './art';
import { t } from './i18n';

/** The initials instead of a picture. */
export const LETTERS = 'letters';

export interface GlyphDef {
  readonly id: string;
  readonly label: string;
  readonly Icon: ComponentType<LucideProps>;
}

/** Pictures for instance covers. Ids are stored, so never rename one. */
export const GLYPHS: readonly GlyphDef[] = [
  { id: 'pickaxe', label: t`Кирка`, Icon: Pickaxe },
  { id: 'sword', label: t`Меч`, Icon: Sword },
  { id: 'swords', label: t`Мечи`, Icon: Swords },
  { id: 'axe', label: t`Топор`, Icon: Axe },
  { id: 'shovel', label: t`Лопата`, Icon: Shovel },
  { id: 'hammer', label: t`Молот`, Icon: Hammer },
  { id: 'cube', label: t`Блок`, Icon: Box },
  { id: 'fir', label: t`Ель`, Icon: TreePine },
  { id: 'forest', label: t`Лес`, Icon: Trees },
  { id: 'mountain', label: t`Гора`, Icon: MountainSnow },
  { id: 'sprout', label: t`Росток`, Icon: Sprout },
  { id: 'wheat', label: t`Пшеница`, Icon: Wheat },
  { id: 'flame', label: t`Пламя`, Icon: Flame },
  { id: 'gem', label: t`Кристалл`, Icon: Gem },
  { id: 'potion', label: t`Зелье`, Icon: FlaskConical },
  { id: 'heart', label: t`Сердце`, Icon: Heart },
  { id: 'star', label: t`Звезда`, Icon: Star },
  { id: 'moon', label: t`Луна`, Icon: Moon },
  { id: 'sun', label: t`Солнце`, Icon: Sun },
  { id: 'snowflake', label: t`Снежинка`, Icon: Snowflake },
  { id: 'cloud', label: t`Облако`, Icon: Cloud },
  { id: 'waves', label: t`Волны`, Icon: Waves },
  { id: 'fish', label: t`Рыба`, Icon: Fish },
  { id: 'cat', label: t`Кот`, Icon: Cat },
  { id: 'skull', label: t`Череп`, Icon: Skull },
  { id: 'ghost', label: t`Призрак`, Icon: Ghost },
  { id: 'shield', label: t`Щит`, Icon: Shield },
  { id: 'castle', label: t`Замок`, Icon: Castle },
  { id: 'crown', label: t`Корона`, Icon: Crown },
  { id: 'rocket', label: t`Ракета`, Icon: Rocket },
  { id: 'cog', label: t`Шестерня`, Icon: Cog },
  { id: 'zap', label: t`Молния`, Icon: Zap },
];

/** Words in an instance's name that suggest a picture, checked in order. */
const HINTS: readonly (readonly [RegExp, string])[] = [
  [/техно|tech|create|механ|индустр|industr|automat|автомат/i, 'cog'],
  [/скай|sky/i, 'cloud'],
  [/хардкор|hardcore/i, 'skull'],
  [/хоррор|horror|страш|scary/i, 'ghost'],
  [/rlcraft|rpg|приключ|adventure|адвенч|dungeon|данж/i, 'swords'],
  [/pvp|пвп|bedwars|бедвар|skywars/i, 'sword'],
  // \b only knows Latin letters, so Cyrillic words are bounded by hand.
  [/маги[яиюей]|magic|(^|\s)маг(\s|$)|волшеб|thaum|botania/i, 'potion'],
  [/\blab\b|лаборат|тест|test|snapshot|снапшот|экспер/i, 'potion'],
  [/космос|space|galact|галакт|planet|планет/i, 'rocket'],
  [/замок|castle|крепост|medieval|средневек/i, 'castle'],
  [/ферм|farm|агро/i, 'wheat'],
  [/океан|ocean|море|sea\b|остров|island/i, 'waves'],
  [/снег|зим|winter|snow|ice|лёд|лед/i, 'snowflake'],
  [/незер|nether|(^|\s)ад(\s|$)|hell|огн|fire/i, 'flame'],
  [/пещер|cave|шахт|mine|копа/i, 'pickaxe'],
  [/строит|build|креатив|creative/i, 'hammer'],
  [/perf|оптимиз|fps|sodium|быстр|fast/i, 'zap'],
  [/выжив|survival|лес|forest/i, 'fir'],
  [/ванил|vanilla/i, 'cube'],
];

/** The picture a name suggests, if any word in it does. */
export function suggestGlyph(name: string): string | null {
  for (const [pattern, id] of HINTS) if (pattern.test(name)) return id;
  return null;
}

export function glyphById(id: string): GlyphDef | undefined {
  return GLYPHS.find((glyph) => glyph.id === id);
}

/**
 * The picture an instance shows: the one chosen for it, else one its name
 * suggests, else one picked by its id so it never changes between starts.
 */
export function glyphOf(instance: { id: string; name: string; glyph: string | null }): string {
  if (instance.glyph !== null && (instance.glyph === LETTERS || glyphById(instance.glyph) !== undefined)) {
    return instance.glyph;
  }
  const suggested = suggestGlyph(instance.name);
  if (suggested !== null) return suggested;
  return GLYPHS[hashOf(`${instance.id}#glyph`) % GLYPHS.length]?.id ?? 'cube';
}

/** A cover picture, drawn white so it reads on any of the gradients. */
export function Glyph({
  id,
  size,
  strokeWidth = 1.75,
  className,
}: {
  id: string;
  size: number;
  strokeWidth?: number;
  className?: string;
}): ReactElement | null {
  const glyph = glyphById(id);
  if (glyph === undefined) return null;
  const { Icon } = glyph;
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden />;
}
