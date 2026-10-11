-- Dev tenant for the Meta test number. These IDs are not secrets.
-- token_ref is the name of the env var that holds the access token.
with t as (insert into public.tenants (name, plan) values ('Orvia dev tenant', 'dev') returning id)
insert into public.whatsapp_accounts (tenant_id, waba_id, phone_number_id, display_name, token_ref)
select id, '2237505606823696', '1440556255810707', 'Meta test number', 'WHATSAPP_ACCESS_TOKEN' from t;
