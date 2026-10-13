# market_combat_mobile

Expo (SDK 57, TypeScript). Разработка ведётся из чата, результат виден в двух местах:

- **На телефоне в Expo Go** — живьём, с Fast Refresh. Expo dev server работает в UserLAnd на этом же телефоне и сам подтягивает новые коммиты из GitHub.
- **В чате** — веб-версия, которую GitHub Actions собирает после каждого пуша в `master` и кладёт в ветку `preview`.

## Телефон (UserLAnd, Ubuntu/Debian)

Один раз (в чистом Debian из UserLAnd нет сертификатов, поэтому сначала ставим их):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl && curl -fsSL https://raw.githubusercontent.com/abieahma/market_combat_mobile/master/phone/setup.sh | bash
```

Каждый раз, когда садимся работать:

```bash
~/market_combat_mobile/phone/dev.sh
```

Если проект ставился раньше, он лежит в `~/mcombat`: тогда `~/mcombat/phone/dev.sh`. Старый адрес репозитория GitHub переадресует сам.

Потом в Expo Go: **Enter URL manually** → `exp://127.0.0.1:8081`.

Править файлы на телефоне не нужно: локальные правки мешают автоподтягиванию.

## Как это устроено

| Файл | Зачем |
|---|---|
| `App.tsx` | Навигация между экранами |
| `src/screens/` | Хаб игр, настройки, дуэль, итоги матча |
| `src/game/duel.ts` | Правила «Дуэли на графике»: цена, новости, сделки, боты. Чистый TS, пойдёт на сервер |
| `src/i18n/strings.ts` | Тексты: английский по умолчанию + языки СНГ |
| `src/state/store.tsx` | Настройки, профиль и кошелёк ABIE (журнал начислений) |
| `src/games.ts` | Список игр в хабе |
| `phone/setup.sh` | Установка Node.js 22, клонирование, `npm install` |
| `phone/dev.sh` | `expo start --localhost` + `git pull` каждые 5 с |
| `phone/fix-network.cjs` | Обход ошибки `uv_interface_addresses` у Node под proot |
| `.github/workflows/web-preview.yml` | Веб-сборка → ветка `preview` |
| `scripts/make-preview.mjs` | Склейка веб-сборки в одну страницу для чата |

## Если что-то не так

- **Expo Go пишет про несовместимую версию SDK** — обнови Expo Go в Play Маркете; проект на SDK 57.
- **Изменения не доезжают** — смотри строки `[sync]` в терминале UserLAnd; `git status` покажет локальные правки.
- **Красный экран после смены зависимостей** — перезапусти `dev.sh` (Ctrl+C и снова).
