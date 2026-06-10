import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { resolvePackagePath } from '@backstage/backend-plugin-api';
import type {
  AssistantAccess,
  AssistantDefinition,
  AssistantSummary,
  ModelId,
  ModelOption,
} from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * Server-side persistence for assistant DEFINITIONS.
 *
 * Assistant definitions moved out of app-config into the plugin's own database
 * (Backstage `DatabaseService`) and are managed at runtime through the admin
 * `/manage/assistants` API. This store mirrors {@link ThreadService}: Knex over
 * `coreServices.database`, idempotent migrations run at init.
 *
 * The hot path — the router resolving an assistant per request — must be
 * synchronous (it sits exactly where the old config Map did). So the store keeps
 * an in-memory snapshot of the RAW definitions, rebuilt write-through on every
 * mutation and lazily refreshed (~60s) as a single-replica safety net. Reads are
 * tolerant: a row that fails to parse is skipped, never throwing on the hot path.
 *
 * Derived-at-read values (effective models / default model, `hasModelAllowlist`)
 * are NOT stored. They depend on the platform model pool + default, which are
 * supplied via {@link AssistantStore.setPlatformDefaults} (or the constructor)
 * and applied by {@link AssistantStore.summaryFor}.
 */

/** Snapshot refresh interval — the single-replica safety net. */
const SNAPSHOT_TTL_MS = 60_000;

/** The seed-once marker key in `assistants_meta`. */
const SEED_MARKER_KEY = 'seeded';

/**
 * The default assistant inserted by the seed-once on first init. Neutral title,
 * a short helpful prompt, no color; `allowAuthenticated` true with no
 * users/groups; `defaultModel` null (→ platform default); `models` empty (full
 * pool); `allowedTools` the three built-in read-only action ids (tolerated and
 * skipped at `/chat` if `builtinActions` is off); no MCP.
 */
const DEFAULT_ALLOWED_TOOLS = [
  'search-catalog',
  'search-techdocs',
  'read-techdocs',
];

/**
 * The audit-bearing identity recorded on a write — the acting admin's entity
 * ref (e.g. `"user:default/jane"`).
 */
export type AuditRef = string;

export class AssistantStore {
  /** RAW definitions by id — the synchronously-read snapshot. */
  private snapshot = new Map<string, AssistantDefinition>();
  /** Epoch ms of the last snapshot rebuild; drives the lazy TTL refresh. */
  private lastRefresh = 0;
  /** In-flight refresh, so concurrent reads share one DB round-trip. */
  private refreshing: Promise<void> | null = null;

  /** The platform model pool (the global `provider:model` options). */
  private pool: ModelOption[];
  /** The platform default `provider:model`, used when a row's is null. */
  private platformDefault: ModelId;

  constructor(
    private readonly db: Knex,
    platformDefaults?: { pool: ModelOption[]; defaultModel: ModelId },
  ) {
    this.pool = platformDefaults?.pool ?? [];
    this.platformDefault = platformDefaults?.defaultModel ?? '';
  }

  /**
   * Provide (or update) the platform model pool + default used to derive
   * effective models / default model in {@link summaryFor}. Call after config is
   * read if not supplied to the constructor.
   */
  setPlatformDefaults(pool: ModelOption[], defaultModel: ModelId): void {
    this.pool = pool;
    this.platformDefault = defaultModel;
  }

  /** Run the plugin's migrations (idempotent). Called once at plugin init. */
  async runMigrations(): Promise<void> {
    await this.db.migrate.latest({
      directory: resolvePackagePath(
        '@drewswiredin/backstage-plugin-assistants-backend',
        'migrations',
      ),
    });
  }

  // ---- Synchronous snapshot reads (the hot path) ---------------------------

  /**
   * The raw definition for an assistant, or undefined. SYNCHRONOUS — reads the
   * in-memory snapshot exactly where the router used the old config Map. Kicks
   * off a lazy background refresh when the snapshot is stale; never blocks.
   */
  get(id: string): AssistantDefinition | undefined {
    this.maybeRefresh();
    return this.snapshot.get(id);
  }

  /**
   * All raw definitions. SYNCHRONOUS (snapshot read) + lazy stale refresh, like
   * {@link get}.
   */
  list(): AssistantDefinition[] {
    this.maybeRefresh();
    return [...this.snapshot.values()];
  }

  /**
   * Whether `caller` may access `assistant` under its access policy.
   * Default-deny: `allowAuthenticated || users.includes(userRef) ||
   * groups.some(g ∈ ownershipRefs)`. Pure; no I/O.
   */
  canAccess(
    assistant: AssistantDefinition,
    caller: { userEntityRef: string; ownershipEntityRefs: string[] },
  ): boolean {
    const { access } = assistant;
    if (access.allowAuthenticated) {
      return true;
    }
    if (access.users.includes(caller.userEntityRef)) {
      return true;
    }
    return access.groups.some(g =>
      caller.ownershipEntityRefs.includes(g),
    );
  }

  // ---- Derived-at-read -----------------------------------------------------

  /**
   * Whether the assistant restricts the model pool (a non-empty allowlist).
   * Derived, never stored.
   */
  hasModelAllowlist(assistant: AssistantDefinition): boolean {
    return assistant.models.length > 0;
  }

  /**
   * The effective model allowlist for an assistant: its own allowlist when set,
   * otherwise the full platform pool ids. Derived, never stored.
   */
  effectiveModels(assistant: AssistantDefinition): ModelId[] {
    return assistant.models.length > 0
      ? assistant.models
      : this.pool.map(m => m.id);
  }

  /**
   * The effective default model. With no allowlist: the stored default, else the
   * platform default. With a restricted allowlist: the stored default when it is
   * in the list, otherwise the first allowlisted model — never a platform default
   * the assistant is not allowed to use. Derived, never stored.
   */
  effectiveDefaultModel(assistant: AssistantDefinition): ModelId {
    const { defaultModel, models } = assistant;
    if (models.length === 0) {
      return defaultModel ?? this.platformDefault;
    }
    if (defaultModel && models.includes(defaultModel)) {
      return defaultModel;
    }
    return models[0];
  }

  /**
   * Browser-safe projection of a definition (no prompt, no access). Applies the
   * derived model allowlist + default; `models` is omitted when the assistant
   * allows the full pool (`hasModelAllowlist` false). `tools` is left to the
   * router to fill (it intersects with the caller's visible actions).
   */
  summaryFor(assistant: AssistantDefinition): AssistantSummary {
    const summary: AssistantSummary = {
      id: assistant.id,
      title: assistant.title,
      defaultModel: this.effectiveDefaultModel(assistant),
    };
    if (assistant.description !== undefined) {
      summary.description = assistant.description;
    }
    if (assistant.color !== undefined) {
      summary.color = assistant.color;
    }
    if (this.hasModelAllowlist(assistant)) {
      summary.models = assistant.models;
    }
    if (assistant.ui !== undefined) {
      summary.ui = assistant.ui;
    }
    return summary;
  }

  // ---- Async CRUD (admin /manage) ------------------------------------------

  /**
   * All full definitions (with audit columns), title-sorted — for the admin
   * editor. Reads the DB directly (authoritative), not the snapshot.
   */
  async listAll(): Promise<AssistantDefinition[]> {
    const rows = await this.db('assistants').orderBy('title', 'asc');
    return rows
      .map(toDefinition)
      .filter((d): d is AssistantDefinition => d !== null);
  }

  /** A single full definition by id (authoritative DB read), or null. */
  async getById(id: string): Promise<AssistantDefinition | null> {
    const row = await this.db('assistants').where({ id }).first();
    return row ? toDefinition(row) : null;
  }

  /**
   * Create a definition. The server assigns the uuid (any incoming `id` is
   * ignored) and stamps audit columns. Returns the persisted definition. The
   * snapshot is rebuilt write-through.
   */
  async create(
    def: Omit<AssistantDefinition, 'id'> & { id?: string },
    by: AuditRef,
  ): Promise<AssistantDefinition> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const full: AssistantDefinition = {
      ...def,
      id,
      created_by: by,
      created_at: now,
      updated_by: by,
      updated_at: now,
    };
    await this.db('assistants').insert(toRow(full));
    await this.refresh();
    return full;
  }

  /**
   * Update a definition by id. Preserves the original `id` + creation audit;
   * stamps `updated_by`/`updated_at`. Returns the persisted definition, or null
   * when no row matches. The snapshot is rebuilt write-through.
   */
  async update(
    id: string,
    def: AssistantDefinition,
    by: AuditRef,
  ): Promise<AssistantDefinition | null> {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const full: AssistantDefinition = {
      ...def,
      id,
      created_by: existing.created_by,
      created_at: existing.created_at,
      updated_by: by,
      updated_at: now,
    };
    await this.db('assistants').where({ id }).update(toRow(full));
    await this.refresh();
    return full;
  }

  /**
   * Hard-delete a definition by id. Returns false when no row matched. The
   * snapshot is rebuilt write-through. The seed marker is intentionally NOT
   * cleared, so the default is never resurrected.
   */
  async delete(id: string): Promise<boolean> {
    const count = await this.db('assistants').where({ id }).delete();
    await this.refresh();
    return count > 0;
  }

  // ---- Seed-once -----------------------------------------------------------

  /**
   * Insert ONE default assistant on first init, guarded by the
   * `assistants_meta` marker so it is never resurrected after an operator
   * deletes or edits it. Idempotent. Rebuilds the snapshot afterwards.
   */
  async seedOnce(): Promise<void> {
    const marker = await this.db('assistants_meta')
      .where({ key: SEED_MARKER_KEY })
      .first();
    if (marker) {
      await this.refresh();
      return;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const def: AssistantDefinition = {
      id,
      title: 'Assistant',
      prompt:
        'You are a helpful assistant for this Backstage instance. ' +
        'Answer questions clearly and concisely, and use the available tools ' +
        'to look things up in the software catalog and documentation when relevant.',
      access: { allowAuthenticated: true, users: [], groups: [] },
      allowedTools: [...DEFAULT_ALLOWED_TOOLS],
      models: [],
      defaultModel: null,
      created_by: 'system:seed',
      created_at: now,
      updated_by: 'system:seed',
      updated_at: now,
    };

    // Mark first (insert-or-ignore semantics via existence check above) so a
    // race or partial failure never double-seeds. Both writes share a txn.
    await this.db.transaction(async trx => {
      await trx('assistants').insert(toRow(def));
      await trx('assistants_meta').insert({
        key: SEED_MARKER_KEY,
        value: now,
      });
    });
    await this.refresh();
  }

  // ---- Snapshot maintenance ------------------------------------------------

  /**
   * Rebuild the in-memory snapshot from the DB now. Called write-through after
   * every mutation and once at init (via {@link seedOnce}). Tolerant: rows that
   * fail to parse are skipped, never throwing.
   */
  async refresh(): Promise<void> {
    const rows = await this.db('assistants').select(
      'id',
      'definition_json',
      'created_by',
      'created_at',
      'updated_by',
      'updated_at',
    );
    const next = new Map<string, AssistantDefinition>();
    for (const row of rows) {
      const def = toDefinition(row);
      if (def) {
        next.set(def.id, def);
      }
    }
    this.snapshot = next;
    this.lastRefresh = Date.now();
  }

  /**
   * Lazy ~60s refresh: when the snapshot is stale, kick off a single background
   * rebuild (shared across concurrent callers) and return immediately. Errors
   * are swallowed — the stale snapshot keeps serving. Never blocks a sync read.
   */
  private maybeRefresh(): void {
    if (this.refreshing) {
      return;
    }
    if (Date.now() - this.lastRefresh < SNAPSHOT_TTL_MS) {
      return;
    }
    this.refreshing = this.refresh()
      .catch(() => {
        // Swallow: the existing snapshot keeps serving until the next attempt.
      })
      .finally(() => {
        this.refreshing = null;
      });
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

/**
 * Build the DB row from a full definition: `definition_json` is the canonical
 * content (`JSON.stringify`, audit fields stripped — those live in columns);
 * `id`/`title` mirror to columns; audit columns are written separately.
 */
function toRow(def: AssistantDefinition): Record<string, unknown> {
  const {
    created_by,
    created_at,
    updated_by,
    updated_at,
    ...content
  } = def;
  return {
    id: def.id,
    title: def.title,
    definition_json: JSON.stringify(content),
    created_by: created_by ?? null,
    created_at: created_at ?? new Date().toISOString(),
    updated_by: updated_by ?? null,
    updated_at: updated_at ?? new Date().toISOString(),
  };
}

/** Normalize a possibly-malformed stored access blob to a SAFE (deny) default. */
function normalizeAccess(raw: unknown): AssistantAccess {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    AssistantAccess
  >;
  return {
    // Default to DENY when missing/malformed — a corrupt row is closed, not open.
    allowAuthenticated:
      typeof a.allowAuthenticated === 'boolean' ? a.allowAuthenticated : false,
    users: Array.isArray(a.users)
      ? a.users.filter((u): u is string => typeof u === 'string')
      : [],
    groups: Array.isArray(a.groups)
      ? a.groups.filter((g): g is string => typeof g === 'string')
      : [],
  };
}

/** An array of strings, or `[]` for anything malformed. */
function stringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === 'string')
    : [];
}

/**
 * Parse a DB row into a full definition, merging the audit columns over the
 * stored content. NORMALIZES the critical fields (access → deny default,
 * allowedTools/models → string[], defaultModel → string|null) so a
 * malformed-but-parseable row can never throw on the synchronous `/chat` hot
 * path. Returns null when the row is fundamentally unusable (unparseable JSON,
 * non-object content, or no id/title) so the snapshot rebuild skips it.
 */
function toDefinition(
  row: Record<string, unknown>,
): AssistantDefinition | null {
  let content: Partial<AssistantDefinition>;
  try {
    content = JSON.parse(String(row.definition_json));
  } catch {
    return null;
  }
  if (!content || typeof content !== 'object') {
    return null;
  }
  const id = row.id as string;
  const title = ((row.title as string) ?? content.title) as string;
  if (!id || typeof title !== 'string' || title.length === 0) {
    return null;
  }
  return {
    id,
    title,
    description:
      typeof content.description === 'string' ? content.description : undefined,
    color: typeof content.color === 'string' ? content.color : undefined,
    prompt: typeof content.prompt === 'string' ? content.prompt : '',
    access: normalizeAccess(content.access),
    allowedTools: stringArray(content.allowedTools),
    models: stringArray(content.models),
    defaultModel:
      typeof content.defaultModel === 'string' ? content.defaultModel : null,
    ui:
      content.ui && typeof content.ui === 'object' ? content.ui : undefined,
    created_by: (row.created_by as string) ?? content.created_by,
    created_at:
      (row.created_at ? String(row.created_at) : undefined) ??
      content.created_at,
    updated_by: (row.updated_by as string) ?? content.updated_by,
    updated_at:
      (row.updated_at ? String(row.updated_at) : undefined) ??
      content.updated_at,
  };
}
