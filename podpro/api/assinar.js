// api/assinar.js
// Cria preferência de pagamento no Mercado Pago para o plano escolhido
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const PLANOS = {
  libaneo:  { nome: 'Plano Libâneo',  valor: 7.97  },
  vygotsky: { nome: 'Plano Vygotsky', valor: 17.97 },
  piaget:   { nome: 'Plano Piaget',   valor: 27.97 },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { usuario_id, email, nome, plano, valor } = req.body;

  if (!usuario_id || !email || !plano) {
    return res.status(400).json({ error: 'usuario_id, email e plano são obrigatórios' });
  }

  const planInfo = PLANOS[plano];
  if (!planInfo) {
    return res.status(400).json({ error: 'Plano inválido. Use: libaneo, vygotsky ou piaget' });
  }

  // Valor final: usa o passado pelo cliente ou o cadastrado no servidor (servidor vence)
  const valorFinal = planInfo.valor;

  try {
    // Referência externa: identifica usuário e plano no webhook
    const externalReference = JSON.stringify({ usuario_id, plano });

    const preferenceBody = {
      items: [{
        title: planInfo.nome + ' – PodPrô',
        description: 'Acesso mensal ao ' + planInfo.nome + ' no PodPrô',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: valorFinal,
      }],
      payer: { email },
      external_reference: externalReference,
      back_urls: {
        success: `${process.env.APP_URL || req.headers.origin}?assinatura=sucesso&plano=${plano}`,
        failure: `${process.env.APP_URL || req.headers.origin}?assinatura=falha`,
        pending: `${process.env.APP_URL || req.headers.origin}?assinatura=pendente`,
      },
      auto_return: 'approved',
      notification_url: `${process.env.APP_URL || req.headers.origin}/api/webhook-mp`,
      statement_descriptor: 'PODPRO',
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preferenceBody),
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('MP error:', mpData);
      return res.status(500).json({ error: 'Erro ao criar preferência no Mercado Pago' });
    }

    // Registrar tentativa de pagamento
    await supabase.from('pagamentos').insert({
      usuario_id,
      plano,
      mp_status: 'pending',
      valor: valorFinal,
    });

    return res.status(200).json({
      ok: true,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
    });

  } catch (err) {
    console.error('assinar error:', err);
    return res.status(500).json({ error: err.message });
  }
};
