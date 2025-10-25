// This function provides status and cleanup capabilities

export async function onRequestGet(context) {
  // Simple status endpoint
  return new Response(
    JSON.stringify({ 
      status: 'File sharing service is running',
      timestamp: Date.now(),
      uptime: 'Not implemented in this version'
    }),
    { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    }
  );
}

// This endpoint could be used to manually clean up expired entries if needed
export async function onRequestPost(context) {
  try {
    const { action } = await context.request.json();
    
    if (action === 'cleanup') {
      // This would implement cleanup of expired entries
      // In practice, we rely on KV's automatic expiration
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Cleanup is handled automatically by KV expiration' 
        }),
        { 
          status: 200, 
          headers: { 'Content-Type': 'application/json' } 
        }
      );
    }
    
    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Status endpoint error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
}