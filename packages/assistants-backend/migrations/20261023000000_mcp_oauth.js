/**
 * Server-held sign-ins for MCP servers that run their own OAuth.
 *
 * - `mcp_oauth_tokens`: each user's tokens per server, sealed with the
 *   configured encryption key. Deleted on disconnect.
 * - `mcp_oauth_clients`: the client the backend registered with a server's
 *   authorization server (dynamic client registration), once per server.
 * - `mcp_oauth_state`: a sign-in in progress, bound to the user who started
 *   it; consumed by the callback, and swept after ten minutes.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_oauth_tokens', table => {
    table.string('user_ref', 255).notNullable();
    table.string('server_id', 255).notNullable();
    table.text('tokens_enc').notNullable();
    table.timestamp('expires_at').nullable();
    table.timestamp('updated_at').notNullable();
    table.primary(['user_ref', 'server_id']);
  });
  await knex.schema.createTable('mcp_oauth_clients', table => {
    table.string('server_id', 255).primary();
    table.text('client_enc').notNullable();
    table.timestamp('registered_at').notNullable();
  });
  await knex.schema.createTable('mcp_oauth_state', table => {
    table.string('state', 255).primary();
    table.string('user_ref', 255).notNullable();
    table.string('server_id', 255).notNullable();
    table.text('flow_enc').notNullable();
    table.timestamp('expires_at').notNullable().index();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mcp_oauth_state');
  await knex.schema.dropTableIfExists('mcp_oauth_clients');
  await knex.schema.dropTableIfExists('mcp_oauth_tokens');
};
