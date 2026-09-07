// api/pagar.js — processa pagamento via MP Brick + salva cartão para renovação
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PLANOS = {
  libaneo:  { nome: 'Plano Libâneo – PodPrô',  valor: 7.97  },
  vygotsky: { nome: 'Plano Vygotsky – PodPrô', valor: 17.97 },
  piaget:   { nome: 'Plano Piaget – PodPrô',   valor: 27.97 },
};
const NIVEL = { ferreiro:0, libaneo:1, vygotsky:2, piaget:3 };

async function mpPost(path, body, idempotencyKey) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
  };
  // MP exige X-Idempotency-Key em requisições de criação (pagamentos, clientes, cartões)
  headers['X-Idempotency-Key'] = idempotencyKey || crypto.randomUUID();
  const r = await fetch(`https://api.mercadopago.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return r.json();
}

async function mpGet(path) {
  const r = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET → retorna chave pública do MP (substitui mp-config.js)
  if (req.method === 'GET') {
    return res.status(200).json({ public_key: process.env.MP_PUBLIC_KEY || '' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // ── Ação: CANCELAR assinatura (mantém acesso até o vencimento já pago) ──
  if (req.body.action === 'cancelar') {
    const { usuario_id } = req.body;
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id ausente' });
    const { data: user, error: findErr } = await supabase.from('usuarios')
      .select('plano,plano_vencimento').eq('id', usuario_id).single();
    if (findErr || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!user.plano || user.plano === 'ferreiro')
      return res.status(400).json({ error: 'Você não tem uma assinatura paga ativa.' });

    const { error: cancelErr } = await supabase.from('usuarios')
      .update({ plano_cancelado: true }).eq('id', usuario_id);
    if (cancelErr) {
      console.error('Erro ao cancelar assinatura:', cancelErr.message);
      return res.status(500).json({ error: 'Não foi possível cancelar. Tente novamente.' });
    }
    return res.status(200).json({ ok: true, plano_vencimento: user.plano_vencimento || null });
  }

  const { usuario_id, email, plano, token, payment_method_id,
          installments, issuer_id, payer } = req.body;

  if (!usuario_id || !email || !plano || !token)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

  const planInfo = PLANOS[plano];
  if (!planInfo) return res.status(400).json({ error: 'Plano inválido' });

  try {
    // ── 1. Cria pagamento ──────────────────────────────────────────────────
    const payment = await mpPost('/v1/payments', {
      transaction_amount: planInfo.valor,
      token,
      installments: installments || 1,
      payment_method_id,
      issuer_id,
      payer: { email, ...payer },
      external_reference: JSON.stringify({ usuario_id, plano }),
      description: planInfo.nome,
      statement_descriptor: 'PODPRO',
      three_d_secure_mode: 'optional',
    });

    console.log('Payment raw response:', JSON.stringify(payment));

    // ── 1b. Detecta erro de requisição à API do MP (não é uma decisão de pagamento) ──
    if (!payment.id) {
      const motivo = payment.message || payment.error || (payment.cause && JSON.stringify(payment.cause)) || 'Erro desconhecido';
      console.error('Erro ao criar pagamento no MP:', motivo);
      return res.status(200).json({
        ok: false,
        status: 'api_error',
        error: 'Não foi possível processar o pagamento. Tente novamente.',
        debug_detail: motivo,
      });
    }

    console.log('Payment:', payment.id, payment.status);

    // ── 2. Salva tentativa no histórico ────────────────────────────────────
    const { error: insertErr } = await supabase.from('pagamentos').insert({
      usuario_id, plano,
      mp_payment_id: String(payment.id),
      mp_status: payment.status,
      valor: planInfo.valor,
    });
    if (insertErr) console.error('Erro ao salvar em pagamentos:', insertErr.message);

    if (payment.status !== 'approved') {
      console.log('Payment recusado — status_detail:', payment.status_detail);
      return res.status(200).json({
        ok: false,
        status: payment.status,
        error: traduzirErro(payment.status_detail),
        debug_detail: payment.status_detail || null,
      });
    }

    // ── 3. Pagamento aprovado — ativa plano ───────────────────────────────
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 30);

    const { data: user } = await supabase.from('usuarios').select('plano,mp_customer_id').eq('id', usuario_id).single();
    const planoAtual = user?.plano || 'ferreiro';
    if ((NIVEL[plano] ?? 0) >= (NIVEL[planoAtual] ?? 0)) {
      await supabase.from('usuarios').update({
        plano,
        plano_vencimento: vencimento.toISOString(),
        plano_cancelado: false,
      }).eq('id', usuario_id);
    }

    // ── 4. Salva cartão para renovação futura ─────────────────────────────
    try {
      let customerId = user?.mp_customer_id;

      // Cria ou busca cliente MP
      if (!customerId) {
        const search = await mpGet(`/v1/customers/search?email=${encodeURIComponent(email)}`);
        if (search.results?.length > 0) {
          customerId = search.results[0].id;
        } else {
          const customer = await mpPost('/v1/customers', { email });
          customerId = customer.id;
        }
      }

      // Associa cartão ao cliente
      const card = await mpPost(`/v1/customers/${customerId}/cards`, { token });

      await supabase.from('usuarios').update({
        mp_customer_id: String(customerId),
        mp_card_id:     card.id,
        mp_card_method: payment_method_id,
      }).eq('id', usuario_id);

      console.log(`✅ Cartão salvo: customer=${customerId} card=${card.id}`);
    } catch (cardErr) {
      console.warn('Aviso: não salvou cartão para renovação:', cardErr.message);
    }

    return res.status(200).json({ ok: true, status: 'approved', plano });

  } catch (err) {
    console.error('pagar error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function traduzirErro(detail) {
  const erros = {
    'cc_rejected_insufficient_amount': 'Saldo insuficiente no cartão.',
    'cc_rejected_bad_filled_card_number': 'Número do cartão inválido.',
    'cc_rejected_bad_filled_date': 'Data de validade inválida.',
    'cc_rejected_bad_filled_security_code': 'Código de segurança inválido.',
    'cc_rejected_blacklist': 'Cartão não autorizado pelo banco.',
    'cc_rejected_call_for_authorize': 'Ligue para seu banco para autorizar.',
    'cc_rejected_card_disabled': 'Cartão desativado. Contate seu banco.',
    'cc_rejected_high_risk': 'Pagamento recusado por segurança.',
  };
  return erros[detail] || 'Pagamento recusado. Tente com outro cartão.';
}
