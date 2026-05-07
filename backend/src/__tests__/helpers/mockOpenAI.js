function buildToolCallResponse(payload) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify(payload),
              },
            },
          ],
        },
      },
    ],
  };
}

function buildChatJsonResponse(payload) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  };
}

module.exports = {
  buildToolCallResponse,
  buildChatJsonResponse,
};
