import { OpenAI } from 'openai';

const API_KEY = 'cr-a657e8b5e8d4452081a32714cad03823';
const BASE_URL = 'https://costr.gopluslabs.io/v1';

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
const prompt = process.argv.slice(2).join(' ');

async function main() {
  const start = Date.now();
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
}

main();
