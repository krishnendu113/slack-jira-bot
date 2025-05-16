import crypto from "crypto";
import dotenv from "dotenv";
import { sendChatResponse } from "./_chat";

dotenv.config();

export const config = {
  maxDuration: 30,
};

async function isValidSlackRequest(request: Request, body: any) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET!;
  const timestamp = request.headers.get("X-Slack-Request-Timestamp")!;
  const slackSignature = request.headers.get("X-Slack-Signature")!;
  const base = `v0:${timestamp}:${JSON.stringify(body)}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");
  const computedSignature = `v0=${hmac}`;
  return computedSignature === slackSignature;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const body = JSON.parse(rawBody);
  const requestType = body.type;

  console.log("Received request:", requestType, JSON.stringify(body));
  if (requestType === "url_verification") {
    return new Response(body.challenge, { status: 200 });
  }

  if (await isValidSlackRequest(request, body)) {
    if (requestType === "event_callback") {
      const eventType = body.event.type;
      const botId = body.event?.bot_id ?? undefined;
      const thread_ts = body.event?.thread_ts ?? undefined;
      const channelType = body.event?.channel_type ?? undefined;

      // Accept if the bot is mentioned in a channel, in a thread, or for all direct messages
      if (
        eventType === "app_mention" ||
        (eventType === "message" &&
          !botId &&
          thread_ts &&
          body.event.text.includes(`<@${process.env.BOT_USER_ID}>`)) ||
        (eventType === "message" && !botId && channelType === "im")
      ) {
        console.log("Selected to respond:", eventType, botId, thread_ts, channelType);
        await sendChatResponse(body.event);
        return new Response("Success!", { status: 200, headers: { "x-slack-no-retry": "1" } });
      }
    }
  }

  return new Response("OK", { status: 200, headers: { "x-slack-no-retry": "1" } });
}
