// This is a fallback for any /s/ routes that aren't specifically handled
export async function onRequest(context) {
  return new Response('Invalid sharing URL', { status: 404 });
}