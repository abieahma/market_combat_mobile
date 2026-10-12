# Market Combat API

Договор между приложением и сервером. Сейчас его выполняет заглушка внутри приложения (`src/mock-server`). Потом его же выполнит сервер на Go по адресу `https://api.ahilespelid.ru`. Типы описаны в `src/api/contract.ts`, этот файл — их человеческая версия.

## Общие правила

- Формат — JSON по HTTPS. Авторизация: заголовок `Authorization: Bearer <token>`.
- Суммы указываются в целых ABIE, время — в миллисекундах Unix.
- Ошибка возвращается так: `{ "error": { "code": "...", "message": "..." } }`.

| Код ошибки | HTTP | Когда |
|---|---|---|
| `unauthorized` | 401 | нет сессии или она истекла |
| `invalid_input` | 400 | неверные данные в запросе |
| `invalid_code` | 400 | неверный код из письма |
| `challenge_expired` | 410 | попытка входа истекла или уже использована |
| `insufficient_funds` | 409 | не хватает ABIE |
| `rate_limited` | 429 | слишком часто |
| `not_found` | 404 | нет такого объекта |
| `network` | — | только в приложении: запрос не дошёл до сервера |

## Вход

| Запрос | Тело | Ответ |
|---|---|---|
| `POST /v1/auth/email/start` | `{ email }` | `{ challengeId, expiresAt }`. На почту уходит код из 6 цифр, он действует 10 минут. Повторная отправка возможна не раньше чем через 30 с. |
| `POST /v1/auth/email/verify` | `{ challengeId, code }` | `AuthResult`. После 5 неверных кодов попытка сгорает. |
| `POST /v1/auth/telegram/start` | `{}` | `{ challengeId, expiresAt, botUrl }`. Ссылка открывает бота с одноразовым параметром `start=login_…`. |
| `POST /v1/auth/phone/start` | `{}` | То же, но `start=phone_…`: бот просит поделиться номером телефона (бесплатно, без SMS). |
| `GET /v1/auth/challenges/{id}` | — | `{ status: "pending" }`, `{ status: "expired" }` или `{ status: "confirmed", ...AuthResult }`. Подтверждённый вход отдаётся один раз. |
| `POST /v1/auth/google` | `{ idToken }` | `AuthResult`. Сервер проверяет Google ID token. |
| `POST /v1/auth/logout` | `{}` | `{ ok: true }` |

`AuthResult = { session: { token, expiresAt }, account, profile, isNew }`. Сессия действует 30 дней. Первый вход с новым способом создаёт аккаунт, профиль и кошелёк, на который зачисляется 100 ABIE.

Как бот подтверждает вход на настоящем сервере: Telegram присылает на webhook сервера сообщение `/start login_<nonce>` или контакт игрока. Сервер находит попытку по `nonce` и привязывает Telegram id или номер телефона. В заглушке это делает `server.dev.telegramConfirm`.

## Профиль

| Запрос | Тело | Ответ |
|---|---|---|
| `GET /v1/me` | — | `{ account, profile }` |
| `PATCH /v1/me/profile` | `{ nickname? }` | `Profile`. Ник — от 2 до 16 символов. |

`Profile = { accountId, nickname, character, gender, genderChangedAt, skins, stats, respect }`. Пока персонаж не выбран, `character` и `gender` равны `null`.

## Персонаж и внешность

Персонажи: `valdberik`, `ozonik`, `avitos`, `yandos`. Пол: `m`, `f`. В `skins` лежит коллекция скинов игрока: 4 бесплатных персонажа есть у всех с самого начала, новые скины будут добавляться туда же.

| Запрос | Тело | Ответ |
|---|---|---|
| `POST /v1/me/character` | `{ character, gender }` | `Profile`. Первый выбор, бесплатно. 409 `conflict`, если персонаж уже выбран. 403, если скина нет в коллекции. |
| `POST /v1/me/character/change` | `{ character, requestId }` | `{ profile, tx }`. Списывает 5 000 ABIE (операция `character_change`), статистика, рейтинги, история и ABIE сохраняются. 409 `insufficient_funds`, если не хватает. Повтор с тем же `requestId` возвращает тот же результат и не списывает второй раз. |
| `POST /v1/me/gender` | `{ gender }` | `Profile`. Бесплатно, не чаще раза в неделю (`genderChangedAt` — время последней смены). Раньше срока — 429 `rate_limited`. Первый выбор пола вместе с персонажем в лимит не входит. |

## Кошелёк ABIE

Отдельный сервис со своей базой (`abie_wallet`). Каждая операция имеет уникальный `id`: повтор с тем же `id` ничего не меняет, уйти в минус нельзя, история только дописывается.

| Запрос | Ответ |
|---|---|
| `GET /v1/wallet` | `{ currency: "ABIE", balance }` |
| `GET /v1/wallet/transactions?limit=20&cursor=` | `{ items: WalletTx[], nextCursor }`, новые сверху |

`WalletTx = { id, ts, kind, amount, balanceAfter, ref? }`. Виды операций `kind`: `welcome`, `match_reward`, `character_change`.

## Матчи

| Запрос | Тело | Ответ |
|---|---|---|
| `POST /v1/matches` | `{ game: "duel" }` | `{ matchId, game, seed, startedAt }`. Seed выбирает сервер. |
| `POST /v1/matches/{id}/finish` | `{ place, actions }` | `{ matchId, place, reward, tx, profile }`. Повторный запрос возвращает тот же ответ, награда не начисляется второй раз. |

Награда за места 1–4: 50 / 25 / 10 / 5 ABIE. Сейчас сервер доверяет `place`. На следующем шаге он сам проиграет матч по `seed` и `actions` (действия игрока по тикам) и вычислит место.

## Следующие шаги (договор есть, реализации пока нет)

- `POST /v1/help/requests { kind }`, `GET /v1/help/requests?box=incoming|mine`, `POST /v1/help/requests/{id}/answer`, `GET /v1/respect` — помощь и респект.
