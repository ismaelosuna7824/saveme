/** Textos de `errors`. Misma forma que `es/errors.ts`. */
export const errors = {
  network_error: "Couldn't reach the core at {base}. {detail}",
  http: 'The core answered {status} without saying why.',

  invalid_language: 'The language must be "es", "en", or empty to follow the system.',
  invalid_root: "The root folder can't be empty.",
  no_providers: "You didn't ask to configure any client.",
  missing_provider: 'Which client to configure is missing.',
  unknown_provider: "That client isn't one I know how to configure.",
  invalid_decision: 'The decision must be "accepted", "modified", or "cancelled".',
  no_streaming: "The server doesn't support streaming.",
} as const
