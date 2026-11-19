// Turns an API failure into text that says what went wrong and how to recover.
export function friendlyMessage(error) {
  const status = error && typeof error.status === 'number' ? error.status : -1;
  if (status === 0) return 'Cannot reach the server. Check your connection and try again.';
  if (status === 401) return 'Your session has ended. Sign in again to continue.';
  if (status === 403) return 'Your account cannot do this. Ask an administrator if you need access.';
  if (status === 404) return 'This record was not found, or you cannot open it. Go back and pick another one.';
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  if (status >= 500) return 'The server had a problem. Try again in a moment.';
  if (status === 400) return `${error.message} Check the fields and try again.`;
  return 'Something went wrong. Try again.';
}
