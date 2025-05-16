import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

export const config = {
  maxDuration: 30,
};

export async function POST(request: Request) {
  const body = await request.json();
  const requestType = body.type;

  if (requestType === "url_verification") {
    return new Response(body.challenge, { status: 200 });
  }

  // Forward the event to your async processor (don't await)
  axios.post(`${process.env.BACKEND_API_URL}/api/reply`, body, {
    headers: { 'Content-Type': 'application/json' },
  }).catch(console.error); // Fire and forget

  console.log("API fired", `${process.env.BACKEND_API_URL}/api/reply`, body);

  return new Response("OK", { status: 200, headers: { "x-slack-no-retry": "1" } });
}
