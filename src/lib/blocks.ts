import { hashOf } from './art';
import { t } from './i18n';

/**
 * Blocks for instance covers. Each names the textures of its faces as the
 * game files call them (textures/block/<name>.png, 1.13+ names); the
 * textures themselves are read from the player's downloaded client.
 */
export interface BlockDef {
  readonly id: string;
  readonly label: string;
  readonly top: string;
  readonly side: string;
  /** The face that looks out at you, when it differs from the sides. */
  readonly front?: string;
  /** Grass and the like are grey in the files and coloured by the biome. */
  readonly topTint?: string;
}

const GRASS = '#91bd59';

export const BLOCKS: readonly BlockDef[] = [
  { id: 'grass_block', label: t`Трава`, top: 'grass_block_top', side: 'grass_block_side', topTint: GRASS },
  { id: 'oak_log', label: t`Бревно`, top: 'oak_log_top', side: 'oak_log' },
  { id: 'oak_planks', label: t`Доски`, top: 'oak_planks', side: 'oak_planks' },
  { id: 'crafting_table', label: t`Верстак`, top: 'crafting_table_top', side: 'crafting_table_side', front: 'crafting_table_front' },
  { id: 'furnace', label: t`Печь`, top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  { id: 'bookshelf', label: t`Книжная полка`, top: 'oak_planks', side: 'bookshelf' },
  { id: 'tnt', label: t`Динамит`, top: 'tnt_top', side: 'tnt_side' },
  { id: 'stone', label: t`Камень`, top: 'stone', side: 'stone' },
  { id: 'cobblestone', label: t`Булыжник`, top: 'cobblestone', side: 'cobblestone' },
  { id: 'mossy_cobblestone', label: t`Замшелый булыжник`, top: 'mossy_cobblestone', side: 'mossy_cobblestone' },
  { id: 'stone_bricks', label: t`Каменные кирпичи`, top: 'stone_bricks', side: 'stone_bricks' },
  { id: 'bricks', label: t`Кирпичи`, top: 'bricks', side: 'bricks' },
  { id: 'deepslate', label: t`Глубинный сланец`, top: 'deepslate_top', side: 'deepslate' },
  { id: 'diamond_ore', label: t`Алмазная руда`, top: 'diamond_ore', side: 'diamond_ore' },
  { id: 'diamond_block', label: t`Алмазный блок`, top: 'diamond_block', side: 'diamond_block' },
  { id: 'gold_block', label: t`Золотой блок`, top: 'gold_block', side: 'gold_block' },
  { id: 'iron_block', label: t`Железный блок`, top: 'iron_block', side: 'iron_block' },
  { id: 'emerald_block', label: t`Изумрудный блок`, top: 'emerald_block', side: 'emerald_block' },
  { id: 'redstone_block', label: t`Блок редстоуна`, top: 'redstone_block', side: 'redstone_block' },
  { id: 'copper_block', label: t`Медный блок`, top: 'copper_block', side: 'copper_block' },
  { id: 'amethyst_block', label: t`Аметист`, top: 'amethyst_block', side: 'amethyst_block' },
  { id: 'piston', label: t`Поршень`, top: 'piston_top', side: 'piston_side' },
  { id: 'sand', label: t`Песок`, top: 'sand', side: 'sand' },
  { id: 'sandstone', label: t`Песчаник`, top: 'sandstone_top', side: 'sandstone' },
  { id: 'hay_block', label: t`Сено`, top: 'hay_block_top', side: 'hay_block_side' },
  { id: 'melon', label: t`Арбуз`, top: 'melon_top', side: 'melon_side' },
  { id: 'carved_pumpkin', label: t`Тыква`, top: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin' },
  { id: 'honeycomb_block', label: t`Соты`, top: 'honeycomb_block', side: 'honeycomb_block' },
  { id: 'slime_block', label: t`Слизь`, top: 'slime_block', side: 'slime_block' },
  { id: 'packed_ice', label: t`Плотный лёд`, top: 'packed_ice', side: 'packed_ice' },
  { id: 'prismarine', label: t`Призмарин`, top: 'prismarine', side: 'prismarine' },
  { id: 'sea_lantern', label: t`Морской фонарь`, top: 'sea_lantern', side: 'sea_lantern' },
  { id: 'glowstone', label: t`Светокамень`, top: 'glowstone', side: 'glowstone' },
  { id: 'obsidian', label: t`Обсидиан`, top: 'obsidian', side: 'obsidian' },
  { id: 'netherrack', label: t`Незерак`, top: 'netherrack', side: 'netherrack' },
  { id: 'magma_block', label: t`Магма`, top: 'magma', side: 'magma' },
  { id: 'end_stone', label: t`Эндерняк`, top: 'end_stone', side: 'end_stone' },
];

/** Every texture file the catalogue uses, for one request to the backend. */
export const BLOCK_TEXTURES: readonly string[] = [
  ...new Set(BLOCKS.flatMap((block) => [block.top, block.side, ...(block.front === undefined ? [] : [block.front])])),
];

/** Stored in an instance's `glyph` field to mean a block. */
export const BLOCK_PREFIX = 'block:';

export function blockById(id: string): BlockDef | undefined {
  return BLOCKS.find((block) => block.id === id);
}

/** Words in a name that suggest a block, checked in order. */
const HINTS: readonly (readonly [RegExp, string])[] = [
  [/техно|tech|create|механ|индустр|industr|automat|автомат/i, 'piston'],
  [/скай|sky/i, 'grass_block'],
  [/хардкор|hardcore/i, 'tnt'],
  [/хоррор|horror|страш|scary|хэллоуин|хеллоуин|halloween/i, 'carved_pumpkin'],
  [/rlcraft|rpg|приключ|adventure|адвенч|dungeon|данж/i, 'bookshelf'],
  [/pvp|пвп|bedwars|бедвар|skywars/i, 'iron_block'],
  // \b only knows Latin letters, so Cyrillic words are bounded by hand.
  [/маги[яиюей]|magic|(^|\s)маг(\s|$)|волшеб|thaum|botania/i, 'amethyst_block'],
  [/\blab\b|лаборат|тест|test|snapshot|снапшот|экспер/i, 'slime_block'],
  [/космос|space|galact|галакт|planet|планет|энд|\bend\b/i, 'end_stone'],
  [/замок|castle|крепост|medieval|средневек/i, 'stone_bricks'],
  [/ферм|farm|агро/i, 'hay_block'],
  [/океан|ocean|море|sea\b|остров|island/i, 'prismarine'],
  [/снег|зим|winter|snow|ice|лёд|лед/i, 'packed_ice'],
  [/незер|nether|(^|\s)ад(\s|$)|hell|огн|fire/i, 'netherrack'],
  [/пещер|cave|шахт|mine|копа|алмаз|diamond/i, 'diamond_ore'],
  [/строит|build|креатив|creative/i, 'crafting_table'],
  [/perf|оптимиз|fps|sodium|быстр|fast|редстоун|redstone/i, 'redstone_block'],
  [/выжив|survival|лес|forest/i, 'oak_log'],
  [/ванил|vanilla/i, 'grass_block'],
];

export function suggestBlock(name: string): string | null {
  for (const [pattern, id] of HINTS) if (pattern.test(name)) return id;
  return null;
}

/** A block for an instance nobody chose one for: the name's, else the id's. */
export function defaultBlock(instance: { id: string; name: string }): string {
  return (
    suggestBlock(instance.name) ??
    BLOCKS[hashOf(`${instance.id}#block`) % BLOCKS.length]?.id ??
    'grass_block'
  );
}
