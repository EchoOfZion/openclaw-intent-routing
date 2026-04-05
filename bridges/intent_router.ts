import { OpenAI } from 'openai';

const API_KEY = process.env.GOPLUS_API_KEY || '';
const BASE_URL = process.env.GOPLUS_BASE_URL || 'https://costr.gopluslabs.io/v1';

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

export async function routeIntent(prompt: string): Promise<string> {
  if (!API_KEY) return '架构o';

  const simpleKeywords = ['查', '搜', '天气', '几点', '你好', '读'];
  if (prompt.length < 15 && simpleKeywords.some(kw => prompt.includes(kw))) {
    return '架构o';
  }

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
    return '架构o';
  }
}
