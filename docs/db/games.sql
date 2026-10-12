-- Game registry and game currencies on Percona Server for MySQL 8.4.
-- A game is published once; after that its entry never changes. The rate of
-- its currency is fixed forever: the trigger below rejects any UPDATE of a
-- published game, and DELETE as well.

CREATE TABLE games (
  id               VARCHAR(64)  NOT NULL PRIMARY KEY,
  -- JSON array of universes (character ids) or the string "all"
  universes        JSON         NOT NULL,
  currency_code    VARCHAR(16)  NULL,
  -- `rate_abie` ABIE buy `rate_units` of the game currency; whole numbers only
  rate_abie        INT UNSIGNED NULL,
  rate_units       INT UNSIGNED NULL,
  -- 'match': back to ABIE after a match, minus 10% of profit; 'none': stays in the game
  settle           ENUM('match', 'none') NULL,
  published_at     BIGINT       NOT NULL,
  CONSTRAINT games_rate_whole CHECK (
    (currency_code IS NULL AND rate_abie IS NULL AND rate_units IS NULL AND settle IS NULL)
    OR (currency_code IS NOT NULL AND rate_abie >= 1 AND rate_units >= 1 AND settle IS NOT NULL)
  )
) ENGINE = InnoDB;

DELIMITER //
CREATE TRIGGER games_never_update BEFORE UPDATE ON games
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A published game never changes (its currency rate is fixed forever)';
END//
CREATE TRIGGER games_never_delete BEFORE DELETE ON games
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A published game is never removed';
END//
DELIMITER ;

-- Game currency balances: append-only history per player and game, like the ABIE wallet.
CREATE TABLE game_currency_ops (
  id             VARCHAR(128) NOT NULL PRIMARY KEY,   -- unique operation id; a repeat is ignored
  account_id     VARCHAR(64)  NOT NULL,
  game_id        VARCHAR(64)  NOT NULL,
  kind           ENUM('buy', 'stake', 'settle', 'convert') NOT NULL,
  amount         BIGINT       NOT NULL,
  balance_after  BIGINT       NOT NULL,
  ref            VARCHAR(128) NULL,
  ts             BIGINT       NOT NULL,
  KEY account_game (account_id, game_id, ts),
  CONSTRAINT game_currency_not_negative CHECK (balance_after >= 0),
  CONSTRAINT game_currency_game FOREIGN KEY (game_id) REFERENCES games (id)
) ENGINE = InnoDB;

INSERT INTO games (id, universes, currency_code, rate_abie, rate_units, settle, published_at)
VALUES ('duel', JSON_QUOTE('all'), 'DUSD', 1, 100, 'match', 1791763200000);
