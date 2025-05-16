import { WebClient } from "@slack/web-api";
import { generatePromptFromThread, getChatResponse } from "./_openai";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

type Event = {
  channel: string;
  type: string;
  ts: string;
  thread_ts?: string;
};

export async function sendChatResponse(event: Event) {
  const { channel, ts, thread_ts, type } = event;
  console.log("Event:", JSON.stringify(event));
  try {
    let history = null;
    if (type === "message" && !thread_ts) {
      history = await slack.conversations.history({
        channel,
        limit: Number(process.env.MESSAGE_HISTORY_LIMIT ?? "8"),
        inclusive: true,
        latest: ts,
      });
      // Reverse the messages to get the latest last
      history.messages = history.messages?.reverse();
      // console.log("History:", JSON.stringify(history));
    } else {
      history = await slack.conversations.replies({
        channel,
        ts: thread_ts ?? ts,
        inclusive: true,
        limit: Number(process.env.MESSAGE_HISTORY_LIMIT ?? "8"),
      });
      // console.log("Thread:", JSON.stringify(history));
    }
    const prompts = await generatePromptFromThread(history);
    const gptResponse = await getChatResponse(prompts);
    console.log("GPT Response:", JSON.stringify(gptResponse));

    if (event.type === "message" && !thread_ts) {
      await slack.chat.postMessage({
        channel,
        text: `${gptResponse.choices[0].message.content}`,
      });
    } else {
      await slack.chat.postMessage({
        channel,
        thread_ts: ts,
        text: `${gptResponse.choices[0].message.content}`,
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
      console.error("Stack:", error.stack);
      // Handle the error by sending a message to the Slack channel
      await slack.chat.postMessage({
        channel,
        thread_ts: ts,
        text: `Error: ${error.message}`,
      });
    }
  }
}
