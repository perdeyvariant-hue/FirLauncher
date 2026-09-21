# FirLauncher

Минималистичный десктопный лаунчер Minecraft для управления сборками — аналог PrismLauncher
с современным тёмным интерфейсом. Windows, Linux, macOS.

Вся тяжёлая работа (скачивание, проверка SHA1, распаковка, запуск JVM) выполняется в Rust;
фронтенд только рисует и слушает события прогресса.

---

## Стек

| Слой | Технологии |
| --- | --- |
| Оболочка | Tauri 2 |
| Бэкенд | Rust · tokio · reqwest · serde · sha1 · zip · thiserror · keyring |
| Фронтенд | React 18 · TypeScript (strict) · Vite |
| Состояние | Zustand |
| Стили | Tailwind CSS с собственными токенами, без UI-китов |
| Иконки | Lucide (stroke 1.5) |
| Шрифты | Inter (интерфейс), JetBrains Mono (логи и консоль) |

---

## Требования

- **Node.js** 20+ и npm.
- **Rust** (stable) через [rustup](https://rustup.rs).
- **Системные зависимости Tauri** — см. https://tauri.app/start/prerequisites/:
  - Windows: Visual Studio Build Tools с компонентом «Desktop development with C++» и WebView2
    (в Windows 11 уже установлен);
  - Linux: `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, `patchelf`, `build-essential`;
  - macOS: Xcode Command Line Tools.

Быстрая установка на Windows:

```powershell
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
  --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

---

## Сборка и запуск

```bash
npm install

# режим разработки: окно приложения + HMR фронтенда
npm run tauri dev

# установщик под текущую ОС (.msi/.exe, .deb/.AppImage, .dmg)
npm run tauri build
```

Отдельно фронтенд (в обычном браузере, с фикстурами вместо бэкенда):

```bash
npm run dev        # http://localhost:1420
```

Проверки качества:

```bash
npm run typecheck                                            # tsc --noEmit, строгий режим
npm run lint                                                 # ESLint, запрет any
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib        # правила, слияние версий, аргументы
```

### Если проект лежит в OneDrive / Dropbox

Папка `target/` — это сотни тысяч файлов; синхронизация её не переживает. Положите артефакты
сборки на локальный диск, создав `src-tauri/.cargo/config.toml` (файл в `.gitignore`):

```toml
[build]
target-dir = "C:/Users/<вы>/AppData/Local/FirLauncher/target"
```

---

## Где лежат данные

| ОС | Путь |
| --- | --- |
| Windows | `%APPDATA%\FirLauncher` |
| Linux | `~/.config/FirLauncher` |
| macOS | `~/Library/Application Support/FirLauncher` |

```
instances/<id>/instance.json      описание сборки
instances/<id>/.minecraft/        полностью изолированная папка игры
                                  (mods/, config/, saves/, resourcepacks/, logs/, screenshots/)
meta/                             кеш манифестов версий и лоадеров
assets/                           общие ассеты Minecraft
libraries/                        общие библиотеки
java/                             скачанные JDK
accounts.json, settings.json
```

Путь можно переопределить в «Настройки → Папка данных».

---

## Проверка ядра без интерфейса

Скачивание и сборку команды запуска можно прогнать headless, не открывая окно:

```bash
# только установка и печать команды запуска
cargo run --example vanilla_smoke --manifest-path src-tauri/Cargo.toml -- 1.20.4 ./smoke-data

# то же плюс реальный запуск игры на 25 секунд
cargo run --example vanilla_smoke --manifest-path src-tauri/Cargo.toml -- 1.20.4 ./smoke-data --run 25
```

Пример использует те же `install::ensure_installed` и `session::build_spec`, что и кнопка
«Играть», поэтому проверяет ровно то, что выполняется в приложении.

---

## Модлоадеры

Лоадер выбирается при создании сборки, а ставится при первом запуске — поверх ванильной версии,
через профиль с `inheritsFrom`. Дальше запуск проверяет только наличие профиля в кеше.

| Лоадер | Источник версий | Установка |
| --- | --- | --- |
| Fabric | `meta.fabricmc.net` | готовый профиль из meta API |
| Quilt | `meta.quiltmc.org` | готовый профиль из meta API |
| NeoForge | `maven.neoforged.net` | установщик: библиотеки + процессоры |
| Forge | `maven.minecraftforge.net` | установщик: библиотеки + процессоры |

Установщики Forge и NeoForge не запускаются вслепую: лаунчер читает их `install_profile.json`
и выполняет шаги сам (как PrismLauncher), поэтому видит прогресс, отменяет их и показывает
вывод упавшего шага. Поддерживаются три поколения установщиков — с процессорами (1.13+ и весь
NeoForge), переизданные легаси (свежие сборки 1.12.2) и старый формат `versionInfo` (1.7.10
и соседние). Профиль версии записывается в кеш только после успешного завершения всех шагов,
поэтому при следующих запусках лоадер не переустанавливается. Если установка прервалась,
она повторится целиком; процессоры, объявившие хеши своих выходных файлов, при совпадении
пропускаются.

Сопоставление версий NeoForge с версиями игры идёт покомпонентно: `1.21.1` → `21.1.x`,
годовые версии дополняются до трёх частей (`26.1` → `26.1.0.x`). Строковое сравнение здесь
ошибалось бы: `21.1.` — это префикс и `21.10.x`, и `21.11.x`.

Проверено реальным запуском игры: Fabric и Quilt на 1.20.4, Forge 1.20.1 (процессоры),
NeoForge 21.1 на 1.21.1 (процессоры, Java 21), Forge 1.12.2 (переизданный установщик, Java 8)
и Forge 1.7.10 (формат `versionInfo`).

Проверить любой лоадер без интерфейса:

```bash
cargo run --example vanilla_smoke --manifest-path src-tauri/Cargo.toml -- 1.20.4 ./smoke-data --loader fabric latest --run 40
```

---

## Моды

Во вкладке «Моды» сборки есть браузер: поиск по Modrinth и CurseForge с фильтрами по категории
и сортировкой. Версия игры и лоадер берутся из сборки, так что показываются только совместимые
моды; сборки на Quilt видят и Fabric-моды, NeoForge для 1.20.1 — и Forge-моды.

- **Установка в один клик.** Лаунчер подбирает свежий релиз под сборку и обходит обязательные
  зависимости. Если с модом приезжает что-то ещё — или какую-то зависимость найти не удалось —
  сначала показывается диалог подтверждения.
- **Обновления.** «Проверить обновления» сверяет файлы из `mods/` по SHA1 с Modrinth, включая
  моды, положенные туда вручную. Моды CurseForge проверяются, если они ставились через лаунчер.
  Обновление заменяет файл, выключенные моды остаются выключенными.
- **Индекс источников** — `instances/<id>/mods.json`: откуда пришёл каждый файл.

Оба источника реализуют один трейт `ModProvider`
([`src-tauri/src/mods/provider.rs`](src-tauri/src/mods/provider.rs)), поэтому новый источник —
это одна реализация трейта и одна строка в `mods::providers()`. Запросы идут через общий
ограничитель частоты (Modrinth разрешает 300 в минуту), при `429` лаунчер ждёт столько, сколько
просит сервер (`Retry-After` / `X-Ratelimit-Reset`).

**CurseForge** включается, только когда есть ключ API. Если автор мода запретил
скачивание в сторонних лаунчерах, API не отдаёт ссылку на файл, и лаунчер не пытается её
подделать: он предлагает скачать мод вручную со страницы проекта.

Ключ можно задать двумя способами:

- **Вшить при сборке** — так собираются релизы с одобренным ключом. Ключ берётся из переменной
  `FIRLAUNCHER_CURSEFORGE_KEY`, в репозиторий не попадает, на фронтенд не передаётся, а поле
  в настройках скрывается — поменять ключ из приложения нельзя:
  ```bash
  FIRLAUNCHER_CURSEFORGE_KEY=<ключ> npm run tauri build            # bash / zsh
  ```
  ```powershell
  $env:FIRLAUNCHER_CURSEFORGE_KEY = "<ключ>"; npm run tauri build   # PowerShell
  ```
  Чтобы не задавать переменную каждый раз, её можно прописать в `.cargo/config.toml`
  (файл в `.gitignore`):
  ```toml
  [env]
  FIRLAUNCHER_CURSEFORGE_KEY = "<ключ>"
  ```
  В CI — через секрет (например, GitHub Actions Secrets). Учтите, что вшитый ключ можно
  извлечь из бинарника: так устроены все лаунчеры с общим ключом, поэтому распространять
  сборки с ключом стоит только после одобрения заявки CurseForge.
- **В настройках** — «Настройки → Сеть и источники», если лаунчер собран без ключа.

Проверить цепочку поиск → зависимости → установка → обновление против живого Modrinth:

```bash
cargo run --example mods_smoke --manifest-path src-tauri/Cargo.toml -- ./smoke-data iris
cargo run --example mods_smoke --manifest-path src-tauri/Cargo.toml -- ./smoke-data faithful-64x --kind resourcepack
```

### Ресурспаки и шейдеры

Вкладки «Ресурспаки» и «Шейдеры» устроены так же, как «Моды»: список установленного, кнопка
«Добавить» открывает браузер Modrinth/CurseForge, установка в один клик. Ресурспаки подходят
к любой сборке (фильтр — только по версии игры), шейдеры кладутся в `shaderpacks/` — для них
в сборке нужен Iris/Oculus или OptiFine. Источники хранятся в `resourcepacks.json` и
`shaderpacks.json`. Проверка обновлений пока работает только для модов.

---

## Импорт, экспорт и модпаки

На странице «Сборки» — кнопки «Импорт» и «Модпаки».

**Импорт** создаёт новую сборку со своей папкой. Формат определяется по содержимому:

| Что | Как распознаётся |
|---|---|
| Модпак Modrinth `.mrpack` | `modrinth.index.json` в архиве |
| Модпак CurseForge `.zip` | `manifest.json` в архиве (нужен ключ CurseForge) |
| Экспорт MultiMC / PrismLauncher `.zip` или папка | `instance.cfg` + `mmc-pack.json` |
| Архив FirLauncher `.zip` | `instance.json` в архиве |

Файлы из `.mrpack` скачиваются только с разрешённых хостов (`cdn.modrinth.com`, `github.com`,
`raw.githubusercontent.com`, `gitlab.com`) и сверяются по SHA1; пути внутри архивов
проверяются, выйти за папку сборки нельзя. Если файл скачать нельзя (автор мода на CurseForge
запретил сторонние лаунчеры, хост не из списка), импорт не падает — в конце показывается
список пропущенных файлов со ссылками на страницы проектов. Из MultiMC/Prism переносятся
память и JVM-аргументы.

**Модпаки** — поиск модпаков Modrinth и CurseForge прямо в лаунчере; «Установить» скачивает
последнюю версию и импортирует её как `.mrpack` / CurseForge-архив.

**Экспорт** (контекстное меню карточки или кнопка на странице сборки):

- `.mrpack` — моды, ресурспаки и шейдеры, найденные на Modrinth по хешу, записываются ссылками;
  остальное (выключенные моды, конфиги, `kubejs/`, `scripts/`) кладётся в `overrides/`.
- `.zip` — полная копия сборки для переноса в другой FirLauncher, без логов, крашрепортов и кеша.

Проверить импорт и экспорт без интерфейса:

```bash
cargo run --example packs_smoke --manifest-path src-tauri/Cargo.toml -- ./smoke-data ./pack.mrpack
cargo run --example packs_smoke --manifest-path src-tauri/Cargo.toml -- ./smoke-data modrinth:fabulously-optimized
```

---

## Вход через Microsoft

Вход идёт по коду устройства: лаунчер показывает короткий код, вы подтверждаете его на сайте
Microsoft в любом браузере. Пароль через лаунчер не проходит.

```
код устройства → токен Microsoft → Xbox Live → XSTS → токен Minecraft → профиль
```

### Client ID

Для этого нужен **Client ID приложения Azure**. Своего ID в репозитории нет и не будет: чужой
встраивать нельзя, а собственный — это ваш ключ.

1. Зарегистрируйте приложение на [portal.azure.com](https://portal.azure.com) → *App registrations*:
   тип аккаунтов — **Personal Microsoft accounts only**, в разделе *Authentication* включите
   **Allow public client flows** (без этого device code не работает).
2. Запросите у Mojang доступ этого приложения к Minecraft API — ссылка на форму есть на
   [aka.ms/AppRegInfo](https://aka.ms/AppRegInfo). Пока доступа нет, Microsoft вход пропустит,
   а `api.minecraftservices.com` ответит `403 Invalid app registration` — лаунчер покажет это
   отдельным понятным сообщением.
3. Передайте ID лаунчеру одним из способов:
   - при сборке — ID вшивается в бинарник, Cargo пересоберёт крейт, если значение изменится:
     ```bash
     FIRLAUNCHER_MSA_CLIENT_ID=<id> npm run tauri build            # bash / zsh
     ```
     ```powershell
     $env:FIRLAUNCHER_MSA_CLIENT_ID = "<id>"; npm run tauri build   # PowerShell
     ```
   - в приложении: «Настройки → Вход через Microsoft» — перекрывает вшитый.

Проверить регистрацию можно без интерфейса, тем же кодом, что использует приложение (токены
держатся только в памяти, ни keyring, ни ваши аккаунты не трогаются):

```bash
cargo run --example msa_login --manifest-path src-tauri/Cargo.toml -- <client-id>
```

### Где хранятся токены

- Refresh-токен и кешированный токен Minecraft — в системном хранилище: Windows Credential
  Manager, macOS Keychain, Secret Service на Linux (нужен gnome-keyring или KWallet).
  Значения крупнее лимита одной записи Windows (2560 байт) делятся на части.
- В `accounts.json` — только ник, UUID, ссылка на скин и готовая картинка головы.
- Токен Minecraft живёт 24 часа и обновляется сам: при старте лаунчера в фоне и перед запуском
  игры, если до истечения меньше 5 минут. Если Microsoft отозвал доступ, аккаунт помечается
  «Сессия истекла» и предлагает войти заново — запуск не падает молча.

---

## Структура репозитория

```
src/                      фронтенд
  api/                    единственный слой, знающий про invoke (моки ↔ IPC)
  components/ui/          дизайн-система: Button, Dialog, Tabs, Slider, ContextMenu, …
  components/layout/      Sidebar, AccountCard, TaskBar, AppShell
  features/               instances, accounts, mods, packs, settings
  store/                  Zustand-сторы
  types/                  типы, зеркалящие Rust-структуры
  lib/                    ipc, events, format, useAsyncData
  mocks/                  фикстуры этапа 1
src-tauri/                бэкенд
  src/error.rs            LauncherError → {kind, message, detail, retryable}
  src/paths.rs            раскладка данных по ОС
  src/state.rs            общее состояние: пути, настройки, HTTP-клиент, задачи, игры
  src/net/                клиент с User-Agent, retry с backoff, параллельный загрузчик
  src/tasks/              реестр задач и события task://update и task://finished
  src/config/             settings.json и атомарная запись JSON
  src/minecraft/          манифест, слияние версий, правила, библиотеки, ассеты,
                          аргументы, установка и запуск процесса
  src/java/               поиск JDK и загрузка с Adoptium
  src/instances/          instance.json, содержимое папок сборки
  src/accounts/           хранилище аккаунтов и оффлайн-UUID
  src/mods/               ModProvider, Modrinth, CurseForge, зависимости, обновления
  src/packs/              импорт .mrpack / CurseForge / MultiMC / zip, экспорт
  src/loaders/            Fabric, Quilt, NeoForge, Forge и общий разбор установщиков
  src/auth/               вход Microsoft: device code, Xbox Live, XSTS, Minecraft,
                          keyring с разбиением на части, рендер головы из скина
  src/commands/           поверхность, доступная фронтенду
  examples/vanilla_smoke.rs  headless-проверка ядра
  examples/msa_login.rs      вход Microsoft в терминале
  examples/mods_smoke.rs     моды: поиск, зависимости, установка, обновление
  examples/packs_smoke.rs    импорт и экспорт сборок, установка модпака
```

---

## Дизайн-система

Токены объявлены в [`src/styles/tokens.css`](src/styles/tokens.css) и подключены к Tailwind
как RGB-каналы, поэтому работают модификаторы прозрачности (`bg-accent/15`) и переключение темы
одним атрибутом `data-theme` на `<html>`.

```
--bg #0A0A0B   --surface #131315   --surface-2 #1C1C20   --border #26262B
--text #F4F4F5 --text-dim #8A8A93
--accent #8B5CF6  --accent-hover #A78BFA  --accent-dim #6D28D9  --danger #EF4444
```

Правила: радиус 10px, сетка 4px, фиолетовый — только для активных состояний, кнопок действия,
прогресс-баров и фокуса. Анимации 120–180 мс ease-out, только `opacity` и `transform`;
при `prefers-reduced-motion` отключаются.

---

## Статус реализации

- [x] **Этап 1** — скелет проекта, дизайн-система, оболочка интерфейса на фикстурах.
- [x] **Этап 2** — ядро загрузки (manifest, библиотеки, нативы, ассеты, SHA1, параллель,
      отмена и докачка) и запуск ванильной версии.
- [x] **Этап 3** — аккаунты Microsoft (device code → Xbox Live → XSTS → Minecraft), keyring.
- [x] **Этап 4** — модлоадеры: Fabric, Quilt, NeoForge, Forge.
- [x] **Этап 5** — браузер модов: Modrinth и CurseForge через общий трейт `ModProvider`.
- [x] **Этап 6** — импорт/экспорт сборок: `.mrpack`, CurseForge, MultiMC/PrismLauncher.

Внутри окна приложения интерфейс работает с настоящим бэкендом. Фикстуры из `src/mocks`
остаются только для `npm run dev` в обычном браузере, где IPC недоступен; переключение —
в [`src/api/shared.ts`](src/api/shared.ts).


Java подбирается строго по мажорной версии из профиля (8 для ≤1.16, 17 для 1.17–1.20.4,
21 для 1.20.5+): установленная Java 17 не считается заменой восьмёрке. Недостающая скачивается
с Adoptium, и только если её там нет для этой платформы, берётся ближайшая более новая.

---

## Ограничения и правила

- В репозитории нет ассетов Mojang и ключей API — всё скачивается на машине пользователя.
- Ключ CurseForge либо вшивается при сборке из `FIRLAUNCHER_CURSEFORGE_KEY` (и тогда не
  меняется в настройках), либо вводится пользователем и хранится только в `settings.json`.
  Без ключа источник скрыт в интерфейсе.
- User-Agent содержит контакт (поле «Контакт для User-Agent» в настройках), как того требуют
  условия использования Modrinth и CurseForge; rate limit соблюдается.
- Minecraft — товарный знак Mojang AB. Проект не связан с Mojang и Microsoft.

## Лицензия

MIT.
