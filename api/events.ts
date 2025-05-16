import dotenv from "dotenv";

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
  fetch(`${process.env.BACKEND_API_URL}/api/reply`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }).catch(console.error); // Fire and forget

  return new Response("OK", { status: 200, headers: { "x-slack-no-retry": "1" } });
}
