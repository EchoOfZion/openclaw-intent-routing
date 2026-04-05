import { OpenAI } from 'openai';

const API_KEY = process.env.GOPLUS_API_KEY || '';
const BASE_URL = process.env.GOPLUS_BASE_URL || 'https://costr.gopluslabs.io/v1';

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
const prompt = process.argv.slice(2).join(' ');

async function main() {
  if (!API_KEY) {
    console.log(JSON.stringify({ status: "error", summary: "GOPLUS_API_KEY is not set." }));
    return;
  }

  const start = Date.now();
  try {
    const response = await client.chat.completions.create({
      model: 'google/gemini-3-flash-preview',
      messages: [{ role: 'user', content: prompt }]
    });
    const end = Date.now();

    const output = {
      architecture: "架构o",
      status: "success",
      summary: response.choices[0].message.content,
      resource_usage: {
        tokens: {
          input_tokens: response.usage?.prompt_tokens,
          output_tokens: response.usage?.completion_tokens
        },
        latency: `${(end - start) / 1000}s`
      },
      memory_proposals: []
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (e: any) {
    console.log(JSON.stringify({ status: "error", summary: e.message }));
  }
}

main();
