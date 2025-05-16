import pg from "pg";
import dotenv from "dotenv";
import axios from "axios";
import { OpenAIEmbeddings } from "@langchain/openai";

// Load environment variables from .env file
dotenv.config();

type FieldValueMap = {
  issuetypes: { name: string; id: string }[];
  priority: { name: string; id: string }[];
  components: { name: string; id: string }[];
  brands: { name: string; id: string }[];
  environments: { name: string; id: string }[];
};

let fieldValueMapGlobal: FieldValueMap | null = null;

const source = `${process.env.JIRA_BASE_URL}/software/c/projects/${process.env.JIRA_PROJECT_KEY}/issues`;

const authHeader = {
  Authorization: `Basic ${Buffer.from(
    `${process.env.JIRA_USERNAME}:${process.env.JIRA_PERSONAL_ACCESS_TOKEN}`
  ).toString("base64")}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

// Create a new connection pool
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_POOL_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function getEmbedding(text: string): Promise<number[]> {
  const embeddings = new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBED_MODEL,
  });
  const embededtext = await embeddings.embedQuery(text);
  return embededtext;
}

export async function retrieveSimilarIssuesByEmbedding({
  textToSearch,
  limit = 5,
}: {
  textToSearch: string;
  limit?: number;
}): Promise<
  { content: string; metadata: any; similarity: number }[] | undefined
> {
  try {
    const embedding = await getEmbedding(textToSearch);
    const query =
      `select source, url, chunk_number, title, summary, content, metadata, ` +
      `1 - (cap_jira_issues.embedding <=> $1) as similarity ` +
      `from cap_jira_issues where source = $2 ` +
      `and 1 - (cap_jira_issues.embedding <=> $1) > 0.5 ` +
      `order by cap_jira_issues.embedding <=> $1 limit $3;`;
    console.log("query", query);
    console.log("embedding", embedding.length);
    console.log("source", source);
    console.log("limit", limit);
    const result = await pool.query(query, [`[${embedding}]`, source, limit]);
    const records = result.rows.map((row: any) => {
      const record = {
        content: row.content,
        metadata: row.metadata,
        similarity: row.similarity,
      };
      return record;
    });
    console.log("Query records", records.length);
    return records;
  } catch (err) {
    console.error("Error executing query:", err);
  }
}

export async function retrieveSimilarIssuesByTextSearch({
  textToSearch,
  limit = 5,
}: {
  textToSearch: string;
  limit?: number;
}): Promise<{ similarTickets: any[] }> {
  const jql = `project = ${process.env.JIRA_PROJECT_KEY} AND textfields ~ "${textToSearch}" ORDER BY created DESC`;
  const res = await axios.get(
    `${process.env.JIRA_BASE_URL}/rest/api/3/search`,
    {
      headers: authHeader,
      params: {
        jql,
        maxResults: limit,
        expand: "renderedFields",
        fields: "summary,description,resolution",
      },
    }
  );

  const similar = res.data.issues.map((issue: any) => {
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.renderedFields.description,
      resolution: issue.renderedFields.resolution ?? issue.fields.resolution,
      url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
    };
  });

  return { similarTickets: similar };
}

export async function getJiraIssueByIdOrKey({
  idOrKey,
}: {
  idOrKey: string;
}): Promise<{
  id: string;
  key: string;
  summary: string;
  description: string;
  resolution: string;
  url: string;
}> {
  const res = await axios.get(
    `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${idOrKey}`,
    {
      headers: authHeader,
      params: {
        expand: "renderedFields",
        fields: "summary,description,resolution",
      },
    }
  );

  const issue = res.data;

  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    description: issue.renderedFields.description,
    resolution: issue.renderedFields.resolution ?? issue.fields.resolution,
    url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
  };
}

export async function getSupportedValuesForFields(): Promise<FieldValueMap> {
  if (fieldValueMapGlobal !== null) {
    return fieldValueMapGlobal;
  }

  const res = await axios.get(
    `${process.env.JIRA_BASE_URL}/rest/api/3/issue/createmeta`,
    {
      headers: authHeader,
      params: {
        projectKeys: process.env.JIRA_TEST_PROJECT_KEY,
        expand: "projects.issuetypes.fields",
      },
    }
  );

  const project = res.data.projects[0];

  const fieldValueMap: FieldValueMap = {
    issuetypes: project.issuetypes.map((type: any) => ({
      name: type.name,
      id: type.id,
    })),
    priority: project.issuetypes[0].fields.priority.allowedValues.map(
      (priority: any) => ({
        name: priority.name,
        id: priority.id,
      })
    ),
    components: project.issuetypes[0].fields.components.allowedValues.map(
      (component: any) => ({
        name: component.name,
        id: component.id,
      })
    ),
    brands: project.issuetypes[0].fields.customfield_11997.allowedValues.map(
      (brand: any) => ({
        name: brand.value,
        id: brand.id,
      })
    ),
    environments:
      project.issuetypes[0].fields.customfield_11800.allowedValues.map(
        (environment: any) => ({
          name: environment.value,
          id: environment.id,
        })
      ),
  };

  return fieldValueMap;
}

export async function searchUsers({
  query,
}: {
  query: string;
}): Promise<{ accountId: string; name: string; email: string }[]> {
  const res = await axios.get(
    `${process.env.JIRA_BASE_URL}/rest/api/3/user/search`,
    {
      headers: authHeader,
      params: {
        query,
      },
    }
  );

  const users = res.data;

  return users.map((user: any) => ({
    accountId: user.accountId,
    name: user.displayName,
    email: user.emailAddress,
  }));
}

export async function createJiraTicket({
  issueType,
  priority,
  summary,
  description,
  brand,
  component,
  environment,
  assigneeId,
}: {
  issueType: string;
  priority: string;
  summary: string;
  description: string;
  brand: string;
  component: string;
  environment: string;
  assigneeId?: string;
}): Promise<{ ticketId: string; url: string; assignResponse: any }> {
  const response = await axios.post(
    `${process.env.JIRA_BASE_URL}/rest/api/3/issue`,
    {
      fields: {
        project: { key: process.env.JIRA_TEST_PROJECT_KEY },
        issuetype: {
          name: issueType,
        },
        summary,
        description: {
          content: [
            {
              content: [
                {
                  text: description,
                  type: "text",
                },
              ],
              type: "paragraph",
            },
          ],
          type: "doc",
          version: 1,
        },
        customfield_11997: [
          {
            value: brand,
          },
        ],
        components: [
          {
            name: component,
          },
        ],
        priority: {
          name: priority,
        },
        customfield_11800: [
          {
            value: environment,
          },
        ],
      },
    },
    {
      headers: authHeader,
    }
  );

  let assignResponse = null;
  if (assigneeId) {
    try {
      assignResponse = await assignJiraTicket({
        idOrKey: response.data.key,
        accountId: assigneeId,
      });
      console.log("Assign response", JSON.stringify(assignResponse));
    } catch (error) {
      const err = error as any;
      assignResponse = {
        code: err?.code,
        name: err?.name,
        message: err?.message,
        status: err?.response?.status,
        body: err?.response?.data,
      };
    }
  }

  return {
    ticketId: response.data.key,
    url: `${process.env.JIRA_BASE_URL}/browse/${response.data.key}`,
    assignResponse,
  };
}

export async function assignJiraTicket({
  idOrKey,
  accountId,
}: {
  idOrKey: string;
  accountId: string;
}): Promise<{ status: number }> {
  const response = await axios.put(
    `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${idOrKey}/assignee`,
    {
      accountId,
    },
    {
      headers: authHeader,
    }
  );

  return {
    status: response.status,
  };
}
