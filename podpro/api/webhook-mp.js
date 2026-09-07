// api/webhook-mp.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const NIVEL_PLANO = { ferreiro:0, libaneo:1, vygotsky:2, piaget:3 };

async function mpGet(path) {
  const r = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  return r.json();
}

async function atualizarPlano(usuario_id, plano) {
  const { data: user } = await supabase
    .from('usuarios').select('plano').eq('id', usuario_id).single();
  const planoAtual = user?.plano || 'ferreiro';
  if ((NIVEL_PLANO[plano] ?? 0) >= (NIVEL_PLANO[planoAtual] ?? 0)) {
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 30);
    await supabase.from('usuarios').update({
      plano,
      plano_vencimento: vencimento.toISOString(),
      plano_cancelado: false,
    }).eq('id', usuario_id);
    console.log(`✅ Plano atualizado: ${usuario_id} → ${plano} (vence ${vencimento.toDateString()})`);
    return true;
  }
  return false;
}

async function parseRef(str) {
  try { return JSON.parse(str); } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body || {};
    const type = body.type || body.action;
    const dataId = body.data?.id;
    console.log(`Webhook: type=${type} id=${dataId}`);

    // ── PAGAMENTO (cobrança avulsa ou de assinatura) ─────────────────────────
    if (type === 'payment') {
      if (!dataId) return res.status(200).json({ ok:true, msg:'sem id' });

      const payment = await mpGet(`/v1/payments/${dataId}`);
      console.log(`Payment ${dataId}: status=${payment.status} ref=${payment.external_reference}`);

      if (payment.status !== 'approved') {
        // Registra no banco mesmo que pendente/rejeitado
        if (payment.external_reference) {
          const ref = await parseRef(payment.external_reference);
          if (ref?.usuario_id) {
            await supabase.from('pagamentos').upsert({
              usuario_id: ref.usuario_id,
              plano: ref.plano || 'libaneo',
              mp_payment_id: String(dataId),
              mp_status: payment.status,
              valor: payment.transaction_amount,
            }, { onConflict: 'mp_payment_id' });
          }
        }
        return res.status(200).json({ ok:true, msg: `status: ${payment.status}` });
      }

      // Pagamento aprovado — tenta pegar ref diretamente
      let ref = await parseRef(payment.external_reference);

      // Se não tiver ref, busca pelo preapproval_id
      if (!ref?.usuario_id && payment.preapproval_id) {
        console.log(`Buscando preapproval: ${payment.preapproval_id}`);
        const pa = await mpGet(`/preapproval/${payment.preapproval_id}`);
        ref = await parseRef(pa.external_reference);
        console.log(`Preapproval ref: ${JSON.stringify(ref)}`);
      }

      if (!ref?.usuario_id || !ref?.plano) {
        console.error('Ref não encontrado:', payment.external_reference, payment.preapproval_id);
        return res.status(200).json({ ok:false, msg:'ref não encontrado' });
      }

      await atualizarPlano(ref.usuario_id, ref.plano);

      await supabase.from('pagamentos').upsert({
        usuario_id: ref.usuario_id,
        plano: ref.plano,
        mp_payment_id: String(dataId),
        mp_status: 'approved',
        valor: payment.transaction_amount,
      }, { onConflict: 'mp_payment_id' });

      return res.status(200).json({ ok:true });
    }

    // ── ASSINATURA autorizada ────────────────────────────────────────────────
    if (type === 'subscription_preapproval') {
      if (!dataId) return res.status(200).json({ ok:true });

      const pa = await mpGet(`/preapproval/${dataId}`);
      console.log(`Preapproval ${dataId}: status=${pa.status} ref=${pa.external_reference}`);

      if (pa.status === 'authorized') {
        const ref = await parseRef(pa.external_reference);
        if (ref?.usuario_id && ref?.plano) {
          await atualizarPlano(ref.usuario_id, ref.plano);
          await supabase.from('usuarios').update({ mp_preapproval_id: dataId }).eq('id', ref.usuario_id);

          // ✅ Grava histórico em pagamentos
          await supabase.from('pagamentos').upsert({
            usuario_id: ref.usuario_id,
            plano: ref.plano,
            mp_payment_id: String(dataId),
            mp_status: 'approved',
            valor: pa.auto_recurring?.transaction_amount || 0,
          }, { onConflict: 'mp_payment_id' });
        }
      }

      // Cancelada ou pausada — NÃO rebaixa na hora. Mantém acesso até plano_vencimento
      // (quem cuida de rebaixar depois do vencimento é a renovar-assinaturas.js).
      // Só marca a flag pra caso o cancelamento tenha vindo direto do lado do MP
      // (ex: usuário cancelou pelo app do Mercado Pago, não pelo nosso).
      if (pa.status === 'cancelled' || pa.status === 'paused') {
        const ref = await parseRef(pa.external_reference);
        if (ref?.usuario_id) {
          await supabase.from('usuarios').update({ plano_cancelado: true }).eq('id', ref.usuario_id);
          console.log(`⚠️ Assinatura ${pa.status}: ${ref.usuario_id} → marcado como cancelado, acesso mantido até o vencimento`);
        }
      }

      return res.status(200).json({ ok:true });
    }

    return res.status(200).json({ ok:true, msg:`tipo ignorado: ${type}` });

  } catch (err) {
    console.error('webhook error:', err.message);
    // Sempre retorna 200 pro MP não re-tentar infinitamente
    return res.status(200).json({ ok:false, error: err.message });
  }
};
