import { createWriteStream } from "fs";
import dotenv from "dotenv";
import perfy from "perfy";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { JiraProjectLoader } from "@langchain/community/document_loaders/web/jira";
import type { Document } from "@langchain/core/documents";

dotenv.config();

const fetchJiraTickets = async (): Promise<Document[]> => {
  const loader = new JiraProjectLoader({
    host: process.env.JIRA_BASE_URL!,
    projectKey: process.env.JIRA_PROJECT_KEY!,
    username: process.env.JIRA_USERNAME!,
    accessToken: process.env.JIRA_PERSONAL_ACCESS_TOKEN!,
  });

  console.log("Fetching Jira tickets...");
  const documents = await loader.load();
  return documents;
};

const chunkDocuments = async (documents: Document[]): Promise<Document[]> => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 10000,
    chunkOverlap: 2000,
    separators: ["\n\n", "##", "\n", "#", ".", "?", "!", " "],
  });

  return splitter.splitDocuments(documents);
};

const getEmbeddings = async (content: string): Promise<number[]> => {
  const embeddings = new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBED_MODEL,
  });

  return embeddings.embedQuery(content);
};

const enrichChunksWithMetadata = (chunks: Document[]): Document[] => {
  return chunks.map((chunk) => {
    const issueRegex = /^Issue:\s([^(]*)\s.*$/gm;
    const issueMatch = issueRegex.exec(chunk.pageContent);
    const issueKey = issueMatch ? issueMatch[1].trim() : null;
    const url = `${process.env.JIRA_BASE_URL}/browse/${issueKey}`;
    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        url,
        issueKey,
      },
    };
  });
};

const main = async (): Promise<void> => {
  const source = `${process.env.JIRA_BASE_URL}/software/c/projects/${process.env.JIRA_PROJECT_KEY}/issues`;
  const writeStream = createWriteStream("jira-openai-embed3.tsv");
  const header =
    `"source"\t"url"\t"chunk_number"\t"title"\t"summary"\t"content"\t"metadata"\t"embedding"\n`;
  writeStream.write(header);

  // 1. Fetch from JIRA
  const tickets = await fetchJiraTickets();
  console.log("Fetched Documents:", tickets.length);

  // 2. Chunk the documents
  const chunkedDocs = await chunkDocuments(tickets);
  console.log("Chunked Documents:", chunkedDocs.length);

  // 3. Enrich with metadata (url, issueKey)
  const enrichedChunks = enrichChunksWithMetadata(chunkedDocs);

  // 4. Embed and write to file
  let chunk_number = 0;
  let count = 0;
  let prevUrl: string | null = null;
  const total = enrichedChunks.length;

  for (const chunk of enrichedChunks) {
    count += 1;
    if (prevUrl === null) {
      prevUrl = chunk.metadata.url;
    }
    if (prevUrl !== chunk.metadata.url) {
      chunk_number = 0;
      prevUrl = chunk.metadata.url;
    }
    const title = "Title Placeholder";
    const summary = "Summary Placeholder";
    perfy.start("Embeddings");
    const embeddings = await getEmbeddings(chunk.pageContent);
    let result = perfy.end("Embeddings");
    console.log(
      `Embeddings generated of dim ${embeddings.length} (${count}/${total}): [${result.time} secs]`
    );
    perfy.start("File write");
    const data = `"${source}"\t"${
      chunk.metadata.url
    }"\t"${chunk_number}"\t"${title}"\t"${summary}"\t"${chunk.pageContent.replaceAll(
      '"',
      '""'
    )}"\t"${JSON.stringify(chunk.metadata).replaceAll(
      '"',
      '""'
    )}"\t"[${embeddings.toString()}]"\n`;
    writeStream.write(data);
    result = perfy.end("File write");
    console.log(`File written (${count}/${total}): [${result.time}] secs`);
    chunk_number += 1;
  }

  writeStream.end();
  console.log("All chunks processed and written to file.");
};

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
