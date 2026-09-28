import { useLaunch } from '@/store/useLaunch';

/** Browser preview only: plays a believable game start into the launch card. */
const LINES: readonly string[] = [
  '[{t}] [main/INFO]: Loading Minecraft 1.21.1 with Fabric Loader 0.16.9',
  '[{t}] [main/INFO]: Loading 42 mods',
  '[{t}] [main/INFO]: Java 21.0.5 (Eclipse Adoptium), -Xmx6144M',
  '[{t}] [Render thread/INFO]: Backend library: LWJGL version 3.3.3+5',
  '[{t}] [Render thread/WARN]: Missing sound for event: minecraft:item.goat_horn.play',
  '[{t}] [Render thread/INFO]: Reloading ResourceManager: vanilla, fabric, sodium',
  '[{t}] [Worker-Main-3/INFO]: Found unifont_all_no_pua-15.1.05.hex, loading',
  '[{t}] [Render thread/INFO]: OpenAL initialized on device Built-in Output',
  '[{t}] [Render thread/INFO]: Sound engine started',
  '[{t}] [Render thread/INFO]: Created: 1024x1024x4 minecraft:textures/atlas/blocks.png-atlas',
  '[{t}] [Render thread/WARN]: Shader rendertype_entity_translucent_emissive could not find sampler named Sampler2',
  '[{t}] [Render thread/INFO]: Setting user: Firwood',
  '[{t}] [Render thread/INFO]: Narrator library successfully loaded',
];

export function simulateLaunch(): void {
  let index = 0;
  const timer = setInterval(() => {
    const line = LINES[index];
    if (line === undefined) {
      clearInterval(timer);
      useLaunch.getState().started();
      return;
    }
    const time = new Date().toTimeString().slice(0, 8);
    useLaunch.getState().push('stdout', line.replace('{t}', time));
    index += 1;
  }, 190);
}
