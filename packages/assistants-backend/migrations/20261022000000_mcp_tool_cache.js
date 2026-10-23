/**
 * The shared tool inventory of per-user MCP servers. Such a server has no
 * shared connection, so its tools are learned from the first user who
 * connects; this keeps that listing across restarts for `/status` and the
 * editor. A rebuildable cache: each new listing replaces its row.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_tool_cache', table => {
    table.string('server_id', 255).primary();
    table.text('tools_json', 'longtext').notNullable();
    table.timestamp('updated_at').notNullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mcp_tool_cache');
};
