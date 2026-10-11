// Tiny persistent database for the server stub. Each table is kept in memory
// and saved as one JSON value in key-value storage (AsyncStorage on the
// phone, localStorage in the browser, a Map in tests).

export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryKV implements KeyValue {
  private readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

export class Table<T> {
  rows: Record<string, T> = {};
  dirty = false;

  constructor(readonly name: string) {}

  get(id: string): T | undefined {
    return this.rows[id];
  }
  put(id: string, row: T): T {
    this.rows[id] = row;
    this.dirty = true;
    return row;
  }
  delete(id: string): void {
    if (id in this.rows) {
      delete this.rows[id];
      this.dirty = true;
    }
  }
  values(): T[] {
    return Object.values(this.rows);
  }
}

export class Database {
  private readonly tables = new Map<string, Table<unknown>>();
  private opened: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly kv: KeyValue,
    readonly name: string,
    tableNames: string[],
  ) {
    for (const t of tableNames) this.tables.set(t, new Table(t));
  }

  private key(table: string) {
    return `mcserver/${this.name}/${table}`;
  }

  table<T>(name: string): Table<T> {
    const t = this.tables.get(name);
    if (!t) throw new Error(`no table ${this.name}.${name}`);
    return t as Table<T>;
  }

  open(): Promise<void> {
    if (!this.opened) {
      this.opened = (async () => {
        for (const [name, table] of this.tables) {
          try {
            const raw = await this.kv.get(this.key(name));
            table.rows = raw ? JSON.parse(raw) : {};
          } catch {
            table.rows = {};
          }
        }
      })();
    }
    return this.opened;
  }

  /** Saves changed tables. Calls are queued so writes never interleave. */
  flush(): Promise<void> {
    this.saving = this.saving.then(async () => {
      for (const [name, table] of this.tables) {
        if (!table.dirty) continue;
        table.dirty = false;
        try {
          await this.kv.set(this.key(name), JSON.stringify(table.rows));
        } catch {
          // Storage unavailable (private browser window): keep working in memory.
        }
      }
    });
    return this.saving;
  }

  async wipe(): Promise<void> {
    for (const [name, table] of this.tables) {
      table.rows = {};
      table.dirty = false;
      try {
        await this.kv.remove(this.key(name));
      } catch {
        // ignore
      }
    }
  }
}
