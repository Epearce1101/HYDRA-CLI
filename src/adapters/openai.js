import OpenAI from 'openai';
import {
  assertConfigured,
  buildAdapterResponse,
  estimateCostUsd,
  estimateTokens,
  getEnvNumber,
  sanitizeErrorMessage,
} from './base.js';

export class OpenAIAdapter {
  constructor(head, env = process.env) {
    this.id = head.id;
    this.name = head.name;
    this.head = head;
    this.envKey = head.envKey || 'OPENAI_API_KEY';
    this.apiKey = env[this.envKey];
    this.baseUrl = head.baseUrl || env[`${this.envKey.replace(/_API_KEY$/, '')}_BASE_URL`] || null;
    this.model = head.model || env.OPENAI_MODEL || head.defaultModel;
    const clientOpts = { apiKey: this.apiKey };
    if (this.baseUrl) {
      clientOpts.baseURL = this.baseUrl;
    }
    this.client = this.apiKey ? new OpenAI(clientOpts) : null;
    this.lastConnectionError = '';
  }

  async connect() {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.models.retrieve(this.model);
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
      instructions: context,
      input: prompt,
      store: false,
      max_output_tokens: getEnvNumber('OPENAI_MAX_OUTPUT_TOKENS', 2048),
    };

    if (stream) {
      const responseStream = await this.client.responses.create({ ...request, stream: true });
      let text = '';
      for await (const event of responseStream) {
        if (event.type === 'response.output_text.delta') {
          text += event.delta;
        }
      }

      return this.#response(text, null, context, prompt);
    }

    const response = await this.client.responses.create(request);
    return this.#response(response.output_text || '', response, context, prompt, {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      totalTokens: response.usage?.total_tokens,
    });
  }

  async #sendPromptWithTools(context, prompt, options) {
    const { tools, executeTool, maxIterations = 10, onUsage } = options;
    const openAiTools = tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    }));
    const input = [{ role: 'user', content: prompt }];
    let lastResponse = null;
    let aggregateText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: context,
        input,
        tools: openAiTools,
        store: false,
        max_output_tokens: getEnvNumber('OPENAI_MAX_OUTPUT_TOKENS', 2048),
      });
      lastResponse = response;
      inputTokens += response.usage?.input_tokens || 0;
      outputTokens += response.usage?.output_tokens || 0;

      const text = response.output_text || '';
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

      const output = Array.isArray(response.output) ? response.output : [];
      const functionCalls = output.filter((item) => item.type === 'function_call');
      if (functionCalls.length === 0) {
        return this.#response(aggregateText, response, context, prompt, {
          inputTokens,
          outputTokens,
        });
      }

      for (const item of output) {
        input.push(item);
      }

      for (const call of functionCalls) {
        let parsedArgs = {};
        try {
          parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
        } catch (error) {
          parsedArgs = { __parse_error: String(error?.message || error) };
        }
        const result = await executeTool({
          name: call.name,
          input: parsedArgs,
        });
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: result.isError ? `ERROR: ${result.output}` : result.output,
        });
      }
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
    return estimateCostUsd(tokens, getEnvNumber('OPENAI_ESTIMATED_USD_PER_1M_TOKENS', 6));
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
