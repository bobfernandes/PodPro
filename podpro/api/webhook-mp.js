// api/webhook-mp.js
// Recebe notificações do Mercado Pago e atualiza o plano do usuário
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Hierarquia de planos (upgrades apenas avançam, nunca retrocedem)
const NIVEL_PLANO = { ferreiro: 0, libaneo: 1, vygotsky: 2, piaget: 3 };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // MP envia GET ou POST dependendo do tipo de notificação
  if (req.method === 'GET') {
    // Teste de conectividade
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    const { type, data } = req.body;

    // Só processamos pagamentos aprovados
    if (type !== 'payment') {
      return res.status(200).json({ ok: true, msg: 'tipo ignorado: ' + type });
    }

    const paymentId = data?.id;
    if (!paymentId) return res.status(200).json({ ok: true, msg: 'sem payment id' });

    // Consultar detalhes do pagamento no MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });

    if (!mpRes.ok) {
      console.error('Falha ao consultar MP payment', paymentId);
      return res.status(200).json({ ok: false, msg: 'Falha MP query' });
    }

    const payment = await mpRes.json();

    console.log(`Webhook MP: payment ${paymentId} status=${payment.status}`);

    // Só atualiza se pagamento aprovado
    if (payment.status !== 'approved') {
      return res.status(200).json({ ok: true, msg: 'pagamento não aprovado: ' + payment.status });
    }

    // Decodificar referência externa: { usuario_id, plano }
    let ref;
    try {
      ref = JSON.parse(payment.external_reference);
    } catch {
      console.error('external_reference inválido:', payment.external_reference);
      return res.status(200).json({ ok: false, msg: 'external_reference inválido' });
    }

    const { usuario_id, plano } = ref;

    if (!usuario_id || !plano) {
      return res.status(200).json({ ok: false, msg: 'ref incompleta' });
    }

    // Buscar plano atual do usuário
    const { data: user } = await supabase
      .from('usuários')
      .select('plano')
      .eq('id', usuario_id)
      .single();

    const planoAtual = user?.plano || 'ferreiro';
    const nivelAtual = NIVEL_PLANO[planoAtual] ?? 0;
    const nivelNovo  = NIVEL_PLANO[plano] ?? 0;

    // Só atualiza se o novo plano for superior (ou igual ao já pago)
    if (nivelNovo >= nivelAtual) {
      await supabase
        .from('usuários')
        .update({ plano })
        .eq('id', usuario_id);

      console.log(`Plano atualizado: usuário ${usuario_id} → ${plano}`);
    }

    // Registrar pagamento aprovado
    await supabase.from('pagamentos').insert({
      usuario_id,
      plano,
      mp_payment_id: String(paymentId),
      mp_status: 'approved',
      valor: payment.transaction_amount,
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('webhook-mp error:', err);
    // SEMPRE retornar 200 para o MP não re-tentar infinitamente
    return res.status(200).json({ ok: false, error: err.message });
  }
};
