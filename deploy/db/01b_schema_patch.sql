-- Columns this fork's PHP code expects that the shipped MySQL_AST_CREATE_tables.sql
-- does not define. Types follow upstream ViciDial 2.4.
ALTER TABLE vicidial_campaigns ADD end_call_action VARCHAR(50) default 'NONE';
ALTER TABLE vicidial_inbound_groups ADD max_calls_in_queue SMALLINT(5) UNSIGNED default '0';
ALTER TABLE vicidial_inbound_groups ADD max_calls_in_queue_filename VARCHAR(100) default '';
