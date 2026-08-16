// api/assinar.js — Assinatura mensal automática via Mercado Pago Preapproval
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PLANOS = {
  libaneo:  { nome: 'Plano Libâneo – PodPrô',  valor: 7.97  },
  vygotsky: { nome: 'Plano Vygotsky – PodPrô', valor: 17.97 },
  piaget:   { nome: 'Plano Piaget – PodPrô',   valor: 27.97 },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { usuario_id, email, nome, plano } = req.body;
  if (!usuario_id || !email || !plano) {
    return res.status(400).json({ error: 'usuario_id, email e plano são obrigatórios' });
  }

  const planInfo = PLANOS[plano];
  if (!planInfo) return res.status(400).json({ error: 'Plano inválido' });

  const appUrl = process.env.APP_URL || 'https://project-lfk7g.vercel.app';

  try {
    // ── Cria assinatura recorrente mensal via Preapproval ──────────────────
    const preapprovalBody = {
      reason: planInfo.nome,
      external_reference: JSON.stringify({ usuario_id, plano }),
      payer_email: email,

      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',       // cobrança mensal
        transaction_amount: planInfo.valor,
        currency_id: 'BRL',
        // ✅ Só cartão de crédito
        payment_methods_allowed: {
          payment_types: [{ id: 'credit_card' }],
        },
      },

      back_url: `${appUrl}?assinatura=sucesso&plano=${plano}`,
      status: 'pending',
    };

    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preapprovalBody),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error('MP Preapproval error:', JSON.stringify(mpData));
      return res.status(500).json({ error: 'Erro ao criar assinatura no Mercado Pago', detail: mpData });
    }

    // Log no Supabase
    await supabase.from('pagamentos').insert({
      usuario_id,
      plano,
      mp_payment_id: mpData.id,        // ID da assinatura/preapproval
      mp_status: 'pending',
      valor: planInfo.valor,
    });

    return res.status(200).json({
      ok: true,
      init_point: mpData.init_point,   // URL do checkout MP
      preapproval_id: mpData.id,
    });

  } catch (err) {
    console.error('assinar error:', err);
    return res.status(500).json({ error: err.message });
  }
};
