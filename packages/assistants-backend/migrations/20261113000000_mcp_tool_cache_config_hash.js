/**
 * Each cached listing records which server config produced it, so a server
 * whose `url`, `command`, or `args` changed doesn't show the old server's
 * tools. Existing rows have none and are ignored until the next listing.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('mcp_tool_cache', table => {
    table.string('config_hash', 64).nullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('mcp_tool_cache', table => {
    table.dropColumn('config_hash');
  });
};
