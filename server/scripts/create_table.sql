-- Table: public.metadatastore

-- DROP TABLE IF EXISTS public.metadatastore;

CREATE TABLE IF NOT EXISTS public.metadatastore
(
    id text COLLATE pg_catalog."default" NOT NULL,
    type text COLLATE pg_catalog."default" NOT NULL,
    version text COLLATE pg_catalog."default",
    attributes jsonb NOT NULL,
    reference jsonb NOT NULL,
    migrationversion jsonb,
    namespaces text[] COLLATE pg_catalog."default",
    originid text COLLATE pg_catalog."default",
    updated_at text COLLATE pg_catalog."default",
    application_id text COLLATE pg_catalog."default" NOT NULL DEFAULT 'default'::text,
    CONSTRAINT metadatastore_pkey PRIMARY KEY (id, application_id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.metadatastore
    OWNER to postgres;

GRANT SELECT ON TABLE public.metadatastore TO db_demo;

GRANT ALL ON TABLE public.metadatastore TO postgres;

-- Constraint: metadatastore_pkey

-- ALTER TABLE IF EXISTS public.metadatastore DROP CONSTRAINT IF EXISTS metadatastore_pkey;

ALTER TABLE IF EXISTS public.metadatastore
    ADD CONSTRAINT metadatastore_pkey PRIMARY KEY (id, application_id);