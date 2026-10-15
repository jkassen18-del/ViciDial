-- Demo data so the UI can be explored right away.
-- Login: admin 6666 / 1234 (from 02_seed.sql). Agent: 1001 / 1234 on extension 1001 (this fork uses the extension as the phone password).
INSERT INTO vicidial_users (user,pass,full_name,user_level,user_group,active,hotkeys_active,agent_choose_ingroups)
  VALUES ('1001','1234','Alexandra Mercer','1','ADMIN','Y','1','1');
INSERT INTO phones (extension, dialplan_number, voicemail_id, phone_ip, computer_ip, server_ip, login, pass, status, active, phone_type, fullname, company, protocol, is_webphone)
  VALUES ('1001','1001','1001','','','10.10.10.15','1001','1001','ACTIVE','Y','X-Lite','Agent Softphone','XF','SIP','N');
INSERT INTO vicidial_campaigns (campaign_id,campaign_name,active,dial_status_a,lead_order,park_ext,park_file_name,web_form_address,allow_closers,hopper_level,auto_dial_level,next_agent_call,local_call_time,voicemail_ext,dial_timeout,dial_prefix,campaign_cid,campaign_vdad_exten,campaign_rec_exten,campaign_recording,campaign_rec_filename,campaign_script,get_call_launch,am_message_exten,amd_send_to_vmx,alt_number_dialing,scheduled_callbacks,lead_filter_id,drop_call_seconds,drop_action,safe_harbor_exten,display_dialable_count,wrapup_seconds,wrapup_message,closer_campaigns,ivr_park_call,manual_dial_filter,dial_method,available_only_ratio_tally,adaptive_dropped_percentage,adaptive_maximum_level,adaptive_latest_server_time,adaptive_intensity,adaptive_dl_diff_target,concurrent_transfers,auto_alt_dial,agent_pause_codes_active,campaign_allow_inbound,manual_dial_list_id,default_xfer_group,queue_priority,no_hopper_leads_logins,manual_dial_prefix,manual_preview_dial)
  VALUES ('PREM01','Premier Outbound','Y','NEW','DOWN','8301','park','','Y','50','0','oldest_call_finish','24hours','8500','60','9','0000000000','8368','8309','N','FULLDATE','','N','8320','N','NONE','Y','NONE','5','HANGUP','8307','Y','0','Thank you','-','DISABLED','NONE','MANUAL','N','3','3','2100','0','0','AUTO','NONE','N','N','999','','50','Y','','PREVIEW_AND_SKIP');
INSERT INTO vicidial_campaign_statuses (status,status_name,selectable,campaign_id,human_answered,category,sale,dnc) VALUES
  ('SALE','Sale Made','Y','PREM01','Y','UNDEFINED','Y','N'),
  ('NI','Not Interested','Y','PREM01','Y','UNDEFINED','N','N'),
  ('CALLBK','Call Back','Y','PREM01','Y','UNDEFINED','N','N');
INSERT INTO vicidial_lists (list_id,list_name,campaign_id,active,list_description) VALUES ('1001','Premier prospects','PREM01','Y','Demo list');
INSERT INTO vicidial_list (entry_date,status,list_id,phone_code,phone_number,title,first_name,last_name,address1,city,state,postal_code,email,called_count)
  VALUES (NOW(),'NEW','1001','1','2125550147','Mr','Jordan','Whitfield','1200 Park Avenue, Suite 400','New York','NY','10128','jordan.whitfield@example.com',0),
         (NOW(),'NEW','1001','1','3105550199','Ms','Priya','Natarajan','88 Ocean Drive','Los Angeles','CA','90402','priya.n@example.com',0);

-- Allow agents to log in against the seeded server record
UPDATE servers SET active_agent_login_server='Y', active='Y' WHERE server_ip='10.10.10.15';
