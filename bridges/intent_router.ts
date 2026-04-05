import { OpenAI } from 'openai';

const API_KEY = 'cr-a657e8b5e8d4452081a32714cad03823';
const BASE_URL = 'https://costr.gopluslabs.io/v1';

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

export async function routeIntent(prompt: string): Promise<string> {
  // L1: 启发式快路径 (Heuristic Fast Path)
  const simpleKeywords = ['查', '搜', '天气', '几点', '你好', '读'];
  if (prompt.length < 15 && simpleKeywords.some(kw => prompt.includes(kw))) {
    return '架构o';
  }

  // L2: 极速语义分拣 (Fast-LLM Routing)
  try {
    const response = await client.chat.completions.create({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { 
          role: 'system', 
          content: '你是一个意图分拣员。根据用户指令的复杂程度，只输出一个标签：[SEQ] (简单任务，单步即可完成) 或 [PAR] (复杂任务，涉及多步骤、多任务、代码编写、深度分析或陪伴引导)。不解释，只输出标签。' 
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 10
    });

    const tag = response.choices[0].message.content?.trim();
    if (tag?.includes('[PAR]')) return '架构01';
    return '架构o';
  } catch (e) {
    return '架构o'; // 降级回默认架构
  }
}

// 模拟入口
const input = process.argv.slice(2).join(' ');
if (input) {
  routeIntent(input).then(arch => {
    console.log(arch);
  });
}
