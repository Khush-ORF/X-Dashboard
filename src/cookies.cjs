function cookieState(input) {
  if (!Array.isArray(input) || input.length > 30) throw new Error('Expected a small X cookie array.');
  const allowed = new Set(['auth_token', 'ct0', 'twid']);
  const cookies = input.filter(cookie => allowed.has(cookie?.name)).map(cookie => {
    if (!['.x.com', 'x.com'].includes(cookie.domain) || typeof cookie.value !== 'string' || !cookie.value || cookie.value.length > 4096) {
      throw new Error('Invalid X cookie.');
    }
    return {
      name: cookie.name,
      value: cookie.value,
      domain: '.x.com',
      path: '/',
      secure: true,
      httpOnly: cookie.name === 'auth_token',
      sameSite: cookie.name === 'ct0' ? 'Lax' : 'None',
      expires: -1
    };
  });
  if (!cookies.some(cookie => cookie.name === 'auth_token') || !cookies.some(cookie => cookie.name === 'ct0')) {
    throw new Error('X_COOKIES must contain auth_token and ct0.');
  }
  return { cookies, origins: [] };
}

function cookiesFromEnvironment(env = process.env) {
  const raw = env.X_COOKIES;
  delete env.X_COOKIES;
  if (!raw) throw new Error('X_COOKIES is not configured.');
  try {
    return cookieState(JSON.parse(raw));
  } catch (error) {
    if (/must contain/.test(error.message)) throw error;
    throw new Error('X_COOKIES is invalid; credential values withheld.');
  }
}

module.exports = { cookieState, cookiesFromEnvironment };
