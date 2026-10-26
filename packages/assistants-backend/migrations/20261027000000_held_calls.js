/**
 * Tool calls held open for the user inside a provider's own tool loop (an
 * approval, or a client tool the browser runs), so the browser's answer can
 * reach the replica holding the call. Once settled the row keeps only that
 * it was answered until it expires, so a late answer gets 410; expired rows
 * are swept.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('held_calls', table => {
    table.string('id', 128).primary();
    table.string('user_ref', 255).notNullable();
    table.string('thread_id', 255).nullable();
    table.string('kind', 32).notNullable();
    table.string('tool', 255).notNullable();
    table.text('response_json').nullable();
    table.timestamp('expires_at').notNullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('held_calls');
};
