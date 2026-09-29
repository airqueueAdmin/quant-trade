const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

Deno.serve((request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ detail: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    })
  }

  return new Response(
    JSON.stringify({
      status: 'ok',
      service: 'supabase-edge-health',
      phase: 1,
    }),
    { headers: corsHeaders },
  )
})
