/**
 * Assistant definitions live in the plugin database (not app-config) and are
 * managed at runtime through the admin `/manage/assistants` API. Each row holds
 * the canonical {@link AssistantDefinition} as `definition_json` TEXT
 * (`JSON.stringify` — portable across SQLite/Postgres, NOT pg `jsonb`); `id` and
 * `title` are mirrored to columns for the primary-key lookup and admin-list
 * sorting. Audit columns (`created_by`/`created_at`/`updated_by`/`updated_at`)
 * record provenance.
 *
 * `assistants_meta` is a tiny key/value table backing the seed-once guard: the
 * store inserts ONE default assistant on first init, marks it here, and never
 * resurrects it once an operator deletes or edits it.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('assistants', table => {
    table.string('id', 255).primary();
    table.string('title', 512).notNullable();
    table.text('definition_json').notNullable();
    table.string('created_by', 255).nullable();
    table.timestamp('created_at').notNullable();
    table.string('updated_by', 255).nullable();
    table.timestamp('updated_at').notNullable();
  });

  await knex.schema.createTable('assistants_meta', table => {
    table.string('key', 255).primary();
    table.string('value', 512).nullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('assistants_meta');
  await knex.schema.dropTableIfExists('assistants');
};
