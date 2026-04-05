import { OpenMultiAgent } from './src/index.js'
import type { AgentConfig } from './src/types.js'

const API_KEY = 'cr-a657e8b5e8d4452081a32714cad03823';
const BASE_URL = 'https://costr.gopluslabs.io/v1';

const writer: AgentConfig = {
  name: 'specialist',
  model: 'google/gemini-3-flash-preview',
  provider: 'openai',
  apiKey: API_KEY,
  baseURL: BASE_URL,
  systemPrompt: '你是一个高效的任务执行专家。',
  tools: ['file_read', 'file_write'],
}

const orchestrator = new OpenMultiAgent({
  defaultModel: 'google/gemini-3-flash-preview',
  defaultProvider: 'openai',
  defaultApiKey: API_KEY,
  defaultBaseURL: BASE_URL,
})

const team = orchestrator.createTeam('arch-01-team', {
  name: '架构01并行团队',
  agents: [writer],
  sharedMemory: true,
})

const prompt = process.argv.slice(2).join(' ');

async function main() {
  const start = Date.now();
  const result = await orchestrator.runTeam(team, prompt);
  const end = Date.now();

  const output = {
    architecture: "架构01",
    status: result.success ? "success" : "failed",
    summary: result.agentResults.get('coordinator')?.output || "无结论",
    resource_usage: {
      tokens: result.totalTokenUsage,
      latency: `${(end - start) / 1000}s`
    },
    memory_proposals: [] // 预留给未来记忆建议
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
