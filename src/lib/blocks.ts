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
  // The blocks each update is remembered by, newest first.
  { id: 'crafter', label: t`Крафтер`, top: 'crafter_top', side: 'crafter_east', front: 'crafter_north' },
  { id: 'cherry_log', label: t`Вишнёвое бревно`, top: 'cherry_log_top', side: 'cherry_log' },
  { id: 'sculk_catalyst', label: t`Скалк-катализатор`, top: 'sculk_catalyst_top', side: 'sculk_catalyst_side' },
  { id: 'deepslate_diamond_ore', label: t`Глубинная алмазная руда`, top: 'deepslate_diamond_ore', side: 'deepslate_diamond_ore' },
  { id: 'ancient_debris', label: t`Древние обломки`, top: 'ancient_debris_top', side: 'ancient_debris_side' },
  { id: 'bee_nest', label: t`Пчелиное гнездо`, top: 'bee_nest_top', side: 'bee_nest_side', front: 'bee_nest_front' },
  { id: 'barrel', label: t`Бочка`, top: 'barrel_top', side: 'barrel_side' },
  { id: 'tube_coral_block', label: t`Трубчатый коралл`, top: 'tube_coral_block', side: 'tube_coral_block' },
  { id: 'magenta_glazed_terracotta', label: t`Глазурованная керамика`, top: 'magenta_glazed_terracotta', side: 'magenta_glazed_terracotta' },
  { id: 'observer', label: t`Наблюдатель`, top: 'observer_top', side: 'observer_side', front: 'observer_front' },
  { id: 'purpur_block', label: t`Пурпур`, top: 'purpur_block', side: 'purpur_block' },
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

/**
 * The block each update is known by, keyed by its minor version: 1.16 is the
 * Nether Update, so its instances wear ancient debris.
 */
const SIGNATURES: readonly (readonly [number, string])[] = [
  [21, 'crafter'],
  [20, 'cherry_log'],
  [19, 'sculk_catalyst'],
  [18, 'deepslate_diamond_ore'],
  [17, 'amethyst_block'],
  [16, 'ancient_debris'],
  [15, 'bee_nest'],
  [14, 'barrel'],
  [13, 'tube_coral_block'],
  [12, 'magenta_glazed_terracotta'],
  [11, 'observer'],
  [10, 'magma_block'],
  [9, 'purpur_block'],
  [8, 'sea_lantern'],
  [7, 'packed_ice'],
  [6, 'hay_block'],
  [5, 'redstone_block'],
];

/**
 * The block for a game version. Snapshots and anything newer than the table
 * get the newest update's block; the oldest versions get grass.
 */
export function versionBlock(mcVersion: string): string {
  const minor = /^1\.(\d+)/.exec(mcVersion)?.[1];
  const newest = SIGNATURES[0]?.[1] ?? 'grass_block';
  if (minor === undefined) return newest;
  const number = Number(minor);
  if (number > (SIGNATURES[0]?.[0] ?? 0)) return newest;
  return SIGNATURES.find(([version]) => version === number)?.[1] ?? 'grass_block';
}

/** A block for an instance nobody chose one for: its game version's. */
export function defaultBlock(instance: { mcVersion: string }): string {
  return versionBlock(instance.mcVersion);
}
