// LLM 客户端 - 兼容 OpenAI API 格式
import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getLLMClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;
  console.log(baseURL)

  if (!apiKey || apiKey === 'your-api-key-here') {
    console.error('❌ 请先配置 .env 文件中的 LLM_API_KEY');
    console.error('   复制 .env.example 为 .env 并填入你的 API Key');
    process.exit(1);
  }

  client = new OpenAI({
    apiKey,
    baseURL: baseURL || 'https://open.bigmodel.cn/api/coding/paas/v4',
    timeout: 120000,
  });

  return client;
}

export interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  onChunk?: (text: string) => void;
}

export interface GenerateResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function generateText(options: GenerateOptions): Promise<GenerateResult> {
  const client = getLLMClient();
  const model = options.model || process.env.LLM_MODEL || 'glm-4-flash';

  if (options.stream) {
    return generateStream(client, model, options);
  }

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 8192,
  });

  const content = response.choices[0]?.message?.content || '';
  const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    },
  };
}

/**
 * 流式生成，实时输出到控制台
 */
async function generateStream(
  client: OpenAI,
  model: string,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 8192,
    stream: true,
  });

  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      content += text;
      options.onChunk?.(text);
    }
    // 尝试从流中获取 usage（部分 API 支持）
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens;
      completionTokens = chunk.usage.completion_tokens;
    }
  }

  return {
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens || Math.round(content.length * 1.5),
    },
  };
}

/**
 * 带重试的文本生成
 */
export async function generateWithRetry(
  options: GenerateOptions,
  maxRetries: number = 3,
): Promise<GenerateResult> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateText(options);
    } catch (error: any) {
      console.log('error', error)
      lastError = error;
      const isRateLimit = error?.status === 429;
      const waitTime = isRateLimit ? (i + 1) * 10000 : (i + 1) * 3000;
      console.log(`  ⚠️ 第 ${i + 1} 次重试（${isRateLimit ? '限流' : '错误'}），等待 ${waitTime / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw lastError!;
}
