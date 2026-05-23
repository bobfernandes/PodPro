const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { usuario_id, email, nome } = req.body;
  if (!usuario_id || !email) return res.status(400).json({ error: 'Dados inválidos.' });

  try {
    // Cria plano de assinatura no Mercado Pago (preapproval_plan)
    const planRes = await fetch('https://api.mercadopago.com/preapproval_plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        reason: 'PodPrô – Assinatura PRO',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: 19.90,
          currency_id: 'BRL'
        },
        payment_methods_allowed: {
          payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }]
        },
        back_url: `${req.headers.origin || 'https://podpro.vercel.app'}/public/index.html?assinatura=sucesso`
      })
    });

    const plan = await planRes.json();
    if (!plan.id) throw new Error(plan.message || 'Erro ao criar plano');

    // Cria link de assinatura (preapproval)
    const subRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        preapproval_plan_id: plan.id,
        reason: 'PodPrô – Assinatura PRO',
        payer_email: email,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: 19.90,
          currency_id: 'BRL'
        },
        back_url: `${req.headers.origin || 'https://podpro.vercel.app'}/public/index.html?assinatura=sucesso`,
        notification_url: `${req.headers.origin || 'https://podpro.vercel.app'}/api/webhook-mp`
      })
    });

    const sub = await subRes.json();
    if (!sub.id) throw new Error(sub.message || 'Erro ao criar assinatura');

    // Salva no Supabase
    await supabase.from('assinaturas').insert({
      usuario_id,
      mp_preapproval_id: sub.id,
      status: 'pending'
    });

    return res.status(200).json({ ok: true, init_point: sub.init_point });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
