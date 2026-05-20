import { Anthropic } from '@anthropic-ai/sdk';
import {
  assertConfigured,
  buildAdapterResponse,
  estimateCostUsd,
  estimateTokens,
  getEnvNumber,
  sanitizeErrorMessage,
} from './base.js';

export class AnthropicAdapter {
  constructor(head, env = process.env) {
    this.id = head.id;
    this.name = head.name;
    this.head = head;
    this.envKey = head.envKey || 'ANTHROPIC_API_KEY';
    this.apiKey = env[this.envKey];
    this.model = head.model || env.ANTHROPIC_MODEL || head.defaultModel;
    this.client = this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : null;
    this.lastConnectionError = '';
  }

  async connect() {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.messages.create({
        model: process.env.ANTHROPIC_DOCTOR_MODEL || 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch (error) {
      this.lastConnectionError = sanitizeErrorMessage(error);
      return false;
    }
  }

  async sendPrompt(context, prompt, stream = false, options = {}) {
    assertConfigured(this);

    if (options.tools && options.tools.length > 0) {
      return this.#sendPromptWithTools(context, prompt, options);
    }

    const request = {
      model: this.model,
      max_tokens: getEnvNumber('ANTHROPIC_MAX_TOKENS', 2048),
      system: context,
      messages: [{ role: 'user', content: prompt }],
    };

    if (stream) {
      const responseStream = await this.client.messages.create({ ...request, stream: true });
      let text = '';
      for await (const event of responseStream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          text += event.delta.text;
        }
      }

      return this.#response(text, null, context, prompt);
    }

    const response = await this.client.messages.create(request);
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return this.#response(text, response, context, prompt, {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });
  }

  async #sendPromptWithTools(context, prompt, options) {
    const { tools, executeTool, maxIterations = 10, onUsage } = options;
    const messages = [{ role: 'user', content: prompt }];
    let lastResponse = null;
    let aggregateText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: getEnvNumber('ANTHROPIC_MAX_TOKENS', 2048),
        system: context,
        messages,
        tools,
      });
      lastResponse = response;
      inputTokens += response.usage?.input_tokens || 0;
      outputTokens += response.usage?.output_tokens || 0;

      const textBlocks = response.content.filter((block) => block.type === 'text');
      const text = textBlocks.map((block) => block.text).join('');
      if (text) {
        aggregateText = text;
      }

      if (onUsage) {
        await onUsage({
          iteration,
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
        });
      }

      const toolUses = response.content.filter((block) => block.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return this.#response(aggregateText, response, context, prompt, {
          inputTokens,
          outputTokens,
        });
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const toolUse of toolUses) {
        const result = await executeTool({
          name: toolUse.name,
          input: toolUse.input,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.output,
          is_error: result.isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const cappedText = `${aggregateText}\n\n[Hydra: tool-use loop hit ${maxIterations}-iteration cap before completing.]`;
    return this.#response(cappedText, lastResponse, context, prompt, {
      inputTokens,
      outputTokens,
    });
  }

  getTokenCount(text) {
    return estimateTokens(text);
  }

  getEstimatedCost(tokens) {
    return estimateCostUsd(tokens, getEnvNumber('ANTHROPIC_ESTIMATED_USD_PER_1M_TOKENS', 9));
  }

  #response(text, raw, context, prompt, usage = {}) {
    const estimatedTokens = this.getTokenCount(`${context}\n${prompt}\n${text}`);
    return buildAdapterResponse({
      head: this.id,
      model: this.model,
      text,
      raw,
      usage,
      estimatedTokens,
      estimatedCostUsd: this.getEstimatedCost(estimatedTokens),
    });
  }
}
