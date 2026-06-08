import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const websearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  maxResults: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return (1-10)",
      minimum: 1,
      maximum: 10,
      default: 5,
    }),
  ),
});

type DuckTopic = {
  Text?: string;
  FirstURL?: string;
  Topics?: DuckTopic[];
};

function flattenTopics(topics: DuckTopic[] | undefined): Array<{ title: string; url: string }> {
  if (!topics) return [];
  const out: Array<{ title: string; url: string }> = [];

  for (const topic of topics) {
    if (Array.isArray(topic.Topics)) {
      out.push(...flattenTopics(topic.Topics));
      continue;
    }
    if (topic.Text && topic.FirstURL) {
      out.push({ title: topic.Text, url: topic.FirstURL });
    }
  }

  return out;
}

export default function websearchTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: "Search the web for external information and links",
    promptSnippet: "Search the web for current/external info and return source links",
    promptGuidelines: ["Use websearch when answering requires external or up-to-date web information."],
    parameters: websearchParams,
    async execute(_toolCallId, params, signal) {
      const maxResults = Math.max(1, Math.min(10, Math.floor(params.maxResults ?? 5)));
      const url = new URL("https://api.duckduckgo.com/");
      url.searchParams.set("q", params.query);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_html", "1");
      url.searchParams.set("no_redirect", "1");
      url.searchParams.set("skip_disambig", "1");

      const response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "pi-websearch-tool/1.0" },
        signal,
      });

      if (!response.ok) {
        throw new Error(`Web search failed: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: DuckTopic[];
      };

      const results = flattenTopics(payload.RelatedTopics).slice(0, maxResults);
      const lines: string[] = [];

      if (payload.AbstractText && payload.AbstractURL) {
        lines.push(`- ${payload.AbstractText} (${payload.AbstractURL})`);
      }
      for (const result of results) {
        lines.push(`- ${result.title} (${result.url})`);
      }

      const text = lines.length
        ? `Web results for: ${params.query}\n\n${lines.join("\n")}`
        : `No web results found for: ${params.query}`;

      return {
        content: [{ type: "text", text }],
        details: { query: params.query, maxResults, resultCount: lines.length },
      };
    },
  });
}
