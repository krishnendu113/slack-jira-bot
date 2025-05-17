import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import type { ConversationsRepliesResponse } from "@slack/web-api";
import {
  assignJiraTicket,
  createJiraTicket,
  getJiraIssueByIdOrKey,
  getSupportedValuesForFields,
  retrieveSimilarIssuesByEmbedding,
  retrieveSimilarIssuesByTextSearch,
  searchUsers,
} from "./_jira";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT: ChatCompletionMessageParam = {
  role: "system",
  content:
    "You are a helpful assistant integrated with JIRA. " +
    "You can search for similar tickets, summarize their resolutions, create new tickets, " +
    "and optionally assign them to users. You operate only within the context of JIRA issue management. " +
    "If a user asks for something unrelated to JIRA issues, politely decline and clarify your scope. " +
    "Analyze the user's request and determine which tools to invoke. Use tools in parallel if needed. " +
    "For similar ticket search, use retrieval with keyword refinement, JIRA search, or both. " +
    "When doing retrieval, rephrase query to remove brand, offer, or client-specific terms. " +
    "Use abstracted issue description for better semantic match. " +
    "For JIRA search, use no more than 4 high-signal keywords from the user query. " +
    "Always check for similar tickets unless user explicitly opts out. " +
    "If matches are found, summarize key details and provide clickable links. " +
    "Encourage the user to review them before proceeding. " +
    "If new ticket creation is requested, collect all required and optional fields together. " +
    "Call getSupportedValuesForFields and searchUsers in parallel to validate values. " +
    "Do not hallucinate field values — only use values returned from validation tools. " +
    "When confirming values, display user-friendly label or email, with actual value in brackets. " +
    "Example: 'Would you like to assign this to John <john@demo.com> (acc123)?' or 'Priority: High (High-P3)'. " +
    "Ask politely and clearly when presenting values — use asking tone, not confirming tone. " +
    "Always store validated actual values from responses for reuse in follow-up interactions. " +
    "Use Slack history context to preserve memory across user sessions. " +
    "Assignee accountId (from searchUsers) can be included directly during ticket creation. " +
    "Do not confirm each value separately — collect, confirm, and create in one step. " +
    "If ticket creation fails, only re-ask for missing or invalid fields. " +
    "Do not request values not required by tool schema like project key unless necessary. " +
    "Always return the created ticket link and summarize assignment status if applicable. " +
    "This prompt follows prior user-agent conversation. Use its context to reduce user effort further.",
};

const TOOLS: Array<ChatCompletionTool> = [
  {
    type: "function",
    function: {
      name: "retrieveSimilarIssuesByEmbedding",
      description:
        "Fetches similar JIRA tickets for a given issue description using embeddings.",
      parameters: {
        type: "object",
        properties: {
          textToSearch: { type: "string" },
          limit: { type: "number" },
        },
        required: ["textToSearch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retrieveSimilarIssuesByTextSearch",
      description:
        "Fetches similar JIRA tickets for 2-3 keywords using text search in JIRA. Does not support full text search.",
      parameters: {
        type: "object",
        properties: {
          textToSearch: { type: "string" },
          limit: { type: "number" },
        },
        required: ["textToSearch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getJiraIssueByIdOrKey",
      description: "Fetches one JIRA tickets for a given issue id or key.",
      parameters: {
        type: "object",
        properties: {
          idOrKey: { type: "string" },
        },
        required: ["idOrKey"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getSupportedValuesForFields",
      description:
        "Fetches supported values for JIRA fields which are required to create a ticket.",
      parameters: {},
    },
  },
  {
    type: "function",
    function: {
      name: "searchUsers",
      description:
        "Fetches users in JIRA by the partial name or email given by user for ticket assignment.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createJiraTicket",
      description: "Creates a new JIRA ticket with a given summary.",
      parameters: {
        type: "object",
        properties: {
          priority: {
            type: "string",
            default: "Medium-P2",
          },
          issueType: {
            type: "string",
            default: "Task",
          },
          summary: { type: "string" },
          description: { type: "string" },
          brand: { type: "string" },
          component: { type: "string", default: "na" },
          environment: { type: "string" },
          assigneeId: { type: "string" },
        },
        required: [
          "priority",
          "issueType",
          "summary",
          "description",
          "brand",
          "component",
          "environment",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assignJiraTicket",
      description:
        "Assigns a JIRA ticket to a user based on the user's account id.",
      parameters: {
        type: "object",
        properties: {
          idOrKey: { type: "string" },
          accountId: { type: "string" },
        },
        required: ["idOrKey", "accountId"],
      },
    },
  },
];

function resolveToolFunction(
  name: string
): ((args?: any) => Promise<any>) | null {
  switch (name) {
    case "retrieveSimilarIssuesByEmbedding":
      return retrieveSimilarIssuesByEmbedding;
    case "retrieveSimilarIssuesByTextSearch":
      return retrieveSimilarIssuesByTextSearch;
    case "getJiraIssueByIdOrKey":
      return getJiraIssueByIdOrKey;
    case "getSupportedValuesForFields":
      return getSupportedValuesForFields;
    case "searchUsers":
      return searchUsers;
    case "createJiraTicket":
      return createJiraTicket;
    case "assignJiraTicket":
      return assignJiraTicket;
    default:
      return null;
  }
}

function mapToolResultsToPrompts(
  toolResults: PromiseSettledResult<any>[],
  toolCalls: any[]
): ChatCompletionMessageParam[] {
  return toolResults.map((toolResult, i) => {
    const resp: ChatCompletionMessageParam = {
      role: "tool",
      tool_call_id: toolCalls[i].id,
      content: JSON.stringify(
        toolResult.status === "fulfilled"
          ? toolResult.value
          : {
              code: toolResult.reason?.code,
              name: toolResult.reason?.name,
              message: toolResult.reason?.message,
              status: toolResult.reason?.response.status,
              body: toolResult.reason?.response.data,
            }
      ),
    };
    console.log("Tool Result:", JSON.stringify(resp));
    return resp;
  });
}

export async function getChatResponse(
  messages: ChatCompletionMessageParam[]
): Promise<ChatCompletion> {
  const chatResponse = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL!,
    messages: [SYSTEM_PROMPT, ...messages],
    tools: TOOLS,
    tool_choice: "auto",
  });

  const toolCalls = chatResponse.choices[0].message.tool_calls;

  if (!toolCalls?.length) {
    return chatResponse;
  }

  const toolPromises = toolCalls.map((toolCall: any) => {
    const toolFn = resolveToolFunction(toolCall.function.name);
    const args = JSON.parse(toolCall.function.arguments);
    console.log("Tool Call:", toolCall.function.name);
    console.log("Tool Call Arguments:", toolCall.function.arguments);
    if (toolFn) {
      if (Object.keys(args).length !== 0) {
        return toolFn(args);
      } else {
        return toolFn();
      }
    } else {
      return Promise.resolve(null);
    }
  });

  const toolResults = await Promise.allSettled(toolPromises);
  const toolPrompts = mapToolResultsToPrompts(toolResults, toolCalls);

  const followUp = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL!,
    messages: [
      SYSTEM_PROMPT,
      ...messages,
      { role: "assistant", tool_calls: toolCalls },
      ...toolPrompts,
    ],
  });

  return followUp;
}

export async function generatePromptFromThread({
  messages,
}: ConversationsRepliesResponse) {
  if (!messages) throw new Error("No messages found in thread");
  const botID = messages[0].reply_users?.[0];

  const result = messages
    .map((message: any) => {
      const isBot = !!message.bot_id && !message.client_msg_id;

      return {
        role: isBot ? "assistant" : "user",
        content: isBot
          ? message.text
          : message.text.replace(`<@${botID}> `, ""),
      };
    })
    .filter(Boolean);

  // console.log("Conversation:", JSON.stringify(result));
  return result as ChatCompletionMessageParam[];
}
