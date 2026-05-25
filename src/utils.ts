// 共享工具函数

/**
 * 从 LLM 输出中提取 JSON 字符串
 * 处理代码块包裹、trailing comma、未闭合括号等常见问题
 */
export function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let raw = codeBlockMatch ? codeBlockMatch[1].trim() : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    raw = raw.slice(start, end + 1);
  }
  raw = raw.replace(/,\s*([\]}])/g, '$1');
  return closeBrackets(raw).trim();
}

/**
 * 闭合未完成的 JSON 括号，处理 LLM 输出被截断的情况
 */
export function closeBrackets(text: string): string {
  // 去除末尾逗号
  text = text.replace(/,\s*$/, '');
  // 处理被截断的字符串值："somekey": "某个未完结的字符
  text = text.replace(/:\s*"((?:[^"\\]|\\.)*)$/s, ': "$1"');
  // 处理没有引号的值
  text = text.replace(/:\s*([^"\s{}\[\]][^"\n]*)$/, '');
  text = text.replace(/,\s*$/, '');

  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (const ch of text) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); }
    else if (ch === '}' || ch === ']') { if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop(); }
  }

  while (stack.length > 0) { text += stack.pop(); }
  return text;
}

/**
 * 统计中文字符数（CJK Unified Ideographs）
 */
export function countChineseChars(text: string): number {
  return text.replace(/[^一-鿿]/g, '').length;
}
