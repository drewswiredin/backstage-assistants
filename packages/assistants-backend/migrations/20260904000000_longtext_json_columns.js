/**
 * The JSON payload columns — `messages.content_json` (one assistant-ui
 * `UIMessage`, which carries every tool result of the turn) and
 * `assistants.definition_json` (a full assistant definition) — must hold far
 * more than MySQL's 64 KB `TEXT`. On MySQL they are `LONGTEXT`; Postgres and
 * SQLite `TEXT` is unbounded already, so this is a no-op there.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!isMysql(knex)) return;
  await knex.schema.alterTable('messages', table => {
    table.text('content_json', 'longtext').notNullable().alter();
  });
  await knex.schema.alterTable('assistants', table => {
    table.text('definition_json', 'longtext').notNullable().alter();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  if (!isMysql(knex)) return;
  await knex.schema.alterTable('messages', table => {
    table.text('content_json').notNullable().alter();
  });
  await knex.schema.alterTable('assistants', table => {
    table.text('definition_json').notNullable().alter();
  });
};

/** @param {import('knex').Knex} knex */
function isMysql(knex) {
  const client = knex.client.config.client;
  return client === 'mysql' || client === 'mysql2';
}
