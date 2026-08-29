const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
const MODEL = (import.meta.env.VITE_ANTHROPIC_MODEL as string | undefined) || 'claude-haiku-4-5-20251001';

export interface SuggestedGroup {
  header: string;
  items: string[];
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('No API key set. Add VITE_ANTHROPIC_API_KEY to .env.local and restart the dev server.');
    this.name = 'MissingApiKeyError';
  }
}

const SYSTEM_PROMPT = `You are a curriculum-mapping assistant helping someone build a knowledge tree toward expert-level understanding of a topic.
Given a keyword and the path of parent topics it sits under, propose sub-topics that would help someone go deeper on it.
Group the sub-topics under 2-5 short, topic-appropriate headers (e.g. "Core Concepts", "Techniques", "Key Figures", "Adjacent Fields", "Common Pitfalls" - choose headers that actually fit the subject, don't force these exact ones).
Each header should have 3-6 concise sub-keyword items (a few words each, not full sentences).
Do not repeat any of the "already present" terms given to you.
Respond with ONLY minified JSON matching this schema, no markdown fences, no commentary:
{"groups":[{"header":string,"items":string[]}]}`;

export async function suggestRelated(
  term: string,
  ancestors: string[],
  alreadyPresent: string[]
): Promise<SuggestedGroup[]> {
  if (!API_KEY) throw new MissingApiKeyError();

  const path = [...ancestors, term].join(' > ');
  const userMessage = [
    `Topic: ${term}`,
    `Path: ${path}`,
    alreadyPresent.length ? `Already present (do not repeat): ${alreadyPresent.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const text: string = data.content?.map((b: { text?: string }) => b.text || '').join('') ?? '';
  const jsonText = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed.groups)) throw new Error('Unexpected AI response shape');
  return parsed.groups;
}
