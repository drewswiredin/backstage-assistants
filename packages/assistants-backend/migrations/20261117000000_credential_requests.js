/**
 * Requests for a new token for a per-user MCP server whose token the provider
 * refused mid-turn, so the browser's answer can reach the replica running
 * the turn. The token is stored encrypted to a key only that replica holds.
 * Once settled the row keeps only that it was answered until it expires, so
 * a late answer gets 410; expired rows are swept.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('credential_requests', table => {
    table.string('id', 128).primary();
    table.string('user_ref', 255).notNullable();
    table.string('server_id', 255).notNullable();
    table.text('public_key').notNullable();
    table.boolean('claimed').notNullable().defaultTo(false);
    table.text('response').nullable();
    table.timestamp('expires_at').notNullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('credential_requests');
};
