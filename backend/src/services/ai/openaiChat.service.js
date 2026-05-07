const axios = require('axios');

function getOpenAiApiKey(envKeyName) {
  const v = process.env[envKeyName];
  return v && String(v).trim() ? String(v).trim() : null;
}

async function openAiChatCompletions({ apiKeyEnv, payload }) {
  const apiKey = getOpenAiApiKey(apiKeyEnv);
  if (!apiKey) {
    const err = new Error(`Missing ${apiKeyEnv} env`);
    err.statusCode = 503;
    err.code = 'OPENAI_DISABLED';
    throw err;
  }

  const url = 'https://api.openai.com/v1/chat/completions';
  const resp = await axios.post(url, payload, {
    timeout: 25_000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  return resp.data;
}

async function openAiChatJson({ apiKeyEnv, model, messages, temperature = 0 }) {
  // Try with response_format json_object (if supported by model).
  const payloadWithRf = {
    model,
    messages,
    temperature,
    response_format: { type: 'json_object' },
  };

  try {
    return await openAiChatCompletions({ apiKeyEnv, payload: payloadWithRf });
  } catch (e) {
    // If response_format is not supported, retry without it.
    const status = e?.response?.status;
    const msg = String(e?.response?.data?.error?.message || e?.message || 'OpenAI error');
    const seemsRfIssue = msg.toLowerCase().includes('response_format') || msg.toLowerCase().includes('json_object');
    if (!seemsRfIssue) throw e;
    return await openAiChatCompletions({ apiKeyEnv, payload: { model, messages, temperature } });
  }
}

async function openAiToolCall({ apiKeyEnv, model, messages, toolName, toolParameters, temperature = 0 }) {
  const payload = {
    model,
    messages,
    temperature,
    tools: [
      {
        type: 'function',
        function: {
          name: toolName,
          description: 'Return ONLY the structured JSON object as function arguments.',
          parameters: toolParameters,
        },
      },
    ],
    tool_choice: {
      type: 'function',
      function: { name: toolName },
    },
  };

  return await openAiChatCompletions({ apiKeyEnv, payload });
}

module.exports = {
  openAiChatJson,
  openAiToolCall,
};
