import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources";
import type { ConversationsRepliesResponse } from "@slack/web-api";
import { assignJiraTicket, createJiraTicket, getJiraIssueByIdOrKey, getSupportedValuesForFields, retrieveSimilarIssuesByEmbedding, retrieveSimilarIssuesByTextSearch, searchUsers } from "./_jira";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT: ChatCompletionMessageParam = {
  role: "system",
  content:
    "You are a helpful assistant integrated with JIRA. " +
    "You can search for similar tickets, summarize their resolutions, create new tickets, " +
    "and optionally assign them to users. You operate only within the context of JIRA issue management. " +
    "If a user asks for something unrelated to JIRA issues, politely decline and clarify your scope. " +
    "Analyze the user's request and determine which tools to invoke. " +
    "Use multiple tools if needed to accomplish the task. " +
    "For fetching similar tickets, use retrieval with keyword refinement, JIRA text search, or both. " +
    "Refine the user's query to improve search accuracy before passing it to any search tool. " +
    "Always check for similar tickets before creating a new one unless specifically asked by user to skip. " +
    "If similar tickets exist, summarize their content and provide links to the user. " +
    "Encourage the user to consult these before proceeding to create a new ticket. " +
    "If the user still requests a new ticket, collect all required fields in one interaction. " +
    "Validate each field against its list of allowed values for the JIRA project. " +
    "If any value is missing or invalid, suggest valid options clearly to the user. " +
    "Minimize back-and-forth: confirm all required fields and values together in a single step. " +
    "If assignment was not requested, you may optionally suggest assigning it after creation. " +
    "Search for matching users if assignment is needed, and confirm before assigning. " +
    "Always share the issue link with the user after creation and confirm assignment status if applicable.",
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

function resolveToolFunction(name: string): ((args?: any) => Promise<any>) | null {
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
  return toolResults.map((toolResult, i) => ({
    role: "tool",
    tool_call_id: toolCalls[i].id,
    content: JSON.stringify(
      toolResult.status === "fulfilled" ? toolResult.value : toolResult.reason
    ),
  }));
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

  console.log("Conversation:", JSON.stringify(result));
  return result as ChatCompletionMessageParam[];
}
