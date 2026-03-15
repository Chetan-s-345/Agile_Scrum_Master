import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export type GroqChatOptions = {
  system?: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export async function groqChat({
  system,
  user,
  model = "llama-3.1-8b-instant",
  temperature = 0.2,
  maxTokens = 700,
}: GroqChatOptions): Promise<string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const resp = await groq.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  });

  return resp.choices?.[0]?.message?.content?.trim() ?? "";
}
