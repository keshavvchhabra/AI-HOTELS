const OPENAI_API_URL = "https://api.openai.com/v1/responses";

function extractOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => item.content ?? [])
    .filter((contentItem) => contentItem.type === "output_text" && typeof contentItem.text === "string")
    .map((contentItem) => contentItem.text)
    .join("")
    .trim();
}

export function isOpenAIEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function createStructuredResponse({ name, schema, instructions, input }) {
  if (!isOpenAIEnabled()) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      instructions,
      input,
      text: {
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const text = extractOutputText(payload);

  if (!text) {
    throw new Error("OpenAI response did not include structured output text.");
  }

  return JSON.parse(text);
}
