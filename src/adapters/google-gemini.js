import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  assertConfigured,
  buildAdapterResponse,
  estimateCostUsd,
  estimateTokens,
  getEnvNumber,
  sanitizeErrorMessage,
} from './base.js';

export class GoogleGeminiAdapter {
  constructor(head, env = process.env) {
    this.id = head.id;
    this.name = head.name;
    this.head = head;
    this.envKey = head.envKey || 'GOOGLE_API_KEY';
    this.apiKey = env[this.envKey];
    this.model = head.model || env.GOOGLE_MODEL || head.defaultModel;
    this.client = this.apiKey ? new GoogleGenerativeAI(this.apiKey) : null;
    this.lastConnectionError = '';
  }

  async connect() {
    if (!this.client) {
      return false;
    }

    try {
      const model = this.client.getGenerativeModel({
        model: process.env.GOOGLE_DOCTOR_MODEL || this.model,
        generationConfig: { maxOutputTokens: 1 },
      });
      await model.generateContent('hi');
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

    const model = this.#model(context);

    if (stream) {
      const result = await model.generateContentStream(prompt);
      let text = '';
      for await (const chunk of result.stream) {
        text += chunk.text();
      }

      return this.#response(text, null, context, prompt);
    }

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return this.#response(text, result.response, context, prompt, {
      promptTokenCount: result.response.usageMetadata?.promptTokenCount,
      candidatesTokenCount: result.response.usageMetadata?.candidatesTokenCount,
      totalTokenCount: result.response.usageMetadata?.totalTokenCount,
    });
  }

  async #sendPromptWithTools(context, prompt, options) {
    const { tools, executeTool, maxIterations = 10, onUsage } = options;
    const model = this.#model(context, tools);
    const chat = model.startChat();
    let result = await chat.sendMessage(prompt);
    let lastResponse = result.response;
    let aggregateText = '';
    let promptTokenCount = 0;
    let candidatesTokenCount = 0;
    let totalTokenCount = 0;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const usage = result.response.usageMetadata || {};
      promptTokenCount += usage.promptTokenCount || 0;
      candidatesTokenCount += usage.candidatesTokenCount || 0;
      totalTokenCount += usage.totalTokenCount || 0;

      if (onUsage) {
        await onUsage({
          iteration,
          inputTokens: usage.promptTokenCount || 0,
          outputTokens: usage.candidatesTokenCount || 0,
        });
      }

      const functionCalls = result.response.functionCalls?.() || [];
      if (functionCalls.length === 0) {
        aggregateText = safeGeminiText(result.response);
        return this.#response(aggregateText, result.response, context, prompt, {
          promptTokenCount,
          candidatesTokenCount,
          totalTokenCount,
        });
      }

      const functionResponses = [];
      for (const call of functionCalls) {
        const toolResult = await executeTool({
          name: call.name,
          input: call.args || {},
        });
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: {
              output: toolResult.output,
              isError: Boolean(toolResult.isError),
            },
          },
        });
      }

      result = await chat.sendMessage(functionResponses);
      lastResponse = result.response;
    }

    const cappedText = `${safeGeminiText(lastResponse)}\n\n[Hydra: tool-use loop hit ${maxIterations}-iteration cap before completing.]`;
    return this.#response(cappedText, lastResponse, context, prompt, {
      promptTokenCount,
      candidatesTokenCount,
      totalTokenCount,
    });
  }

  getTokenCount(text) {
    return estimateTokens(text);
  }

  getEstimatedCost(tokens) {
    return estimateCostUsd(tokens, getEnvNumber('GOOGLE_ESTIMATED_USD_PER_1M_TOKENS', 3));
  }

  #model(systemInstruction, tools = null) {
    return this.client.getGenerativeModel({
      model: this.model,
      systemInstruction,
      tools: tools ? geminiTools(tools) : undefined,
    });
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

function geminiTools(tools) {
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    })),
  }];
}

function safeGeminiText(response) {
  try {
    return response.text();
  } catch {
    return '';
  }
}
