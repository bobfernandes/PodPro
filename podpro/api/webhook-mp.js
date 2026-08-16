// api/webhook-mp.js — Processa eventos de assinatura e pagamentos do MP
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const NIVEL_PLANO = { ferreiro: 0, libaneo: 1, vygotsky: 2, piaget: 3 };

async function atualizarPlano(usuario_id, plano) {
  const { data: user } = await supabase
    .from('usuários').select('plano').eq('id', usuario_id).single();

  const planoAtual = user?.plano || 'ferreiro';
  if ((NIVEL_PLANO[plano] ?? 0) >= (NIVEL_PLANO[planoAtual] ?? 0)) {
    await supabase.from('usuários').update({ plano }).eq('id', usuario_id);
    console.log(`✅ Plano atualizado: ${usuario_id} → ${plano}`);
  }
}

async function parseRef(external_reference) {
  try { return JSON.parse(external_reference); } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data, action } = req.body;
    console.log('Webhook MP:', type || action, data?.id);

    // ── 1. Pagamento de assinatura aprovado ──────────────────────────────────
    if (type === 'payment') {
      const paymentId = data?.id;
      if (!paymentId) return res.status(200).json({ ok: true, msg: 'sem id' });

      const pmRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      });
      const payment = await pmRes.json();

      console.log(`Payment ${paymentId}: status=${payment.status}`);

      if (payment.status !== 'approved') {
        return res.status(200).json({ ok: true, msg: 'não aprovado: ' + payment.status });
      }

      const ref = await parseRef(payment.external_reference);
      if (!ref?.usuario_id || !ref?.plano) {
        return res.status(200).json({ ok: false, msg: 'external_reference inválido' });
      }

      await atualizarPlano(ref.usuario_id, ref.plano);

      await supabase.from('pagamentos').upsert({
        usuario_id: ref.usuario_id,
        plano: ref.plano,
        mp_payment_id: String(paymentId),
        mp_status: 'approved',
        valor: payment.transaction_amount,
      }, { onConflict: 'mp_payment_id' });

      return res.status(200).json({ ok: true });
    }

    // ── 2. Assinatura (preapproval) autorizada ────────────────────────────────
    if (type === 'subscription_preapproval' || action === 'updated') {
      const preapprovalId = data?.id;
      if (!preapprovalId) return res.status(200).json({ ok: true });

      const paRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      });
      const pa = await paRes.json();

      console.log(`Preapproval ${preapprovalId}: status=${pa.status}`);

      // Quando o usuário autoriza o cartão, status vira 'authorized'
      if (pa.status === 'authorized') {
        const ref = await parseRef(pa.external_reference);
        if (ref?.usuario_id && ref?.plano) {
          await atualizarPlano(ref.usuario_id, ref.plano);
        }
      }

      // Se cancelada/pausada, rebaixa pro ferreiro
      if (pa.status === 'cancelled' || pa.status === 'paused') {
        const ref = await parseRef(pa.external_reference);
        if (ref?.usuario_id) {
          await supabase.from('usuários').update({ plano: 'ferreiro' }).eq('id', ref.usuario_id);
          console.log(`⚠️ Assinatura ${pa.status}: ${ref.usuario_id} → ferreiro`);
        }
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, msg: 'tipo ignorado: ' + type });

  } catch (err) {
    console.error('webhook error:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
