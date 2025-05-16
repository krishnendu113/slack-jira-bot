# JIRA Slackbot with Vercel

This is a Slack chatbot that leverages OpenAI's GPT models and integrates with Supabase as a vector store for Retrieval-Augmented Generation (RAG). It also connects to JIRA to help you manage tasks, including ticket creation (with duplicate detection via RAG), ticket summarization, and assigning tickets to users. The bot is deployed on Vercel.

### Features

- **JIRA Task Q&A:** Ask questions specifically about JIRA tasks and get answers powered by OpenAI's GPT models.
- **JIRA Integration:** 
  - Create new JIRA tickets with duplicate check using RAG.
  - Summarize any JIRA ticket.
  - Assign tickets to users directly from Slack.
- **RAG with Supabase:** Uses Supabase as a vector store to enhance responses and perform duplicate detection for JIRA tickets.
- **Easy Deployment:** Runs seamlessly on Vercel.

### Environment Variables

After completing the setup instructions below, you will have the following `.env` file in your project for local testing, and the same environment variables added on Vercel:

```bash
OPENAI_API_KEY=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_ADMIN_MEMBER_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
```

#### OpenAI API Key

- Create a new key on [OpenAI API Keys](https://platform.openai.com/api-keys) and "Create new secret key", optionally naming the key.
- Add the key to Vercel's environment variables as `OPENAI_API_KEY`.

#### Slack Bot Token & Signing Secret

Go to [Slack API Apps Page](https://api.slack.com/apps):

- Create new App
  - From Scratch
  - Name your app & pick a workspace
- Go to OAuth & Permissions
  - Scroll to scopes
  - Add the following scopes
    - `app_mentions:read`
    - `channels:history`
    - `chat:write`
    - `commands`
  - Click "Install to Workplace"
  - Copy **Bot User OAuth Token**
  - Add the token to Vercel's environment variables as `SLACK_BOT_TOKEN`
- Getting signing secret
  - Basic Information --> App Credentials --> Copy **Signing Secret**
  - Add the secret to Vercel's environment variables as `SLACK_SIGNING_SECRET`

#### Supabase Configuration

- Create a project on [Supabase](https://supabase.com/).
- Get your project URL and Service Role Key.
- Add them to Vercel's environment variables as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

#### JIRA Configuration

- Get your JIRA instance base URL, email, and API token.
- Add them to Vercel's environment variables as `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`.

#### Admin's Slack Member ID

- Click on your profile picture in Slack and click **Profile**.
- Click on the three dots in the middle right corner and select **Copy member ID**.
- Add the ID to Vercel's environment variables as `SLACK_ADMIN_MEMBER_ID`.

### Enable Slack Events

After successfully deploying the app, go to [Slack API Apps Page](https://api.slack.com/apps) and select your app:

- Go to **Event Subscriptions** and enable events.
- Add the following URL to **Request URL**:
  - `https://<your-vercel-app>.vercel.app/api/events`
  - Make sure the URL is verified, otherwise check out [Vercel Logs](https://vercel.com/docs/observability/runtime-logs) for troubleshooting.
  - Subscribe to bot events by adding:
    - `app_mention`
    - `channel_created`
  - Click **Save Changes**.
- Slack requires you to reinstall the app to apply the changes.

## Local Development

Use the [Vercel CLI](https://vercel.com/docs/cli) and [localtunnel](https://github.com/localtunnel/localtunnel) to test out this project locally:

```sh
pnpm i -g vercel
pnpm vercel dev --listen 3000 --yes
```

```sh
npx localtunnel --port 3000
```

Make sure to modify the [subscription URL](./README.md/#enable-slack-events) to the `localtunnel` URL.

## Production Deployment

To deploy your Slackbot to production using Vercel:

1. Push your latest code to your main branch (e.g., `main` or `master`).
2. Go to your project on [Vercel Dashboard](https://vercel.com/dashboard) and click **Deploy**.
3. Or, deploy directly from the command line:

```sh
vercel --prod
```

This will trigger a production deployment and provide you with a live URL (e.g., `https://your-app.vercel.app`). Use this URL for your Slack Event Subscriptions in production.
