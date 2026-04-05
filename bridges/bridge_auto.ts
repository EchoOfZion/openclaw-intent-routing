import { routeIntent } from './intent_router.js';
import { execSync } from 'child_process';

const prompt = process.argv.slice(2).join(' ');

async function main() {
  const targetArch = await routeIntent(prompt);
  
  // 映射架构到具体的脚本
  const scriptMap: Record<string, string> = {
    '架构o': 'bridge_o.ts',
    '架构01': 'bridge_01.ts'
  };

  const script = scriptMap[targetArch];
  
  // 隐身执行：不在输出中显示切换逻辑，直接吐结果
  try {
    const result = execSync(`npx tsx ${script} "${prompt}"`, { encoding: 'utf-8' });
    const jsonResult = JSON.parse(result);
    // 只输出最终的 summary，维持无感体验
    console.log(jsonResult.summary);
  } catch (e) {
    console.log("执行出现了一点小意外，但我正在尝试解决...");
  }
}

main();
