const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

const configured = (name: string) => Boolean(Deno.env.get(name)?.trim())

function buildConfig() {
  const apiBaseUrl = (Deno.env.get('APPS_IN_TOSS_API_BASE_URL') || 'https://apps-in-toss-api.toss.im').replace(/\/$/, '')
  const certConfigured = configured('APPS_IN_TOSS_CERT_PATH_PEM') || configured('APPS_IN_TOSS_CERT_PEM')
  const keyConfigured = configured('APPS_IN_TOSS_KEY_PATH_PEM') || configured('APPS_IN_TOSS_KEY_PEM')
  const tossLoginConfigured = certConfigured && keyConfigured
  const tossSmartMessageConfigured = tossLoginConfigured && configured('TOSS_SMART_MESSAGE_TEMPLATE_CODE')
  const aiConfigured = configured('GEMINI_API_KEY') && configured('NEWS_API_KEY')
  const paperTradingConfigured = configured('SUPABASE_SERVICE_ROLE_KEY')

  return {
    auth_mode: 'session_account',
    cors_allowed_origins: [],
    features: {
      sector_flow: {
        status: 'ready',
        summary: '공용 시세 데이터 기반 섹터 흐름 조회가 가능합니다.',
        available: true,
      },
      ai_analysis: {
        status: aiConfigured ? 'ready' : 'limited',
        summary: aiConfigured
          ? '뉴스 수집과 Gemini 분석을 모두 사용할 수 있습니다.'
          : 'Edge Function secrets 설정 전이라 실시간 분석이 제한됩니다.',
        available: true,
      },
      paper_trading: {
        status: paperTradingConfigured ? 'ready' : 'limited',
        summary: paperTradingConfigured
          ? 'Supabase가 연결되어 모의투자 상태와 주문을 저장할 수 있습니다.'
          : 'SUPABASE_SERVICE_ROLE_KEY 설정 전이라 모의투자 기능이 제한됩니다.',
        available: paperTradingConfigured,
      },
      strategy_simulation: {
        status: 'ready',
        summary: '단일 백테스트와 전략 최적화 실행이 가능합니다.',
        available: true,
      },
    },
    toss_login: {
      configured: tossLoginConfigured,
      base_url: apiBaseUrl,
      generate_token_url: `${apiBaseUrl}/api-partner/v1/apps-in-toss/user/oauth2/generate-token`,
      me_url: `${apiBaseUrl}/api-partner/v1/apps-in-toss/user/oauth2/login-me`,
      cert_path_set: certConfigured,
      key_path_set: keyConfigured,
    },
    toss_smart_message: {
      configured: tossSmartMessageConfigured,
      app_name: Deno.env.get('APPS_IN_TOSS_APP_NAME') || 'glance-invest',
      template_code: Deno.env.get('TOSS_SMART_MESSAGE_TEMPLATE_CODE') || null,
    },
  }
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

  return new Response(JSON.stringify(buildConfig()), { headers: corsHeaders })
})
