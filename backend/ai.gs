// All AI-provider calls live here. To swap provider, replace this file and keep
// the same two entry points: aiClassify_ and aiRunToolLoop_.

const AI_URL = 'https://api.anthropic.com/v1/messages';
const AI_API_VERSION = '2026-10-21';
const AI_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const AI_MODELS = {
  complex: { model: 'claude-sonnet-5-5', effort: 'medium', fallback: true },
  simple: { model: 'claude-haiku-5-5', effort: 'low', fallback: false },
};
const AI_MAX_TOKENS = 8000;
const AI_MAX_ROUNDS = 8;
const AI_TIME_LIMIT_MS = 150000;
const AI_RETRY_STATUSES = [429, 500, 502, 503, 529];
const AI_MAX_RETRIES = 2;
const AI_WEB_SEARCH_MAX_USES = 3;

const AI_CLASSIFIER_PROMPT = 'Label a calendar assistant request. Reply with one word.\n' +
  'complex: finding free time, scheduling or moving several events, anything about a place or its hours, ' +
  'anything needing live information from the web, or several steps.\n' +
  'simple: one event, one quick question about the calendar, or a short reply to the assistant.';

function aiRequest_(body, useFallbackBeta) {
  const apiKey = (PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is missing from Script Properties.');

  const headers = { 'x-api-key': apiKey, 'anthropic-version': AI_API_VERSION };
  if (useFallbackBeta) headers['anthropic-beta'] = AI_FALLBACK_BETA;

  for (let attempt = 0; ; attempt++) {
    const response = UrlFetchApp.fetch(AI_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    if (status === 200) return JSON.parse(response.getContentText());
    if (attempt >= AI_MAX_RETRIES || AI_RETRY_STATUSES.indexOf(status) < 0) {
      throw aiError_(status, aiErrorMessage_(response.getContentText()));
    }
    Utilities.sleep(1500 * (attempt + 1));
  }
}

// Tags errors the owner can act on, so the app can show a clear message.
function aiError_(status, message) {
  const error = new Error('AI request failed (' + status + '): ' + message);
  if (status === 402 || /credit balance/i.test(message)) {
    error.limitCode = 'ai_no_credit';
  } else if (/spend|usage limit/i.test(message)) {
    error.limitCode = 'ai_spend_limit';
  } else if (status === 401) {
    error.limitCode = 'ai_key_invalid';
  } else if (AI_RETRY_STATUSES.indexOf(status) >= 0) {
    error.limitCode = 'ai_busy';
  }
  return error;
}

function aiErrorMessage_(text) {
  try {
    return JSON.parse(text).error.message;
  } catch (error) {
    return String(text).slice(0, 200);
  }
}

// Returns 'simple' or 'complex'. Anything unclear counts as complex.
function aiClassify_(text, previousReply) {
  const response = aiRequest_({
    model: AI_MODELS.simple.model,
    max_tokens: 10,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: AI_CLASSIFIER_PROMPT,
    messages: [{
      role: 'user',
      content: 'Previous assistant message: ' + (previousReply || '(none)') + '\nRequest: ' + text,
    }],
  }, false);
  const label = aiFinalText_(response.content).toLowerCase();
  return label.indexOf('simple') >= 0 ? 'simple' : 'complex';
}

function aiWebSearchTool_() {
  return {
    type: 'web_search_20260318',
    name: 'web_search',
    max_uses: AI_WEB_SEARCH_MAX_USES,
    allowed_callers: ['direct'],
    // The API rejects country code IL, so only the timezone is sent.
    user_location: { type: 'approximate', timezone: TZ },
  };
}

// The words after the last tool activity, so "let me search" openers don't reach the owner.
function aiFinalText_(content) {
  let text = '';
  content.forEach(function (block) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
      text = '';
    }
  });
  return text.trim();
}

function aiAddUsage_(total, usage) {
  total.input += usage.input_tokens || 0;
  total.output += usage.output_tokens || 0;
  total.cacheRead += usage.cache_read_input_tokens || 0;
  total.cacheWrite += usage.cache_creation_input_tokens || 0;
  total.searches += (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
}

// Runs Claude until it finishes. options: tier, system, tools, messages, executeTool(name, input).
// Returns { text, stopped, rounds, usage }. stopped is null when Claude finished normally.
function aiRunToolLoop_(options) {
  const config = AI_MODELS[options.tier];
  const messages = options.messages.slice();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  const deadline = Date.now() + AI_TIME_LIMIT_MS;
  const body = {
    model: config.model,
    max_tokens: AI_MAX_TOKENS,
    output_config: { effort: config.effort },
    // The tools and this system block are the same every time, so this one marker caches both.
    system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }],
    tools: options.tools.concat([aiWebSearchTool_()]),
    messages: messages,
  };
  if (config.fallback) body.fallbacks = 'default';

  for (let round = 1; round <= AI_MAX_ROUNDS; round++) {
    if (Date.now() > deadline) return { text: '', stopped: 'time_limit', rounds: round - 1, usage: usage };

    const response = aiRequest_(body, config.fallback);
    aiAddUsage_(usage, response.usage || {});

    if (response.stop_reason === 'refusal') return { text: '', stopped: 'refusal', rounds: round, usage: usage };
    if (response.stop_reason === 'max_tokens') return { text: '', stopped: 'max_tokens', rounds: round, usage: usage };

    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason !== 'tool_use') {
      return { text: aiFinalText_(response.content), stopped: null, rounds: round, usage: usage };
    }

    const results = response.content
      .filter(function (block) { return block.type === 'tool_use'; })
      .map(function (block) { return aiRunTool_(block, options.executeTool); });
    messages.push({ role: 'user', content: results });
  }
  return { text: '', stopped: 'round_limit', rounds: AI_MAX_ROUNDS, usage: usage };
}

function aiRunTool_(block, executeTool) {
  try {
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(executeTool(block.name, block.input)) };
  } catch (error) {
    return { type: 'tool_result', tool_use_id: block.id, content: error.message, is_error: true };
  }
}
