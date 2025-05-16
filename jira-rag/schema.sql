create table if not exists cap_jira_issues (
    source text,
    url text not null,
    chunk_number integer not null,
    title text not null,
    summary text not null,
    content text not null,  -- Added content column
    metadata jsonb not null default '{}'::jsonb,  -- Added metadata column
    embedding vector(1536),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    
    -- Add a unique constraint to prevent duplicate chunks for the same URL
    constraint pk_jira_source_url_chunk primary key (source, url, chunk_number)
);

-- Create an index for better vector similarity search performance
create index if not exists idx_jira_issues_embedding on cap_jira_issues using ivfflat (embedding vector_cosine_ops);

-- Create an index on metadata for faster filtering
create index if not exists idx_jira_issues_metadata on cap_jira_issues using gin (metadata);

-- Create an index for better full text search
CREATE INDEX idx_jira_issues_content ON cap_jira_issues USING GIN (to_tsvector('english', content));

CREATE OR REPLACE FUNCTION update_updated_on_cap_jira_issues()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_cap_jira_issues_updated_at
    BEFORE UPDATE
    ON cap_jira_issues
    FOR EACH ROW
EXECUTE PROCEDURE update_updated_on_cap_jira_issues();
